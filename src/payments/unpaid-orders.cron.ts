import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Order, OrderStatus } from '../orders/entities/order.entity';

/** How long an order may sit unpaid before it is cancelled. */
export const UNPAID_ORDER_TTL_MINUTES = 30;

/**
 * Cancels orders the customer created but never paid for.
 *
 * Without this the orders table fills up with abandoned carts, and "Мои заказы" shows the
 * customer a growing pile of dead orders with a live "Оплатить" button on stale prices.
 *
 * Money-safety note: a payment can legitimately be in flight when this cron runs. When
 * handlePayWebhook fires, placeWithSuppliers claims the order by moving it OUT of
 * awaiting_payment atomically. If we did a find-then-save here, an order that gets paid
 * between our SELECT and our UPDATE could be clobbered back to cancelled. Instead we issue a
 * single guarded conditional UPDATE ... WHERE status = awaiting_payment AND createdAt < cutoff,
 * so the database only ever cancels rows that are still awaiting_payment at write time — a
 * row claimed by the webhook in between simply falls out of the predicate and is left alone.
 */
@Injectable()
export class UnpaidOrdersCron {
  private readonly logger = new Logger(UnpaidOrdersCron.name);
  private running = false;

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
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
    const result = await this.orderRepo.update(
      { status: OrderStatus.AWAITING_PAYMENT, createdAt: LessThan(cutoff) },
      { status: OrderStatus.CANCELLED },
    );
    return result.affected ?? 0;
  }
}
