import { UnpaidOrdersCron, UNPAID_ORDER_TTL_MINUTES } from './unpaid-orders.cron';
import { OrderStatus } from '../orders/entities/order.entity';
import { PaymentStatus } from './entities/payment.entity';

/** Unwraps a typeorm FindOperator (In/LessThan) to its underlying value. */
function opVal(op: any): any {
  return op && typeof op === 'object' && 'value' in op ? op.value : op;
}

type OrderRow = { id: string; status: OrderStatus; createdAt: Date };
type PaymentRow = { orderId: string; status: PaymentStatus };

/**
 * Honest in-memory doubles that model the real DB, NOT a fixed implementation:
 * - orderRepo.find applies status === X AND createdAt < cutoff.
 * - orderRepo.update is a faithful conditional UPDATE: it mutates EVERY row matching all
 *   provided criteria (id ∈ set, status equals, createdAt < cutoff) and returns the true
 *   affected count. A compare-and-set on status means a row claimed (paid) between our read
 *   and our write simply falls out of the predicate — never clobbered to cancelled.
 * - paymentRepo.find returns payments whose orderId ∈ set AND status ∈ set.
 */
function makeCron(opts: { orders?: OrderRow[]; payments?: PaymentRow[] } = {}) {
  const orders = opts.orders ?? [];
  const payments = opts.payments ?? [];

  const orderRepo = {
    find: jest.fn(async ({ where }: any) => {
      const statuses = Array.isArray(opVal(where.status)) ? opVal(where.status) : [where.status];
      const cutoff: Date | undefined = where.createdAt ? opVal(where.createdAt) : undefined;
      return orders
        .filter(
          (o) =>
            statuses.includes(o.status) &&
            (cutoff === undefined || o.createdAt.getTime() < cutoff.getTime()),
        )
        .map((o) => ({ id: o.id }));
    }),
    update: jest.fn(async (where: any, patch: any) => {
      const ids: string[] | undefined = where.id !== undefined ? opVal(where.id) : undefined;
      const cutoff: Date | undefined = where.createdAt ? opVal(where.createdAt) : undefined;
      let affected = 0;
      for (const o of orders) {
        if (ids !== undefined && !ids.includes(o.id)) continue;
        if (where.status !== undefined && o.status !== where.status) continue;
        if (cutoff !== undefined && !(o.createdAt.getTime() < cutoff.getTime())) continue;
        o.status = patch.status;
        affected++;
      }
      return { affected, raw: [], generatedMaps: [] };
    }),
  };

  const paymentRepo = {
    find: jest.fn(async ({ where }: any) => {
      const ids: string[] = opVal(where.orderId);
      const statuses: PaymentStatus[] = opVal(where.status);
      return payments
        .filter((p) => ids.includes(p.orderId) && statuses.includes(p.status))
        .map((p) => ({ orderId: p.orderId }));
    }),
  };

  const cron = new UnpaidOrdersCron(orderRepo as any, paymentRepo as any);
  return { cron, orderRepo, paymentRepo, orders, payments };
}

const staleAt = () => new Date(Date.now() - (UNPAID_ORDER_TTL_MINUTES + 5) * 60_000);
const freshAt = () => new Date(Date.now() - 1 * 60_000);

