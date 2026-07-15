import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { PaymentEvent, PaymentEventType } from './entities/payment-event.entity';
import { TipTopPayClient } from './tiptoppay.client';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { OrdersService } from '../orders/orders.service';

export interface PaymentInitResponse {
  publicTerminalId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  accountId: string;
  description: string;
}

/** Body TipTopPay POSTs to our webhooks. Field names are PascalCase, values are loosely typed. */
export interface TipTopPayWebhookBody {
  TransactionId?: string | number;
  Amount?: string | number;
  Currency?: string;
  InvoiceId?: string;
  AccountId?: string;
  CardLastFour?: string;
  CardType?: string;
  Status?: string;
  Reason?: string;
}

const CURRENCY = 'KZT';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(PaymentEvent)
    private readonly eventRepo: Repository<PaymentEvent>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly orders: OrdersService,
    private readonly client: TipTopPayClient,
  ) {}

  /**
   * Prepare the widget parameters for an order awaiting payment.
   *
   * The amount is read from the order — never from the request — so a tampered client
   * cannot buy a turbocharger for 100 ₸.
   */
  async init(orderId: string, userId: string): Promise<PaymentInitResponse> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден.');
    if (order.userId !== userId) throw new ForbiddenException('Это не ваш заказ.');
    if (order.status !== OrderStatus.AWAITING_PAYMENT) {
      throw new BadRequestException('Заказ не ожидает оплаты.');
    }

    // Reuse the pending payment so a retry with another card keeps the same invoice.
    let payment = await this.paymentRepo.findOne({ where: { orderId } });
    if (!payment) {
      payment = this.paymentRepo.create({
        orderId,
        invoiceId: `OP-${randomUUID().slice(0, 8).toUpperCase()}`,
        amount: Number(order.totalAmount),
        currency: CURRENCY,
        status: PaymentStatus.PENDING,
        refundedAmount: 0,
      });
    } else {
      // Guard against a double charge. In the payment-first rollback edge, handlePayWebhook
      // commits the payment PENDING -> PAID and then placeWithSuppliers claims the order in a
      // transaction; if that transaction throws (DB fault) the order rolls back to
      // AWAITING_PAYMENT while the payment stays committed PAID. The order is now
      // AWAITING_PAYMENT yet already paid. Resetting a paid-side payment to PENDING and
      // handing back fresh widget params would charge the customer a SECOND time for an order
      // that is already paid. Only PENDING (first attempt) and FAILED (retry after decline)
      // may be (re)initiated.
      if (
        payment.status === PaymentStatus.PAID ||
        payment.status === PaymentStatus.PARTIALLY_REFUNDED ||
        payment.status === PaymentStatus.REFUNDED
      ) {
        throw new BadRequestException('Этот заказ уже оплачен.');
      }
      // The order can't change after creation, but keep the amount authoritative anyway.
      // A prior Fail left it FAILED — reset to PENDING so the same invoice can be retried.
      payment.amount = Number(order.totalAmount);
      payment.status = PaymentStatus.PENDING;
      payment.failReason = null;
    }
    await this.paymentRepo.save(payment);

    return {
      publicTerminalId: this.client.publicTerminalId,
      invoiceId: payment.invoiceId,
      amount: Number(payment.amount),
      currency: CURRENCY,
      accountId: order.userId,
      description: `Оплата заказа ${payment.invoiceId} на optparts.kz`,
    };
  }

  async getByOrder(
    orderId: string,
    userId: string,
    isStaff: boolean,
  ): Promise<Payment> {
    const payment = await this.paymentRepo.findOne({ where: { orderId } });
    if (!payment) throw new NotFoundException('Платёж не найден.');
    if (!isStaff) {
      const order = await this.orderRepo.findOne({ where: { id: orderId } });
      if (!order || order.userId !== userId) {
        throw new ForbiddenException('Нет доступа к этому платежу.');
      }
    }
    return payment;
  }

  /** Append-only webhook log — audit trail + forensics for HMAC-invalid deliveries. */
  async logEvent(
    type: PaymentEventType,
    body: TipTopPayWebhookBody,
    hmacValid: boolean,
  ): Promise<void> {
    await this.eventRepo.save(
      this.eventRepo.create({
        type,
        invoiceId: body.InvoiceId ?? null,
        transactionId: body.TransactionId != null ? String(body.TransactionId) : null,
        hmacValid,
        body: body as unknown as Record<string, unknown>,
      }),
    );
  }

  /**
   * Money is in. Mark the payment paid, then place the order with suppliers.
   *
   * IDEMPOTENCY — atomic guarded update, NOT check-then-act. TipTopPay retries webhooks
   * and can deliver the same Pay concurrently. The transition PENDING -> PAID is done as
   * a single conditional UPDATE (…WHERE invoiceId = ? AND status = 'pending'); the DB
   * picks exactly one winner. Only the caller whose UPDATE affected a row may go on to
   * place with suppliers. Everyone else sees affected = 0 and returns — so two racing
   * deliveries can never double-order from a supplier.
   *
   * This mirrors OrdersService.placeWithSuppliers, which claims the order the same way
   * (AWAITING_PAYMENT -> PAID). Both layers guard the SAME invariant "place exactly once";
   * the payment-level claim here is the primary guard, the order-level claim is defense in
   * depth. A prior check-then-act version — read payment_events, place if absent — was
   * rejected because two concurrent readers both see an empty journal and both place.
   */
  async handlePayWebhook(body: TipTopPayWebhookBody): Promise<void> {
    // Always journal the delivery first (audit + forensics), regardless of who wins.
    await this.logEvent('pay', body, true);

    const invoiceId = body.InvoiceId ?? '';
    // Look the payment up first, so we can tell an unknown invoice apart from an
    // already-paid one and get the orderId for placement.
    const payment = await this.paymentRepo.findOne({ where: { invoiceId } });
    if (!payment) {
      this.logger.error(`Pay webhook for unknown invoice ${body.InvoiceId}.`);
      return;
    }

    const transactionId =
      body.TransactionId != null ? String(body.TransactionId) : null;

    // Atomic claim: PENDING -> PAID as a compare-and-set. Only the single caller whose
    // UPDATE affects a row proceeds to place; concurrent/duplicate deliveries get 0.
    const claimed = await this.paymentRepo.update(
      { invoiceId, status: PaymentStatus.PENDING },
      {
        status: PaymentStatus.PAID,
        transactionId,
        cardLastFour: body.CardLastFour ?? null,
        cardType: body.CardType ?? null,
        paidAt: new Date(),
        raw: body as unknown as Record<string, unknown>,
      },
    );

    if (claimed.affected) {
      // We won the PENDING -> PAID claim: drive placement.
      await this.orders.placeWithSuppliers(payment.orderId);
      return;
    }

    // We did NOT win the claim. That does NOT mean placement already happened — a prior
    // delivery may have committed PAID and then FAILED to place (placeWithSuppliers threw,
    // its transaction rolled the order back to AWAITING_PAYMENT). So we must re-drive
    // placement whenever the payment is PAID, not return blindly on affected:0.
    // placeWithSuppliers is idempotent (its own order-level AWAITING_PAYMENT -> PAID claim):
    // if placement already completed, it no-ops; if it never happened, this delivery drives
    // it. Two deliveries can never contact a supplier twice — that order-level claim, not
    // this early return, is what enforces "place exactly once".
    const current = await this.paymentRepo.findOne({ where: { invoiceId } });
    if (!current || current.status !== PaymentStatus.PAID) {
      // Not payable (e.g. FAILED, or a race we cannot reconcile). Never place.
      this.logger.warn(
        `Pay webhook for invoice ${invoiceId} (transaction ${body.TransactionId}) — payment not PAID (status ${current?.status ?? 'unknown'}), skipping placement.`,
      );
      return;
    }

    this.logger.warn(
      `Duplicate/late Pay webhook for already-PAID invoice ${invoiceId} (transaction ${body.TransactionId}) — re-driving idempotent placement.`,
    );
    await this.orders.placeWithSuppliers(current.orderId);
  }

  /** Bank declined. The order stays in awaiting_payment — the customer may retry. */
  async handleFailWebhook(body: TipTopPayWebhookBody): Promise<void> {
    await this.logEvent('fail', body, true);

    const invoiceId = body.InvoiceId ?? '';
    // Look the payment up first only to tell "unknown invoice" apart from "not pending".
    const payment = await this.paymentRepo.findOne({ where: { invoiceId } });
    if (!payment) {
      this.logger.error(`Fail webhook for unknown invoice ${body.InvoiceId}.`);
      return;
    }

    const failReason = body.Reason ?? body.Status ?? 'Отказ банка';

    // Guarded compare-and-set mirroring the Pay claim: ONLY a PENDING payment may become
    // FAILED. InvoiceIds are reused across retries — a declined attempt leaves the order
    // payable, the customer retries the SAME invoice, `init` resets it to PENDING, and a
    // later attempt may succeed (PAID) and place with suppliers. TipTopPay can then
    // REDELIVER the old Fail. An unconditional write here would flip that PAID, placed,
    // money-captured order to FAILED — and refund refuses anything but PAID. Never overwrite
    // a non-pending payment.
    const updated = await this.paymentRepo.update(
      { invoiceId, status: PaymentStatus.PENDING },
      {
        status: PaymentStatus.FAILED,
        failReason,
        raw: body as unknown as Record<string, unknown>,
      },
    );
    if (!updated.affected) {
      // Late/duplicate Fail for a payment that is no longer pending (already PAID, or
      // already FAILED). Log and return — must never clobber a PAID payment.
      this.logger.warn(
        `Fail webhook for invoice ${invoiceId} (transaction ${body.TransactionId}) — payment not pending (status ${payment.status}), ignoring.`,
      );
      return;
    }
  }

  /** Manager-initiated refund (full or partial). */
  async refund(
    orderId: string,
    amount: number,
    reason: string | null,
  ): Promise<Payment> {
    const payment = await this.paymentRepo.findOne({ where: { orderId } });
    if (!payment) throw new NotFoundException('Платёж не найден.');
    if (
      payment.status !== PaymentStatus.PAID &&
      payment.status !== PaymentStatus.PARTIALLY_REFUNDED
    ) {
      throw new BadRequestException('Возврат возможен только по оплаченному заказу.');
    }
    if (!payment.transactionId) {
      throw new BadRequestException('У платежа нет транзакции в TipTopPay.');
    }

    const prevRefunded = Number(payment.refundedAmount);
    const remaining = Number(payment.amount) - prevRefunded;
    if (amount <= 0 || amount > remaining) {
      throw new BadRequestException(
        `Сумма возврата должна быть от 0.01 до ${remaining}.`,
      );
    }

    // Call TipTopPay first. If it declines, throw and leave the local payment untouched.
    const result = await this.client.refund(payment.transactionId, amount);
    if (!result.Success) {
      throw new BadRequestException(
        `TipTopPay отклонил возврат: ${result.Message ?? 'причина не указана'}`,
      );
    }

    const newRefunded = prevRefunded + amount;
    const newStatus =
      newRefunded >= Number(payment.amount)
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;

    // Guarded compare-and-set on refundedAmount instead of a read-modify-write save().
    // Two managers refunding the same order concurrently both pass the remaining-amount
    // check above (both read the same prevRefunded); an unconditional save would let the
    // second overwrite the first and over-refund the local ledger. Conditioning the UPDATE
    // on the refundedAmount we observed means only one of the racing writers wins; the loser
    // sees affected:0 and is rejected rather than accumulating past `remaining`.
    const applied = await this.paymentRepo.update(
      { orderId, refundedAmount: prevRefunded },
      { refundedAmount: newRefunded, status: newStatus },
    );
    if (!applied.affected) {
      throw new BadRequestException(
        'Возврат изменился параллельно. Обновите платёж и повторите.',
      );
    }
    payment.refundedAmount = newRefunded;
    payment.status = newStatus;

    this.logger.log(
      `Refunded ${amount} ${payment.currency} on order ${orderId}. Reason: ${reason ?? '—'}`,
    );

    return payment;
  }
}
