# WT-6 — Дашборд (Admin stats): real aggregating endpoint + front tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan. Each `### Task N` is a bite-sized, independently verifiable unit. Do them in order (backend Tasks 1→4 before front Tasks 5→6). Follow `superpowers:test-driven-development` for every backend task: write the failing `*.spec.ts` first, run it red, then implement to green.

## Goal
Replace the hardcoded numbers in the admin Dashboard with a real aggregating endpoint `GET /api/admin/stats` (`@Roles(ADMIN, MANAGER)`) and wire the front `DashboardTab` to it via `@tanstack/react-query`.

## Architecture
- **Backend** (NestJS 10 + TypeORM 0.3, Postgres): new module `src/admin-stats/` with a service that aggregates over already-existing tables (`orders`, `supplier_orders`, `search_log`, `suppliers`, `users`) and a controller guarded by `RolesGuard` + `@Roles(ADMIN, MANAGER)`. No new tables, no migrations.
- **Front** (`/home/mans/projects/Dana/front`, Vite + React + react-query + zustand): fill the WT-0 stub `src/lib/api/dashboardApi.ts` and rewrite `src/pages/admin/tabs/DashboardTab.tsx` to render live data.

## Tech Stack
- Backend tests: **jest** `*.spec.ts` (`npm test`, config `jest.config.js`, `rootDir: src`, `testRegex: .*\.spec\.ts$`). Mock repositories with plain `jest.fn()` objects (see existing `src/suppliers/suppliers.service.spec.ts`).
- Front: **no test runner** exists (`package.json` scripts: `dev`, `build`, `lint`=`tsc --noEmit`). Verify with `npm run lint` (i.e. `npx tsc --noEmit`) and a manual `npm run dev` smoke check. This is called out per task.

## Data reality (what metrics are backed by real data)
Investigated the schema. Findings:

| Dashboard tile (mock in `front/src/pages/Admin.tsx` `renderDashboard`) | Real source? | How |
|---|---|---|
| Заказы (сегодня) — count | ✅ REAL | `orders` where `createdAt >= todayStart AND isTest = false` |
| …на сумму ₸ | ✅ REAL | `SUM(orders.totalAmount)` over same set. **NB:** `Order.totalAmount` is a `decimal` **without** a transformer → TypeORM returns it as a **string**; coerce with `Number()`. |
| ↑ 12% со вчера | ✅ REAL (computed) | today count vs yesterday count; `null` when yesterday = 0 (no baseline) |
| Ошибки интеграции — count | ✅ REAL | `supplier_orders` where `status = 'FAILED' AND createdAt >= todayStart` |
| Последнее: `<msg>` | ✅ REAL | latest `supplier_orders` FAILED row → `{ supplierCode, errorMessage, createdAt }` |
| Успешность запросов % | ✅ REAL | `search_log` over last 7 days: `(Σ suppliersQueried − Σ suppliersFailed) / Σ suppliersQueried`; `null` when no queries |
| Активные поставщики | ✅ REAL | `suppliers` where `isActive = true` |
| Новых клиентов (сегодня) | ✅ REAL | `users` where `createdAt >= todayStart` |
| Доставлено сегодня | ⚠️ APPROX | `orders` where `status = 'delivered' AND updatedAt >= todayStart`. There is **no `deliveredAt` column**; `updatedAt` is the closest proxy. Documented as approximation. |
| Статус очереди («Норма») | ❌ NO SOURCE | No queue/job system exists in the codebase. Return the literal `'unknown'` with a `// TODO` naming the missing source. **Do not invent a table.** |

Everything except **queue status** is real; **delivered today** is a documented approximation via `updatedAt`.

