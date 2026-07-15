import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { Payment, PaymentStatus } from './entities/payment.entity';

/** How long an order may sit unpaid before it is cancelled. */
export const UNPAID_ORDER_TTL_MINUTES = 30;

/** Payment states in which money has been captured — such an order must never be cancelled. */
const PAID_SIDE_STATUSES = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

/**
 * Cancels orders the customer created but never paid for.
 *
 * Without this the orders table fills up with abandoned carts, and "Мои заказы" shows the
 * customer a growing pile of dead orders with a live "Оплатить" button on stale prices.
 *
 * Money-safety notes:
 *
 * 1. Never cancel a PAID order. In the payment-first rollback edge, handlePayWebhook commits
 *    the payment PENDING -> PAID and then placeWithSuppliers claims the order in a transaction;
 *    if that transaction throws, the order rolls back to AWAITING_PAYMENT while the payment
 *    stays committed PAID. Such a PAID-but-unplaced order sits in AWAITING_PAYMENT past the
 *    TTL — an unconditional sweep would cancel it, taking money for a cancelled order. So we
 *    load the stale candidates, drop any whose payment is in a paid-side state, and cancel
 *    only the rest.
 *
 * 2. Never clobber a payment in flight. A payment can legitimately complete between our SELECT
 *    and our write. The cancelling write is a single guarded conditional UPDATE
 *    (WHERE id IN (…) AND status = awaiting_payment), so a row claimed by the webhook in
 *    between simply falls out of the predicate and is left alone — we never find-then-save.
 */
@Injectable()
export class UnpaidOrdersCron {
  private readonly logger = new Logger(UnpaidOrdersCron.name);
  private running = false;

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'cancel-unpaid-orders' })
  async handleCron(): Promise<void> {
    if (this.running) {
      this.logger.warn('Skipping run: previous unpaid-order sweep still in progress.');
      return;
    }
    this.running = true;
    try {
      const cancelled = await this.handle();
      if (cancelled > 0) {
        this.logger.log(`Cancelled ${cancelled} unpaid order(s).`);
      }
    } catch (err) {
      this.logger.error(
        'Unpaid-order sweep failed.',
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      this.running = false;
    }
  }

  async handle(): Promise<number> {
    const cutoff = new Date(Date.now() - UNPAID_ORDER_TTL_MINUTES * 60_000);

    // Stale candidates: still awaiting payment, created before the cutoff.
    const stale = await this.orderRepo.find({
      where: { status: OrderStatus.AWAITING_PAYMENT, createdAt: LessThan(cutoff) },
      select: ['id'],
    });
    if (stale.length === 0) return 0;
    const staleIds = stale.map((o) => o.id);

    // Exclude any whose money has already been captured (PAID / partially / fully refunded).
    const paidSide = await this.paymentRepo.find({
      where: { orderId: In(staleIds), status: In(PAID_SIDE_STATUSES) },
      select: ['orderId'],
    });
    const protectedIds = new Set(paidSide.map((p) => p.orderId));
    const cancelIds = staleIds.filter((id) => !protectedIds.has(id));
    if (cancelIds.length === 0) return 0;

    // Guarded conditional UPDATE — re-checks status = AWAITING_PAYMENT so an order paid
    // between the SELECT above and this write falls out of the predicate and is left alone.
    const result = await this.orderRepo.update(
      { id: In(cancelIds), status: OrderStatus.AWAITING_PAYMENT },
      { status: OrderStatus.CANCELLED },
    );
    return result.affected ?? 0;
  }
}
