import { UnpaidOrdersCron, UNPAID_ORDER_TTL_MINUTES } from './unpaid-orders.cron';
import { OrderStatus } from '../orders/entities/order.entity';

function makeCron(affected: number) {
  const orderRepo = {
    update: jest.fn(async () => ({ affected, raw: [], generatedMaps: [] })),
  };
  return { cron: new UnpaidOrdersCron(orderRepo as any), orderRepo };
}

describe('UnpaidOrdersCron', () => {
  it('cancels stale awaiting_payment orders via a guarded conditional update', async () => {
    const { cron, orderRepo } = makeCron(2);

    const cancelled = await cron.handle();

    expect(cancelled).toBe(2);
    expect(orderRepo.update).toHaveBeenCalledTimes(1);
    const call = orderRepo.update.mock.calls[0] as unknown as [any, any];
    const [criteria, patch] = call;
    // Guarded: only rows still in AWAITING_PAYMENT are affected, so an order paid
    // concurrently (moved out of AWAITING_PAYMENT by placeWithSuppliers) is untouched.
    expect(criteria.status).toBe(OrderStatus.AWAITING_PAYMENT);
    expect(criteria.createdAt).toBeDefined();
    expect(patch).toEqual({ status: OrderStatus.CANCELLED });
  });

  it('queries/updates only awaiting_payment orders older than the TTL cutoff', async () => {
    const { cron, orderRepo } = makeCron(0);
    const before = Date.now();

    await cron.handle();

    const call = orderRepo.update.mock.calls[0] as unknown as [any, any];
    const criteria = call[0];
    expect(criteria.status).toBe(OrderStatus.AWAITING_PAYMENT);
    const cutoff = criteria.createdAt.value ?? criteria.createdAt._value ?? criteria.createdAt;
    // Value wrapped by typeorm's LessThan(); just assert it is ~30 minutes before now.
    const cutoffTime = cutoff instanceof Date ? cutoff.getTime() : new Date(cutoff).getTime();
    const expectedCutoff = before - UNPAID_ORDER_TTL_MINUTES * 60_000;
    expect(Math.abs(cutoffTime - expectedCutoff)).toBeLessThan(5000);
  });

  it('does nothing (returns 0) when no rows match', async () => {
    const { cron, orderRepo } = makeCron(0);

    const cancelled = await cron.handle();

    expect(cancelled).toBe(0);
  });

  it('does not touch orders in other statuses (guarded by DB predicate)', async () => {
    // The predicate itself guarantees other statuses are never matched; here we just
    // confirm the update criteria always scopes to AWAITING_PAYMENT.
    const { cron, orderRepo } = makeCron(1);

    await cron.handle();

    const call = orderRepo.update.mock.calls[0] as unknown as [any, any];
    expect(call[0].status).toBe(OrderStatus.AWAITING_PAYMENT);
  });

  it('uses a 30 minute TTL', () => {
    expect(UNPAID_ORDER_TTL_MINUTES).toBe(30);
  });

  it('treats undefined affected as 0', async () => {
    const orderRepo = { update: jest.fn(async () => ({ affected: undefined, raw: [], generatedMaps: [] })) };
    const cron = new UnpaidOrdersCron(orderRepo as any);

    const cancelled = await cron.handle();

    expect(cancelled).toBe(0);
  });
});