## Global Constraints
- **`src/app.module.ts` is shared with WT-5 and WT-7** — Task 4 edits its `imports` array. This is a **trivial, expected merge conflict** at integration time: resolve by keeping all three modules in the `imports` list. Touch **only** the `imports` array and the one new `import` line; change nothing else.
- Do **not** touch `src/lib/api/index.ts` on the front — per WT-0 it already re-exports `dashboardApi`.
- Front HTTP goes through `apiRequest<T>(path, { token, method, body })`, imported as `import { apiRequest } from '../http';` (WT-0 contract). Do not add a second HTTP client.
- Endpoint contract is fixed: `GET /api/admin/stats`, `@Roles(UserRole.ADMIN, UserRole.MANAGER)`. Global prefix `api` is set in `main.ts`, so the controller is `@Controller('admin')` + `@Get('stats')`.
- No new dependencies, no DB migration.

## Response contract (single source of truth — used by both sides)
```ts
export interface AdminStatsResponse {
  ordersToday: {
    count: number;
    totalAmount: number;        // KZT, sum of Order.totalAmount (coerced from string)
    changePct: number | null;   // integer %, vs yesterday's count; null when no baseline
  };
  integrations: {
    errorsToday: number;
    successRate: number | null; // 0..100, 1 decimal; null when no search_log data in window
    lastError: {
      supplierCode: string;
      message: string;
      at: string;               // ISO timestamp
    } | null;
  };
  activeSuppliers: number;
  newCustomersToday: number;
  deliveredToday: number;       // APPROX via updatedAt (no deliveredAt column)
  queueStatus: 'ok' | 'unknown'; // always 'unknown' — no queue source (see TODO)
}
```

---

## BACKEND

### Task 1 — Response DTO / shape
**Files**
- create `src/admin-stats/dto/admin-stats.response.ts`

**Interfaces**: exactly the `AdminStatsResponse` above (plus its nested interfaces).