describe('UnpaidOrdersCron', () => {
  it('cancels a stale awaiting_payment order with no payment', async () => {
    const { cron, orders } = makeCron({
      orders: [{ id: 'o1', status: OrderStatus.AWAITING_PAYMENT, createdAt: staleAt() }],
    });

    const cancelled = await cron.handle();

    expect(cancelled).toBe(1);
    expect(orders[0].status).toBe(OrderStatus.CANCELLED);
  });

  it('cancels a stale order whose payment is still PENDING', async () => {
    const { cron, orders } = makeCron({
      orders: [{ id: 'o1', status: OrderStatus.AWAITING_PAYMENT, createdAt: staleAt() }],
      payments: [{ orderId: 'o1', status: PaymentStatus.PENDING }],
    });

    const cancelled = await cron.handle();

    expect(cancelled).toBe(1);
    expect(orders[0].status).toBe(OrderStatus.CANCELLED);
  });

  // FINDING B (cron cancels a paid order): in the rollback edge, a PAID-but-unplaced order
  // sits in AWAITING_PAYMENT. The pre-fix sweep — an unconditional UPDATE by status+createdAt
  // — would cancel it: money taken, order cancelled. It must be excluded.
  it('does NOT cancel a stale order whose payment is already PAID', async () => {
    const { cron, orders } = makeCron({
      orders: [{ id: 'o1', status: OrderStatus.AWAITING_PAYMENT, createdAt: staleAt() }],
      payments: [{ orderId: 'o1', status: PaymentStatus.PAID }],
    });

    const cancelled = await cron.handle();

    expect(cancelled).toBe(0);
    expect(orders[0].status).toBe(OrderStatus.AWAITING_PAYMENT);
  });

  it('does NOT cancel a stale order whose payment is REFUNDED or PARTIALLY_REFUNDED', async () => {
    for (const status of [PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED]) {
      const { cron, orders } = makeCron({
        orders: [{ id: 'o1', status: OrderStatus.AWAITING_PAYMENT, createdAt: staleAt() }],
        payments: [{ orderId: 'o1', status }],
      });

      const cancelled = await cron.handle();

      expect(cancelled).toBe(0);
      expect(orders[0].status).toBe(OrderStatus.AWAITING_PAYMENT);
    }
  });

  it('cancels only the unpaid stale orders and returns the correct count', async () => {
    const { cron, orders } = makeCron({
      orders: [
        { id: 'paid', status: OrderStatus.AWAITING_PAYMENT, createdAt: staleAt() },
        { id: 'unpaid1', status: OrderStatus.AWAITING_PAYMENT, createdAt: staleAt() },
        { id: 'unpaid2', status: OrderStatus.AWAITING_PAYMENT, createdAt: staleAt() },
        { id: 'fresh', status: OrderStatus.AWAITING_PAYMENT, createdAt: freshAt() },
      ],
      payments: [{ orderId: 'paid', status: PaymentStatus.PAID }],
    });

    const cancelled = await cron.handle();

    expect(cancelled).toBe(2);
    expect(orders.find((o) => o.id === 'paid')!.status).toBe(OrderStatus.AWAITING_PAYMENT);
    expect(orders.find((o) => o.id === 'unpaid1')!.status).toBe(OrderStatus.CANCELLED);
    expect(orders.find((o) => o.id === 'unpaid2')!.status).toBe(OrderStatus.CANCELLED);
    expect(orders.find((o) => o.id === 'fresh')!.status).toBe(OrderStatus.AWAITING_PAYMENT);
  });

  it('does nothing (returns 0) when there are no stale orders', async () => {
    const { cron } = makeCron({
      orders: [{ id: 'o1', status: OrderStatus.AWAITING_PAYMENT, createdAt: freshAt() }],
    });

    const cancelled = await cron.handle();

    expect(cancelled).toBe(0);
  });

  it('does not touch orders in other statuses', async () => {
    const { cron, orders } = makeCron({
      orders: [{ id: 'o1', status: OrderStatus.PLACED, createdAt: staleAt() }],
    });

    const cancelled = await cron.handle();

    expect(cancelled).toBe(0);
    expect(orders[0].status).toBe(OrderStatus.PLACED);
  });

  it('scopes the find to awaiting_payment orders older than the TTL cutoff', async () => {
    const { cron, orderRepo } = makeCron({
      orders: [{ id: 'o1', status: OrderStatus.AWAITING_PAYMENT, createdAt: staleAt() }],
    });
    const before = Date.now();

    await cron.handle();

    const where = orderRepo.find.mock.calls[0][0].where;
    expect(where.status).toBe(OrderStatus.AWAITING_PAYMENT);
    const cutoff = opVal(where.createdAt);
    const cutoffTime = cutoff instanceof Date ? cutoff.getTime() : new Date(cutoff).getTime();
    const expectedCutoff = before - UNPAID_ORDER_TTL_MINUTES * 60_000;
    expect(Math.abs(cutoffTime - expectedCutoff)).toBeLessThan(5000);
  });

  // Race-safety: the guarded UPDATE must re-check status = AWAITING_PAYMENT so an order paid
  // between our SELECT and our write is not clobbered to cancelled.
  it('re-checks status = awaiting_payment in the cancelling update', async () => {
    const { cron, orderRepo } = makeCron({
      orders: [{ id: 'o1', status: OrderStatus.AWAITING_PAYMENT, createdAt: staleAt() }],
    });

    await cron.handle();

    const criteria = orderRepo.update.mock.calls[0][0];
    expect(criteria.status).toBe(OrderStatus.AWAITING_PAYMENT);
    expect(orderRepo.update.mock.calls[0][1]).toEqual({ status: OrderStatus.CANCELLED });
  });

  it('uses a 30 minute TTL', () => {
    expect(UNPAID_ORDER_TTL_MINUTES).toBe(30);
  });
});
