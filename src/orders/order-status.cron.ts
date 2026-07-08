import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrdersService } from './orders.service';

/**
 * Periodically refreshes in-flight supplier sub-order statuses.
 *
 * Opt-in: the poll only runs when ORDER_STATUS_POLL_ENABLED=true (prod turns it
 * on), so dev/CI never hammer supplier APIs. Schedule is configurable via
 * ORDER_STATUS_POLL_CRON (a cron expression); defaults to every 30 minutes. A
 * re-entrancy guard prevents overlapping runs if a poll outlives its interval.
 */
@Injectable()
export class OrderStatusCron {
  private readonly logger = new Logger(OrderStatusCron.name);
  private running = false;

  constructor(private readonly orders: OrdersService) {}

  @Cron(process.env.ORDER_STATUS_POLL_CRON || CronExpression.EVERY_30_MINUTES, {
    name: 'poll-supplier-statuses',
  })
  async handle(): Promise<void> {
    if (process.env.ORDER_STATUS_POLL_ENABLED !== 'true') return;
    if (this.running) {
      this.logger.warn('Skipping run: previous status poll still in progress.');
      return;
    }
    this.running = true;
    try {
      const { checked, updated, failed } =
        await this.orders.pollActiveSupplierStatuses();
      this.logger.log(
        `Supplier status poll done: checked=${checked} updated=${updated} failed=${failed}`,
      );
    } catch (err) {
      this.logger.error(
        'Supplier status poll failed.',
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      this.running = false;
    }
  }
}
