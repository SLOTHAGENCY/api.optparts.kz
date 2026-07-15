import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, MoreThanOrEqual, Repository } from 'typeorm';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { SupplierOrder } from '../orders/entities/supplier-order.entity';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { SearchLog } from '../search/entities/search-log.entity';
import { User } from '../users/entities/user.entity';
import { AdminStatsResponse } from './dto/admin-stats.response';

/** Integer % change of `today` relative to `yesterday`; null when no baseline. */
export function computeChangePct(today: number, yesterday: number): number | null {
  if (yesterday <= 0) return null;
  return Math.round(((today - yesterday) / yesterday) * 100);
}

/** Success rate 0..100 (1 decimal) of provider requests; null when none queried. */
export function computeSuccessRate(queried: number, failed: number): number | null {
  if (queried <= 0) return null;
  const rate = ((queried - failed) / queried) * 100;
  return Math.round(rate * 10) / 10;
}

/** Local-day boundaries derived from `now`. */
export function dayBounds(now: Date): {
  todayStart: Date;
  yesterdayStart: Date;
  weekStart: Date;
} {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 3600 * 1000);
  const weekStart = new Date(todayStart.getTime() - 6 * 24 * 3600 * 1000);
  return { todayStart, yesterdayStart, weekStart };
}

@Injectable()
export class AdminStatsService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(SupplierOrder)
    private readonly supplierOrderRepo: Repository<SupplierOrder>,
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
    @InjectRepository(SearchLog)
    private readonly searchLogRepo: Repository<SearchLog>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async getStats(now: Date = new Date()): Promise<AdminStatsResponse> {
    const { todayStart, yesterdayStart, weekStart } = dayBounds(now);

    // --- Orders today (exclude test-mode orders) ---
    const todayOrders = await this.orderRepo.find({
      where: { isTest: false, createdAt: MoreThanOrEqual(todayStart) },
      select: { totalAmount: true },
    });
    const ordersTodayCount = todayOrders.length;
    // Order.totalAmount is a decimal WITHOUT a transformer -> comes back as string.
    const ordersTodayTotal = todayOrders.reduce(
      (sum, o) => sum + Number(o.totalAmount),
      0,
    );
    const ordersYesterdayCount = await this.orderRepo.count({
      where: { isTest: false, createdAt: Between(yesterdayStart, todayStart) },
    });

    // --- Integrations ---
    const errorsToday = await this.supplierOrderRepo.count({
      where: { status: 'FAILED' as any, createdAt: MoreThanOrEqual(todayStart) },
    });
    // Ambiguous rows: a send that reached SENDING and never got a saved outcome (money taken,
    // supplier maybe has the order). Counted across all time — a stuck row is a standing
    // liability until an admin resolves it, so ops must see it even days later.
    const stuckSending = await this.supplierOrderRepo.count({
      where: { status: 'SENDING' as any },
    });
    const lastFailed = await this.supplierOrderRepo.findOne({
      where: { status: 'FAILED' as any },
      order: { createdAt: 'DESC' },
    });
    const logs = await this.searchLogRepo.find({
      where: { createdAt: MoreThanOrEqual(weekStart) },
      select: { suppliersQueried: true, suppliersFailed: true },
    });
    const queried = logs.reduce((s, l) => s + l.suppliersQueried, 0);
    const failed = logs.reduce((s, l) => s + l.suppliersFailed, 0);

    // --- Small tiles ---
    const activeSuppliers = await this.supplierRepo.count({
      where: { isActive: true },
    });
    const newCustomersToday = await this.userRepo.count({
      where: { createdAt: MoreThanOrEqual(todayStart) },
    });
    // APPROX: no deliveredAt column — use updatedAt as the delivery timestamp proxy.
    const deliveredToday = await this.orderRepo.count({
      where: {
        status: OrderStatus.DELIVERED,
        updatedAt: MoreThanOrEqual(todayStart),
      },
    });

    return {
      ordersToday: {
        count: ordersTodayCount,
        totalAmount: ordersTodayTotal,
        changePct: computeChangePct(ordersTodayCount, ordersYesterdayCount),
      },
      integrations: {
        errorsToday,
        stuckSending,
        successRate: computeSuccessRate(queried, failed),
        lastError: lastFailed
          ? {
              supplierCode: lastFailed.supplierCode,
              message: lastFailed.errorMessage ?? 'Unknown error',
              at: lastFailed.createdAt.toISOString(),
            }
          : null,
      },
      activeSuppliers,
      newCustomersToday,
      deliveredToday,
      // TODO(source): no queue/job system exists yet. Wire to a real queue-health
      // source when one is introduced; until then this is always 'unknown'.
      queueStatus: 'unknown',
    };
  }
}