Steps:
- [ ] Create the file exporting the interface. Pure types only — no test needed for a type-only file (the shape is exercised by Task 2's spec).

```ts
// src/admin-stats/dto/admin-stats.response.ts
export interface AdminStatsOrdersToday {
  count: number;
  totalAmount: number;
  changePct: number | null;
}

export interface AdminStatsLastError {
  supplierCode: string;
  message: string;
  at: string;
}

export interface AdminStatsIntegrations {
  errorsToday: number;
  successRate: number | null;
  lastError: AdminStatsLastError | null;
}

export interface AdminStatsResponse {
  ordersToday: AdminStatsOrdersToday;
  integrations: AdminStatsIntegrations;
  activeSuppliers: number;
  newCustomersToday: number;
  deliveredToday: number;
  queueStatus: 'ok' | 'unknown';
}
```

---

### Task 2 — `AdminStatsService` (aggregation) + unit spec  ← TDD core
**Files**
- create `src/admin-stats/admin-stats.service.spec.ts` (write first, red)
- create `src/admin-stats/admin-stats.service.ts`

**Interfaces**
```ts
// pure helpers (exported for direct unit testing)
export function computeChangePct(today: number, yesterday: number): number | null;
export function computeSuccessRate(queried: number, failed: number): number | null;
export function dayBounds(now: Date): { todayStart: Date; yesterdayStart: Date; weekStart: Date };

@Injectable()
export class AdminStatsService {
  getStats(now?: Date): Promise<AdminStatsResponse>;
}
```
Constructor injects five repositories via `@InjectRepository`: `Order`, `SupplierOrder`, `Supplier`, `SearchLog`, `User`.

**Design notes (keep aggregation testable):**
- Extract pure math into `computeChangePct` and `computeSuccessRate` so they can be tested without repos.
- `getStats(now = new Date())` composes repo results. Use TypeORM `MoreThanOrEqual` / `Between` operators with `count()` / `find()` / `findOne()` — **no QueryBuilder** (keeps mocks trivial: mock objects with `count`, `find`, `findOne` jest.fns).
- `Order.totalAmount` returns as **string** → `Number(o.totalAmount)`.
- `deliveredToday` uses `updatedAt` (documented approximation).
- `queueStatus` is the literal `'unknown'` with a `// TODO` comment.

Steps:
- [ ] **Write the spec first** covering the pure helpers and `getStats` with mocked repos. Run `npm test -- admin-stats.service` → must fail (module doesn't exist yet).

```ts
// src/admin-stats/admin-stats.service.spec.ts
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
      count: jest.fn(async () => 3),
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
```

- [ ] Implement the service to green:

```ts
// src/admin-stats/admin-stats.service.ts
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
```

- [ ] Run `npm test -- admin-stats.service` → green. Verify no TS errors.

---

### Task 3 — `AdminStatsController` (RBAC) + controller spec
**Files**
- create `src/admin-stats/admin-stats.controller.spec.ts` (write first)
- create `src/admin-stats/admin-stats.controller.ts`

**Interfaces**: `@Controller('admin')` → `@Get('stats')` `getStats(): Promise<AdminStatsResponse>` delegating to `AdminStatsService.getStats()`.

Steps:
- [ ] Write a light controller spec (mirror `src/suppliers/suppliers.controller.spec.ts`): delegates to the service.

```ts
// src/admin-stats/admin-stats.controller.spec.ts
import { AdminStatsController } from './admin-stats.controller';

describe('AdminStatsController', () => {
  it('delegates to AdminStatsService.getStats', async () => {
    const stats = { activeSuppliers: 8 } as any;
    const svc = { getStats: jest.fn(async () => stats) };
    const controller = new AdminStatsController(svc as any);
    await expect(controller.getStats()).resolves.toBe(stats);
    expect(svc.getStats).toHaveBeenCalled();
  });
});
```

- [ ] Implement the controller. RBAC pattern copied from `src/suppliers/suppliers.controller.ts` (`@UseGuards(RolesGuard)` + `@Roles(...)`); the global `JwtAuthGuard` already runs app-wide, so `RolesGuard` alone is enough here.

```ts
// src/admin-stats/admin-stats.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { AdminStatsService } from './admin-stats.service';
import { AdminStatsResponse } from './dto/admin-stats.response';

@ApiTags('admin-stats')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(RolesGuard)
export class AdminStatsController {
  constructor(private readonly adminStats: AdminStatsService) {}

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('stats')
  @ApiOperation({
    summary: 'Сводная статистика для дашборда админ-панели (админ/менеджер)',
    description:
      'Агрегаты за сегодня: заказы (кол-во, сумма, динамика ко вчера), ошибки интеграций и ' +
      'успешность запросов к поставщикам, число активных поставщиков, новых клиентов и ' +
      'доставленных заказов. Доступно администратору и менеджеру.',
  })
  @ApiResponse({ status: 403, description: 'Только для администратора или менеджера.' })
  getStats(): Promise<AdminStatsResponse> {
    return this.adminStats.getStats();
  }
}
```

- [ ] Run `npm test -- admin-stats.controller` → green.

---

### Task 4 — Module + register in `AppModule`  ⚠️ shared-file merge point
**Files**
- create `src/admin-stats/admin-stats.module.ts`
- edit `src/app.module.ts` (**shared with WT-5/WT-7 — trivial conflict; keep all modules**)

Steps:
- [ ] Create the module. Register the five entities it reads via `TypeOrmModule.forFeature` so their repositories are injectable.

```ts
// src/admin-stats/admin-stats.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../orders/entities/order.entity';
import { SupplierOrder } from '../orders/entities/supplier-order.entity';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { SearchLog } from '../search/entities/search-log.entity';
import { User } from '../users/entities/user.entity';
import { AdminStatsService } from './admin-stats.service';
import { AdminStatsController } from './admin-stats.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, SupplierOrder, Supplier, SearchLog, User]),
  ],
  controllers: [AdminStatsController],
  providers: [AdminStatsService],
})
export class AdminStatsModule {}
```

- [ ] In `src/app.module.ts`: add `import { AdminStatsModule } from './admin-stats/admin-stats.module';` next to the other module imports, and add `AdminStatsModule` to the `imports` array (alongside `CatalogModule`). **Change nothing else.** At merge time with WT-5/WT-7, keep every module in the list.
- [ ] Run full `npm test` → all green. Optionally `npm run build` to confirm Nest wiring compiles.

---

## FRONT

> WT-0 has already scaffolded `src/lib/api/dashboardApi.ts` (empty stub), `src/pages/admin/tabs/DashboardTab.tsx`, `src/lib/api/index.ts` (re-exports `dashboardApi` — **do not touch**), and `src/http.ts` (`apiRequest`). If any is missing, WT-0 is not merged yet — stop and flag. No front test runner: verify with `npm run lint` (`tsc --noEmit`) + manual `npm run dev`.

### Task 5 — `dashboardApi`
**Files**
- edit `src/lib/api/dashboardApi.ts`

**Interfaces**
```ts
export interface AdminStatsResponse { /* identical to backend contract above */ }
export const dashboardApi = {
  get(token: string): Promise<AdminStatsResponse>;
};
```

Steps:
- [ ] Implement using the WT-0 HTTP client. Import path is `../http` per the WT-0 contract.

```ts
// src/lib/api/dashboardApi.ts
import { apiRequest } from '../http';

export interface AdminStatsResponse {
  ordersToday: { count: number; totalAmount: number; changePct: number | null };
  integrations: {
    errorsToday: number;
    successRate: number | null;
    lastError: { supplierCode: string; message: string; at: string } | null;
  };
  activeSuppliers: number;
  newCustomersToday: number;
  deliveredToday: number;
  queueStatus: 'ok' | 'unknown';
}

export const dashboardApi = {
  get(token: string): Promise<AdminStatsResponse> {
    return apiRequest<AdminStatsResponse>('/api/admin/stats', { token });
  },
};
```

- [ ] `npm run lint` → no errors. (If the WT-0 `apiRequest` signature differs, e.g. no default GET, add `method: 'GET'`.)

---

### Task 6 — `DashboardTab` on real data
**Files**
- edit `src/pages/admin/tabs/DashboardTab.tsx`

**Interfaces**: `export const DashboardTab: React.FC` — no props (matches WT-0 tab convention). Data via `useQuery`, token via `useAuthStore(s => s.accessToken)`.

Steps:
- [ ] Rewrite the tab to fetch and render live stats, preserving the mock's markup/classes (from `front/src/pages/Admin.tsx` `renderDashboard`) but binding every number to `AdminStatsResponse`. Handle loading / error / null-field states. Format currency and the derived tiles.

```tsx
// src/pages/admin/tabs/DashboardTab.tsx
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShoppingCart, XCircle } from 'lucide-react';
import { dashboardApi } from '../../../lib/api/dashboardApi';
import { useAuthStore } from '../../../authStore';

const fmtKzt = (n: number) => `${n.toLocaleString('ru-RU')} ₸`;

export const DashboardTab: React.FC = () => {
  const token = useAuthStore((s) => s.accessToken);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => dashboardApi.get(token as string),
    enabled: !!token,
  });

  if (isLoading) return <div className="text-slate-500 text-[14px]">Загрузка статистики…</div>;
  if (isError || !data) return <div className="text-red-500 text-[14px]">Не удалось загрузить статистику</div>;

  const { ordersToday, integrations, activeSuppliers, newCustomersToday, deliveredToday, queueStatus } = data;
  const successBar = integrations.successRate ?? 0;

  return (
    <div>
      <h2 className="text-[18px] font-bold text-slate-900 mb-6 border-l-4 border-orange-500 pl-3">Общая статистика</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Заказы */}
        <div className="bg-white border border-slate-200 rounded-lg p-6 hover:border-orange-500 transition-colors">
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Заказы (сегодня)</div>
              <div className="text-[36px] font-bold text-slate-900 leading-none">{ordersToday.count}</div>
            </div>
            <div className="w-12 h-12 bg-orange-50 text-orange-500 rounded-full flex items-center justify-center">
              <ShoppingCart size={24} />
            </div>
          </div>
          <div className="flex gap-4 text-[13px]">
            {ordersToday.changePct !== null && (
              <div className={`font-bold flex items-center gap-1 ${ordersToday.changePct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {ordersToday.changePct >= 0 ? '↑' : '↓'} {Math.abs(ordersToday.changePct)}% со вчера
              </div>
            )}
            <div className="text-slate-500">На сумму {fmtKzt(ordersToday.totalAmount)}</div>
          </div>
        </div>

        {/* Интеграции */}
        <div className="bg-white border border-slate-200 rounded-lg p-6 hover:border-red-500 transition-colors">
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Ошибки интеграции</div>
              <div className="text-[36px] font-bold text-slate-900 leading-none">{integrations.errorsToday}</div>
            </div>
            <div className="w-12 h-12 bg-red-50 text-red-500 rounded-full flex items-center justify-center">
              <XCircle size={24} />
            </div>
          </div>
          {integrations.lastError && (
            <div className="text-[13px] text-slate-600 mb-2">
              Последнее: <span className="font-mono text-[11px] bg-slate-100 px-1 py-0.5 rounded text-red-600">{integrations.lastError.message}</span>
            </div>
          )}
          <div className="w-full bg-slate-100 rounded-full h-1.5 mb-1 mt-3">
            <div className="bg-red-500 h-1.5 rounded-full" style={{ width: `${100 - successBar}%` }}></div>
          </div>
          <div className="text-[11px] text-slate-500 text-right">
            Успешность запросов: {integrations.successRate !== null ? `${integrations.successRate}%` : '—'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Активные поставщики</div>
          <div className="text-[28px] font-bold text-slate-900">{activeSuppliers}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Статус очереди</div>
          <div className="text-[28px] font-bold text-slate-400">{queueStatus === 'ok' ? 'Норма' : 'н/д'}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Новых клиентов</div>
          <div className="text-[28px] font-bold text-slate-900">{newCustomersToday}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Доставлено сегодня</div>
          <div className="text-[28px] font-bold text-slate-900">{deliveredToday}</div>
        </div>
      </div>
    </div>
  );
};
```

- [ ] `npm run lint` (`tsc --noEmit`) → clean. Confirm the `useAuthStore` import path matches the repo (`../../../authStore`) and the selector is `s.accessToken`.
- [ ] Manual smoke: `npm run dev`, log in as admin/manager, open the Dashboard tab, confirm live numbers render (not the old hardcoded 156/3/8/24/92) and that a 403 for a plain user is handled by the error branch.

---

## Self-Review
- [ ] **Contract stable**: endpoint is exactly `GET /api/admin/stats`, `@Roles(ADMIN, MANAGER)`; `dashboardApi.get(token)` returns `AdminStatsResponse`; the response interface is byte-identical on both sides.
- [ ] **Only real data**: every metric maps to an existing table (`orders`, `supplier_orders`, `search_log`, `suppliers`, `users`). No invented tables.
- [ ] **Documented gaps**: `queueStatus` is `'unknown'` with a `// TODO(source)`; `deliveredToday` is a documented `updatedAt` approximation (no `deliveredAt` column). Both are explicit, no silent placeholders.
- [ ] **Decimal coercion**: `Order.totalAmount` (string from DB, no transformer) is `Number()`-coerced — verified by the `totalAmount: 450000.5` assertion.
- [ ] **Null-safety**: `changePct` null when no yesterday baseline; `successRate` null when no logs; `lastError` null when no failures. Front renders all three null states.
- [ ] **RBAC**: `RolesGuard` + `@Roles(ADMIN, MANAGER)` (global `JwtAuthGuard` already enforces auth). A plain USER gets 403 → front error branch.
- [ ] **Shared file**: `src/app.module.ts` touched only in the `imports` array + one import line; flagged as a trivial WT-5/WT-7 merge conflict (keep all modules).
- [ ] **Untouched**: `src/lib/api/index.ts` not modified (WT-0 owns it).
- [ ] **Verification**: backend `npm test` all green; front `npm run lint` clean + manual `npm run dev` dashboard smoke.

### Task count: 6 (Tasks 1–4 backend, Tasks 5–6 front).
