import {
  AdminStatsService,
  computeChangePct,
  computeSuccessRate,
  dayBounds,
} from './admin-stats.service';
import { OrderStatus } from '../orders/entities/order.entity';

describe('computeChangePct', () => {
  it('returns null when yesterday has no baseline', () => {
    expect(computeChangePct(5, 0)).toBeNull();
  });
  it('returns a rounded integer percent delta', () => {
    expect(computeChangePct(112, 100)).toBe(12);
    expect(computeChangePct(90, 100)).toBe(-10);
  });
});

describe('computeSuccessRate', () => {
  it('returns null when nothing was queried', () => {
    expect(computeSuccessRate(0, 0)).toBeNull();
  });
  it('returns a 0..100 rate with one decimal', () => {
    expect(computeSuccessRate(1000, 2)).toBe(99.8);
    expect(computeSuccessRate(4, 1)).toBe(75);
  });
});

describe('dayBounds', () => {
  it('todayStart is midnight, yesterdayStart is 24h earlier, weekStart 7d earlier', () => {
    const now = new Date('2026-07-03T15:30:00.000Z');
    const { todayStart, yesterdayStart, weekStart } = dayBounds(now);
    expect(todayStart.getHours()).toBe(0);
    expect(todayStart.getMinutes()).toBe(0);
    expect(now.getTime() - yesterdayStart.getTime()).toBeGreaterThan(
      now.getTime() - todayStart.getTime(),
    );
    expect(todayStart.getTime() - yesterdayStart.getTime()).toBe(24 * 3600 * 1000);
    expect(todayStart.getTime() - weekStart.getTime()).toBe(6 * 24 * 3600 * 1000);
  });
});

describe('AdminStatsService.getStats', () => {
  function make() {
    const orderRepo = {
      // ordersToday.find (returns array with string totalAmount like the DB)
      find: jest.fn(async () => [
        { totalAmount: '250000.00' },
        { totalAmount: '200000.50' },
      ]),
      // called for yesterday count AND deliveredToday count
      count: jest.fn(async () => 100),
    };
    const supplierOrderRepo = {
      // FAILED -> errorsToday (3); SENDING -> stuckSending (2); honest per-status counts.
      count: jest.fn(async (opts: any = {}) =>
        opts?.where?.status === 'SENDING' ? 2 : 3,
      ),
      findOne: jest.fn(async () => ({
        supplierCode: 'globalspares',
        errorMessage: 'Timeout globalspares.net',
        createdAt: new Date('2026-07-03T10:00:00.000Z'),
      })),
    };
    const supplierRepo = { count: jest.fn(async () => 8) };
    const searchLogRepo = {
      find: jest.fn(async () => [
        { suppliersQueried: 600, suppliersFailed: 1 },
        { suppliersQueried: 400, suppliersFailed: 1 },
      ]),
    };
    const userRepo = { count: jest.fn(async () => 24) };
    const svc = new AdminStatsService(
      orderRepo as any,
      supplierOrderRepo as any,
      supplierRepo as any,
      searchLogRepo as any,
      userRepo as any,
    );
    return { svc, orderRepo, supplierOrderRepo, supplierRepo, searchLogRepo, userRepo };
  }

  it('aggregates all metrics from the repositories', async () => {
    const { svc } = make();
    const res = await svc.getStats(new Date('2026-07-03T15:30:00.000Z'));

    expect(res.ordersToday.count).toBe(2);
    expect(res.ordersToday.totalAmount).toBe(450000.5); // coerced from string
    expect(res.ordersToday.changePct).toBe(-98); // 2 vs 100

    expect(res.integrations.errorsToday).toBe(3);
    // Ambiguous SENDING rows (money taken, outcome unknown) surface in their own counter so
    // ops actually notice them.
    expect(res.integrations.stuckSending).toBe(2);
    expect(res.integrations.successRate).toBe(99.8); // (1000-2)/1000
    expect(res.integrations.lastError).toEqual({
      supplierCode: 'globalspares',
      message: 'Timeout globalspares.net',
      at: '2026-07-03T10:00:00.000Z',
    });

    expect(res.activeSuppliers).toBe(8);
    expect(res.newCustomersToday).toBe(24);
    expect(res.deliveredToday).toBe(100);
    expect(res.queueStatus).toBe('unknown');
  });

  it('returns null lastError and null successRate when there is no data', async () => {
    const { svc, supplierOrderRepo, searchLogRepo } = make();
    supplierOrderRepo.findOne.mockResolvedValueOnce(null);
    searchLogRepo.find.mockResolvedValueOnce([]);
    const res = await svc.getStats();
    expect(res.integrations.lastError).toBeNull();
    expect(res.integrations.successRate).toBeNull();
  });

  it('queries deliveredToday with the DELIVERED status', async () => {
    const { svc, orderRepo } = make();
    await svc.getStats();
    const deliveredCall = orderRepo.count.mock.calls.find(
      ([arg]: any[]) => arg?.where?.status === OrderStatus.DELIVERED,
    );
    expect(deliveredCall).toBeDefined();
  });
});
