# Admin Panel + Pricing/Currency + Search Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin layer (suppliers, markup, currency rates), convert supplier prices to KZT before markup, group search offers into per-(article+brand) cards sorted by price, enforce cart quantity against stock, gate everything by role — all exposed via REST API and surfaced in the throwaway `test-frontend`.

**Architecture:** A new `settings/` module stores admin-editable config (`app_settings` key-value table). `PricingService` gains currency conversion (FX rate + buffer, then markup), driven by `SettingsService` and a new `currency` field on each `SupplierOffer`. Search grouping normalizes brand/article casing. Cart exposes `maxQuantity` and validates against the last live `count`. Admin/manager endpoints are role-gated; `test-frontend` adds admin pages and nicer search/cart UI consuming those APIs.

**Tech Stack:** NestJS 10, TypeORM 0.3 (PostgreSQL), Jest, `@nestjs/swagger`, vanilla HTML/JS frontend.

## Global Constraints

- Prices to clients are always in KZT with markup applied; `costPrice`/`currency` are NEVER exposed in client-facing responses (only to ADMIN/MANAGER).
- Conversion order is fixed: convert cost to KZT (rate × (1 + buffer%)) FIRST, then apply markup.
- Markup source: `suppliers.markupPercent` if set, else `DEFAULT_MARKUP_PERCENT` from settings (env is only the seed/fallback).
- Every admin capability MUST have a REST endpoint (Swagger-annotated); the frontend never bypasses the API.
- Security is enforced on the backend via `RolesGuard` + `@Roles(...)`; the frontend only hides UI.
- Run `npm run build` and `npm test` before every commit; both must pass.
- Do NOT call any connector `placeOrder` during tests (no real partner orders).

---

## Task 1: `app_settings` entity + migration

**Files:**
- Create: `src/settings/entities/app-setting.entity.ts`
- Create: `src/migrations/1700000000013-CreateAppSettings.ts`
- Create: `src/settings/entities/app-setting.entity.spec.ts`
- Modify: `src/app.module.ts` (register entity), `src/config/data-source.ts` (register entity)

**Interfaces:**
- Produces: `AppSetting { key: string; value: unknown; updatedAt: Date }` (table `app_settings`).

- [ ] **Step 1: Write the failing test**

```ts
// src/settings/entities/app-setting.entity.spec.ts
import { AppSetting } from './app-setting.entity';

describe('AppSetting entity', () => {
  it('holds a key and a jsonb value', () => {
    const s = new AppSetting();
    s.key = 'FX_RATES';
    s.value = { RUB: 5.4 };
    expect(s.key).toBe('FX_RATES');
    expect((s.value as any).RUB).toBe(5.4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/settings/entities/app-setting.entity.spec.ts`
Expected: FAIL — cannot find module `./app-setting.entity`.

- [ ] **Step 3: Create the entity**

```ts
// src/settings/entities/app-setting.entity.ts
import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('app_settings')
export class AppSetting {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'jsonb' })
  value: unknown;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 4: Create the migration**

```ts
// src/migrations/1700000000013-CreateAppSettings.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAppSettings1700000000013 implements MigrationInterface {
  name = 'CreateAppSettings1700000000013';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "app_settings" (
        "key" character varying(100) NOT NULL,
        "value" jsonb NOT NULL,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_app_settings" PRIMARY KEY ("key")
      )
    `);
    await q.query(`
      INSERT INTO "app_settings" ("key","value") VALUES
        ('DEFAULT_MARKUP_PERCENT', '20'::jsonb),
        ('FX_RATES', '{"KZT":1}'::jsonb),
        ('FX_BUFFER_PERCENT', '0'::jsonb)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "app_settings"`);
  }
}
```

- [ ] **Step 5: Register the entity** in both `src/app.module.ts` (import `AppSetting`, add to the `entities: [...]` array) and `src/config/data-source.ts` (import + add to `entities: [...]`).

- [ ] **Step 6: Run build + test**

Run: `npm run build && npx jest src/settings/entities`
Expected: build OK, test PASS.

- [ ] **Step 7: Commit**

```bash
git add src/settings/entities src/migrations/1700000000013-CreateAppSettings.ts src/app.module.ts src/config/data-source.ts
git commit -m "feat(settings): add app_settings entity + migration"
```

---

## Task 2: `SettingsService` (read/write config with cache)

**Files:**
- Create: `src/settings/settings.service.ts`
- Create: `src/settings/settings.service.spec.ts`

**Interfaces:**
- Consumes: `AppSetting` entity (Task 1).
- Produces:
  - `SettingsService.getDefaultMarkup(): Promise<number>`
  - `SettingsService.getFxRates(): Promise<Record<string, number>>`
  - `SettingsService.getFxBufferPercent(): Promise<number>`
  - `SettingsService.getAll(): Promise<{ DEFAULT_MARKUP_PERCENT: number; FX_RATES: Record<string, number>; FX_BUFFER_PERCENT: number }>`
  - `SettingsService.update(patch: Partial<{ DEFAULT_MARKUP_PERCENT: number; FX_RATES: Record<string, number>; FX_BUFFER_PERCENT: number }>): Promise<void>` (invalidates cache)

- [ ] **Step 1: Write the failing test**

```ts
// src/settings/settings.service.spec.ts
import { SettingsService } from './settings.service';

function makeService(rows: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(rows));
  const repo = {
    find: jest.fn(async () => [...store].map(([key, value]) => ({ key, value }))),
    save: jest.fn(async (e: any) => { store.set(e.key, e.value); return e; }),
  };
  return { service: new SettingsService(repo as any), repo, store };
}

describe('SettingsService', () => {
  it('returns defaults when nothing stored', async () => {
    const { service } = makeService();
    expect(await service.getDefaultMarkup()).toBe(20);
    expect(await service.getFxRates()).toEqual({ KZT: 1 });
    expect(await service.getFxBufferPercent()).toBe(0);
  });

  it('reads stored values', async () => {
    const { service } = makeService({
      DEFAULT_MARKUP_PERCENT: 30,
      FX_RATES: { RUB: 5.4, KZT: 1 },
      FX_BUFFER_PERCENT: 2,
    });
    expect(await service.getDefaultMarkup()).toBe(30);
    expect((await service.getFxRates()).RUB).toBe(5.4);
    expect(await service.getFxBufferPercent()).toBe(2);
  });

  it('update writes rows and invalidates cache', async () => {
    const { service, repo } = makeService();
    await service.update({ DEFAULT_MARKUP_PERCENT: 25 });
    expect(repo.save).toHaveBeenCalled();
    expect(await service.getDefaultMarkup()).toBe(25);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/settings/settings.service.spec.ts`
Expected: FAIL — cannot find module `./settings.service`.

- [ ] **Step 3: Implement the service**

```ts
// src/settings/settings.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSetting } from './entities/app-setting.entity';

export interface AppSettings {
  DEFAULT_MARKUP_PERCENT: number;
  FX_RATES: Record<string, number>;
  FX_BUFFER_PERCENT: number;
}

const DEFAULTS: AppSettings = {
  DEFAULT_MARKUP_PERCENT: 20,
  FX_RATES: { KZT: 1 },
  FX_BUFFER_PERCENT: 0,
};

const CACHE_TTL_MS = 10_000;

@Injectable()
export class SettingsService {
  private cache: AppSettings | null = null;
  private cachedAt = 0;

  constructor(
    @InjectRepository(AppSetting)
    private readonly repo: Repository<AppSetting>,
  ) {}

  async getAll(): Promise<AppSettings> {
    if (this.cache && Date.now() - this.cachedAt < CACHE_TTL_MS) {
      return this.cache;
    }
    const rows = await this.repo.find();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const num = (k: keyof AppSettings, d: number) => {
      const v = Number(map.get(k as string));
      return Number.isFinite(v) ? v : d;
    };
    this.cache = {
      DEFAULT_MARKUP_PERCENT: num('DEFAULT_MARKUP_PERCENT', DEFAULTS.DEFAULT_MARKUP_PERCENT),
      FX_RATES:
        (map.get('FX_RATES') as Record<string, number>) ?? DEFAULTS.FX_RATES,
      FX_BUFFER_PERCENT: num('FX_BUFFER_PERCENT', DEFAULTS.FX_BUFFER_PERCENT),
    };
    this.cachedAt = Date.now();
    return this.cache;
  }

  async getDefaultMarkup(): Promise<number> {
    return (await this.getAll()).DEFAULT_MARKUP_PERCENT;
  }
  async getFxRates(): Promise<Record<string, number>> {
    return (await this.getAll()).FX_RATES;
  }
  async getFxBufferPercent(): Promise<number> {
    return (await this.getAll()).FX_BUFFER_PERCENT;
  }

  async update(patch: Partial<AppSettings>): Promise<void> {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      await this.repo.save({ key, value } as AppSetting);
    }
    this.cache = null;
  }
}
```

> NOTE: `Date.now()` is fine here — this is application code, not a workflow script.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/settings/settings.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/settings/settings.service.ts src/settings/settings.service.spec.ts
git commit -m "feat(settings): SettingsService with cache + defaults"
```

---

## Task 3: Settings controller + module + RBAC (`/api/settings`)

**Files:**
- Create: `src/settings/dto/update-settings.dto.ts`
- Create: `src/settings/settings.controller.ts`
- Create: `src/settings/settings.module.ts`
- Create: `src/settings/settings.controller.spec.ts`
- Modify: `src/app.module.ts` (import `SettingsModule`)

**Interfaces:**
- Consumes: `SettingsService` (Task 2), `AppSetting` entity (Task 1), existing `Roles` decorator `src/auth/decorators/roles.decorator.ts`, `UserRole` from `src/users/entities/user.entity.ts`.
- Produces: `GET /api/settings` (ADMIN) → `AppSettings`; `PUT /api/settings` (ADMIN) accepts `UpdateSettingsDto`.

- [ ] **Step 1: Write the failing controller test**

```ts
// src/settings/settings.controller.spec.ts
import { SettingsController } from './settings.controller';

describe('SettingsController', () => {
  const settings = {
    getAll: jest.fn(async () => ({ DEFAULT_MARKUP_PERCENT: 20, FX_RATES: { KZT: 1 }, FX_BUFFER_PERCENT: 0 })),
    update: jest.fn(async () => undefined),
  };
  const ctrl = new SettingsController(settings as any);

  it('GET returns all settings', async () => {
    expect(await ctrl.get()).toEqual({ DEFAULT_MARKUP_PERCENT: 20, FX_RATES: { KZT: 1 }, FX_BUFFER_PERCENT: 0 });
  });

  it('PUT updates then returns fresh settings', async () => {
    await ctrl.update({ DEFAULT_MARKUP_PERCENT: 25 } as any);
    expect(settings.update).toHaveBeenCalledWith({ DEFAULT_MARKUP_PERCENT: 25 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/settings/settings.controller.spec.ts`
Expected: FAIL — cannot find module `./settings.controller`.

- [ ] **Step 3: Create the DTO**

```ts
// src/settings/dto/update-settings.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsNumber, Min } from 'class-validator';

export class UpdateSettingsDto {
  @ApiPropertyOptional({ example: 20 })
  @IsOptional() @IsNumber() @Min(0)
  DEFAULT_MARKUP_PERCENT?: number;

  @ApiPropertyOptional({ example: { RUB: 5.4, USD: 480, KZT: 1 } })
  @IsOptional() @IsObject()
  FX_RATES?: Record<string, number>;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional() @IsNumber() @Min(0)
  FX_BUFFER_PERCENT?: number;
}
```

- [ ] **Step 4: Create the controller**

```ts
// src/settings/settings.controller.ts
import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService, AppSettings } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('settings')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get global settings (markup, FX rates, buffer)' })
  get(): Promise<AppSettings> {
    return this.settings.getAll();
  }

  @Put()
  @ApiOperation({ summary: 'Update global settings' })
  async update(@Body() dto: UpdateSettingsDto): Promise<AppSettings> {
    await this.settings.update(dto);
    return this.settings.getAll();
  }
}
```

- [ ] **Step 5: Create the module**

```ts
// src/settings/settings.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppSetting } from './entities/app-setting.entity';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AppSetting])],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
```

- [ ] **Step 6: Register `SettingsModule`** in `src/app.module.ts` imports array.

- [ ] **Step 7: Run build + tests**

Run: `npm run build && npx jest src/settings`
Expected: build OK, all settings tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/settings src/app.module.ts
git commit -m "feat(settings): /api/settings ADMIN endpoints + module"
```

---

## Task 4: `currency` on offers + suppliers; connectors set it

**Files:**
- Modify: `src/suppliers/types.ts` (add `currency` to `SupplierOffer`)
- Modify: `src/suppliers/entities/supplier.entity.ts` (add `currency` column)
- Create: `src/migrations/1700000000014-AddSupplierCurrency.ts`
- Modify: connectors: `rossko/rossko.connector.ts`, `tabys/tabys.connector.ts`, `shatem/shatem.connector.ts`, `autotrade/autotrade.connector.ts`
- Modify: `src/suppliers/dto/update-supplier.dto.ts` (allow `currency`), `src/suppliers/suppliers.service.ts` (persist `currency`)
- Modify connector spec files to assert `currency` where offers are built.

**Interfaces:**
- Produces: `SupplierOffer.currency: string`; `Supplier.currency: string | null`.

- [ ] **Step 1: Add `currency` to the type and a Rossko test expectation**

Edit `src/suppliers/types.ts`: add `currency: string;` to `SupplierOffer` (after `costPrice`).

In `src/suppliers/connectors/rossko/rossko.connector.spec.ts`, inside the existing `'maps each stock to a SupplierOffer'` test's `toMatchObject`, add `currency: 'RUB',`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/suppliers/connectors/rossko`
Expected: FAIL — received offer has no `currency`.

- [ ] **Step 3: Set `currency` in each connector's offer mapping**

In each connector, add `currency` to the pushed offer object:
- Rossko (`parseOffers`, the `offers.push({...})`): `currency: 'RUB',`
- Tabys (`mapOffers`): `currency: 'KZT',`
- SHATE-M (`mapOffers`): `currency: 'KZT',`
- Autotrade (`mapOffers`): `currency: String(entry?.currency ?? 'KZT'),` (uses response currency, e.g. RUB/KZT)
- Mock connector: offers built in tests already pass `currency` only where asserted; add `currency: 'KZT'` default in `src/suppliers/connectors/mock/mock.connector.ts` is NOT needed (tests construct offers directly). For cart/search specs that build offers via helpers, set `currency: 'KZT'` in those helper objects (`src/cart/cart.service.spec.ts` `makeOffer`, any search spec helper).

- [ ] **Step 4: Run connector tests**

Run: `npx jest src/suppliers/connectors`
Expected: PASS (Rossko now includes `currency: 'RUB'`).

- [ ] **Step 5: Add `currency` column to Supplier + migration**

Edit `src/suppliers/entities/supplier.entity.ts`: add
```ts
@Column({ type: 'varchar', length: 8, nullable: true })
currency: string | null;
```

```ts
// src/migrations/1700000000014-AddSupplierCurrency.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSupplierCurrency1700000000014 implements MigrationInterface {
  name = 'AddSupplierCurrency1700000000014';
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "suppliers" ADD "currency" character varying(8)`);
  }
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "suppliers" DROP COLUMN "currency"`);
  }
}
```
Register the migration is automatic (glob), but register the entity change needs no new import.

- [ ] **Step 6: Allow editing `currency`** — in `src/suppliers/dto/update-supplier.dto.ts` add optional `currency?: string` (`@IsOptional() @IsString()` + `@ApiPropertyOptional`); in `src/suppliers/suppliers.service.ts` `update()` add `if (dto.currency !== undefined) supplier.currency = dto.currency;`.

- [ ] **Step 7: Build + full test**

Run: `npm run build && npm test`
Expected: build OK, all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/suppliers src/migrations/1700000000014-AddSupplierCurrency.ts src/cart/cart.service.spec.ts
git commit -m "feat(suppliers): per-offer + per-supplier currency"
```

---

## Task 5: Pricing converts currency to KZT before markup

**Files:**
- Modify: `src/pricing/pricing.service.ts`, `src/pricing/pricing.module.ts` (import SettingsModule)
- Modify: `src/pricing/pricing.service.spec.ts`
- Modify callers: `src/search/search.service.ts` (pass `offer.currency`), `src/cart/cart.service.ts` (pass offer currency in re-check)

**Interfaces:**
- Consumes: `SettingsService` (Task 2), `Supplier.currency` (Task 4).
- Produces: `PricingService.applyMarkup(costPrice: number, supplierCode: string, currency?: string): Promise<number>` — converts `costPrice` (in `currency`, default KZT or supplier override) to KZT via `FX_RATES` × `(1 + FX_BUFFER_PERCENT/100)`, then applies markup.

- [ ] **Step 1: Rewrite the pricing test**

```ts
// src/pricing/pricing.service.spec.ts
import { PricingService } from './pricing.service';

function make(opts: {
  supplier?: { markupPercent?: number | null; currency?: string | null };
  rates?: Record<string, number>;
  buffer?: number;
  defaultMarkup?: number;
} = {}) {
  const suppliersService = {
    findByCode: jest.fn(async () => opts.supplier ?? { markupPercent: null, currency: null }),
  };
  const settings = {
    getFxRates: jest.fn(async () => opts.rates ?? { KZT: 1 }),
    getFxBufferPercent: jest.fn(async () => opts.buffer ?? 0),
    getDefaultMarkup: jest.fn(async () => opts.defaultMarkup ?? 20),
  };
  return new PricingService(suppliersService as any, settings as any);
}

describe('PricingService.applyMarkup', () => {
  it('KZT cost, default markup 20%', async () => {
    const p = make();
    expect(await p.applyMarkup(1000, 'x', 'KZT')).toBe(1200);
  });

  it('converts RUB to KZT (rate) then applies markup', async () => {
    const p = make({ rates: { RUB: 5, KZT: 1 }, supplier: { markupPercent: 10, currency: null } });
    // 100 RUB * 5 = 500 KZT; +10% = 550
    expect(await p.applyMarkup(100, 'x', 'RUB')).toBe(550);
  });

  it('applies FX buffer before markup', async () => {
    const p = make({ rates: { RUB: 5, KZT: 1 }, buffer: 10, supplier: { markupPercent: 0, currency: null } });
    // 100 * 5 * 1.10 = 550; +0% = 550
    expect(await p.applyMarkup(100, 'x', 'RUB')).toBe(550);
  });

  it('supplier currency override beats the offer currency', async () => {
    const p = make({ rates: { RUB: 5, KZT: 1 }, supplier: { markupPercent: 0, currency: 'RUB' } });
    expect(await p.applyMarkup(100, 'x', 'KZT')).toBe(500); // forced RUB
  });

  it('unknown currency falls back to rate 1', async () => {
    const p = make({ rates: { KZT: 1 }, supplier: { markupPercent: 0, currency: null } });
    expect(await p.applyMarkup(100, 'x', 'EUR')).toBe(100);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/pricing`
Expected: FAIL — constructor arity / behavior mismatch.

- [ ] **Step 3: Rewrite the service**

```ts
// src/pricing/pricing.service.ts
import { Injectable } from '@nestjs/common';
import { SuppliersService } from '../suppliers/suppliers.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class PricingService {
  constructor(
    private readonly suppliersService: SuppliersService,
    private readonly settings: SettingsService,
  ) {}

  async applyMarkup(
    costPrice: number,
    supplierCode: string,
    currency = 'KZT',
  ): Promise<number> {
    const supplier = await this.suppliersService.findByCode(supplierCode);
    const effectiveCurrency = supplier?.currency || currency || 'KZT';

    const rates = await this.settings.getFxRates();
    const rate = Number.isFinite(rates[effectiveCurrency])
      ? rates[effectiveCurrency]
      : 1;
    const buffer = await this.settings.getFxBufferPercent();
    const kzt = costPrice * rate * (1 + buffer / 100);

    const markup =
      supplier?.markupPercent != null
        ? Number(supplier.markupPercent)
        : await this.settings.getDefaultMarkup();

    return Math.round(kzt * (1 + markup / 100));
  }
}
```

- [ ] **Step 4: Import SettingsModule into PricingModule**

Edit `src/pricing/pricing.module.ts`: add `SettingsModule` to `imports` (import it from `../settings/settings.module`).

- [ ] **Step 5: Pass currency from callers**

- `src/search/search.service.ts` line ~117: `this.pricing.applyMarkup(offer.costPrice, offer.supplierCode, offer.currency)`.
- `src/cart/cart.service.ts` `recheckItem`: where it calls `this.pricing.applyMarkup(offer.costPrice, item.supplierCode)`, add `, offer.currency`.

- [ ] **Step 6: Run build + full test**

Run: `npm run build && npm test`
Expected: build OK, all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pricing src/search/search.service.ts src/cart/cart.service.ts
git commit -m "feat(pricing): convert offer currency to KZT before markup"
```

---

## Task 6: Search groups by normalized article+brand

**Files:**
- Modify: `src/search/search.service.ts` (`groupAndRank` key normalization)
- Modify: `src/search/search.service.spec.ts`

**Interfaces:**
- Consumes: existing `NormalizedOffer`, `groupAndRank`.
- Produces: groups keyed by `normalize(article)|normalize(brand)` where `normalize(s) = s.trim().toUpperCase()`; display keeps the first-seen original `article`/`brand`/`name`.

- [ ] **Step 1: Add a failing test**

```ts
// append to src/search/search.service.spec.ts (inside the existing describe or a new one)
it('merges same article+brand of different casing into one group', () => {
  const svc: any = service; // the SearchService instance under test
  const offers = [
    { article: '0451103316', brand: 'BOSCH', name: 'Filter', isAnalog: false,
      dto: { sellPrice: 200, deliveryDays: 1, count: 5 } },
    { article: '0451103316', brand: 'Bosch', name: 'Filter', isAnalog: false,
      dto: { sellPrice: 100, deliveryDays: 2, count: 9 } },
  ];
  const { exact } = svc.groupAndRank(offers);
  expect(exact).toHaveLength(1);
  expect(exact[0].offers).toHaveLength(2);
  expect(exact[0].offers[0].sellPrice).toBe(100); // cheapest first
});
```
> If `service` is not already constructed in this spec, construct one:
> `const service = new SearchService({} as any, {} as any, {} as any);`

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/search/search.service.spec.ts -t "different casing"`
Expected: FAIL — two groups instead of one.

- [ ] **Step 3: Normalize the grouping key**

In `groupAndRank`, replace the key line:
```ts
const key = `${offer.article.trim().toUpperCase()}|${offer.brand.trim().toUpperCase()}`;
```
(The stored `group.article/brand/name` stay as the first-seen original — no other change.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/search/search.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/search/search.service.ts src/search/search.service.spec.ts
git commit -m "feat(search): merge same article+brand across casing/suppliers"
```

---

## Task 7: Cart exposes `maxQuantity` and validates quantity

**Files:**
- Modify: `src/cart/cart.service.ts` (`getCart` item shape + `updateItem` validation)
- Modify: `src/cart/dto/cart-response.dto.ts` (add `maxQuantity`)
- Modify: `src/cart/cart.service.spec.ts`

**Interfaces:**
- Consumes: existing `recheckAll`/`getCart`.
- Produces: each `GET /api/cart` item gains `maxQuantity: number` (= re-check `count`, or `0` when unavailable). `updateItem(userId, itemId, quantity)` throws `BadRequestException` when `quantity > maxQuantity` or violates `multiplicity`.

- [ ] **Step 1: Write failing tests**

```ts
// append to src/cart/cart.service.spec.ts
it('getCart exposes maxQuantity from the live count', async () => {
  const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
    makeOffer({ count: 7, warehouseId: 'W1', raw: { offerKey: 'g|W1' } }),
  ]);
  const { service } = makeService({ items: [makeItem({ raw: { offerKey: 'g|W1' } })], connector });
  const res = await service.getCart('u1');
  expect(res.items[0].maxQuantity).toBe(7);
});

it('updateItem rejects quantity above maxQuantity', async () => {
  const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
    makeOffer({ count: 3, warehouseId: 'W1', raw: { offerKey: 'g|W1' } }),
  ]);
  const { service } = makeService({ items: [makeItem({ id: 'i1', raw: { offerKey: 'g|W1' } })], connector });
  await expect(service.updateItem('u1', 'i1', 5)).rejects.toThrow(/доступно|available/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/cart/cart.service.spec.ts -t "maxQuantity"`
Expected: FAIL — `maxQuantity` undefined / no validation.

- [ ] **Step 3: Add `maxQuantity` to the response**

In `cart.service.ts` `getCart`, in the `items.map`, add to the returned object: `maxQuantity: r.available ? r.item.quantity > r.count ? r.count : r.count : 0,` — simpler: compute `maxQuantity: r.available ? r.count : 0` where `r.count` is the re-check count. (Ensure `recheckItem`/`RecheckResult` carries `count`; if not, add `count: offer.count` to `RecheckResult` and the `unavailable()` fallback `count: 0`.)
Add `maxQuantity: number` to `CartItemDto` in `src/cart/dto/cart-response.dto.ts`.

- [ ] **Step 4: Validate in `updateItem`**

```ts
async updateItem(userId: string, itemId: string, quantity: number) {
  const cart = await this.getOrCreateCart(userId);
  const item = cart.items?.find((i) => i.id === itemId);
  if (!item) throw new NotFoundException('Cart item not found.');

  const [recheck] = await this.recheckAll([item]);
  const max = recheck?.available ? recheck.count : 0;
  if (quantity > max) {
    throw new BadRequestException(`Доступно ${max} шт.`);
  }
  const mult = this.toNumber((item.raw as any)?.multiplicity) || 1;
  if (mult > 1 && quantity % mult !== 0) {
    throw new BadRequestException(`Количество должно быть кратно ${mult}.`);
  }

  item.quantity = quantity;
  await this.itemRepo.save(item);
  return this.getCart(userId);
}
```
> Add `BadRequestException` to the `@nestjs/common` import. Add a private `toNumber` helper if not present. `RecheckResult` must include `count` — add it (Step 3).

- [ ] **Step 5: Run cart tests**

Run: `npx jest src/cart/cart.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Build + full test, commit**

```bash
npm run build && npm test
git add src/cart
git commit -m "feat(cart): expose maxQuantity and validate quantity vs stock"
```

---

## Task 8: RBAC review on admin/manager endpoints

**Files:**
- Modify (as needed): `src/orders/orders.controller.ts`, `src/partner-products/partner-products.controller.ts`, `src/search/search.controller.ts`, `src/suppliers/suppliers.controller.ts`
- Create: `src/auth/rbac.e2e-ish.spec.ts` (lightweight guard reasoning test is optional; prefer manual verification below)

**Interfaces:**
- Consumes: existing `@Roles`, `RolesGuard`, `UserRole`.
- Produces: confirmed role annotations:
  - ADMIN: `PATCH /api/suppliers/:code`, `GET/PUT /api/settings`.
  - MANAGER+ADMIN: order management (`/orders/all`, refresh-status, retry, return, status, comment), `GET /api/partner-products`.
  - Public: `GET /api/search`. USER: cart, own orders, `GET /api/search/history` (own).

- [ ] **Step 1: Audit annotations**

Run: `grep -rn "@Roles(" src --include=*.controller.ts`
Confirm each admin/manager route has the correct `@Roles(...)`. For any missing one (e.g. `/orders/all` should be `@Roles(UserRole.MANAGER, UserRole.ADMIN)`), add it.

- [ ] **Step 2: Add the missing annotations**

Apply `@Roles(UserRole.MANAGER, UserRole.ADMIN)` to manager-only order routes and `GET /api/partner-products` if not already present; `@Roles(UserRole.ADMIN)` to supplier mutation + settings (settings already from Task 3).

- [ ] **Step 3: Build + test**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 4: Manual verification**

With the local stack running (see Task 11), register a USER, call `GET /api/settings` with that token → expect `403`. Document the check in the commit message.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "chore(auth): confirm role gates on admin/manager endpoints"
```

---

## Task 9: Frontend — admin pages (suppliers, settings)

**Files:**
- Create: `test-frontend/admin/suppliers.html`, `test-frontend/admin/settings.html`
- Modify: `test-frontend/app.js` (role helper), `test-frontend/styles.css` (admin tables), `test-frontend/README.md`

**Interfaces:**
- Consumes: `GET /api/suppliers`, `PATCH /api/suppliers/:code`, `GET/PUT /api/settings`, `GET /api/auth/profile`.

- [ ] **Step 1: Add a role helper to `app.js`**

```js
async function getProfile() {
  try { return (await api('/api/auth/profile')).user; } catch { return null; }
}
function isAdmin(user) { return (user?.roles || []).includes('admin') || (user?.roles || []).includes('ADMIN'); }
```
> Confirm the role string casing returned by `GET /api/auth/profile` and match it (the `UserRole` enum values).

- [ ] **Step 2: Build `admin/suppliers.html`**

A table listing `GET /api/suppliers`: columns code, name, isActive (checkbox), markupPercent (input), currency (input). A "Save" button per row → `PATCH /api/suppliers/:code` with changed fields. Use `api()` from `app.js`. Show success/error via `showMsg`.

- [ ] **Step 3: Build `admin/settings.html`**

A form bound to `GET /api/settings`: `DEFAULT_MARKUP_PERCENT` (number), `FX_BUFFER_PERCENT` (number), and FX rate rows (currency + rate, e.g. RUB/USD/KZT). "Save" → `PUT /api/settings` with `{ DEFAULT_MARKUP_PERCENT, FX_BUFFER_PERCENT, FX_RATES }`.

- [ ] **Step 4: Gate the admin menu**

In the shared nav (rendered by `app.js`), show links to `admin/suppliers.html` and `admin/settings.html` only when `isAdmin(user)`.

- [ ] **Step 5: Manual smoke**

With the stack running and an ADMIN account: open `/test/admin/settings.html`, change markup to 25, save, reload → value persists; open `/test/admin/suppliers.html`, toggle a supplier off, save → `GET /api/suppliers` reflects it.

- [ ] **Step 6: Commit**

```bash
git add test-frontend
git commit -m "feat(test-frontend): admin pages for suppliers and settings"
```

---

## Task 10: Frontend — search cards + cart quantity UX

**Files:**
- Modify: `test-frontend/index.html` (card layout), `test-frontend/cart.html` (maxQuantity), `test-frontend/styles.css`

**Interfaces:**
- Consumes: `GET /api/search` (grouped), `GET /api/cart` (with `maxQuantity`), `PUT /api/cart/items/:id`.

- [ ] **Step 1: Render search as cards**

Replace the flat table in `index.html` with one card per group (`exact` then `analogs`): header `brand article — name` + analog badge; inside, a table of offers (already sorted by price): supplier, price (₸), delivery days, count, "В корзину". Add-to-cart sends the offer snapshot as today.

- [ ] **Step 2: Cart max-quantity UX**

In `cart.html`, show `maxQuantity` ("макс. N"); disable the "+" button when `quantity >= maxQuantity`; on quantity change call `PUT /api/cart/items/:id` and surface a `400` message (e.g. "Доступно N шт.") via `showMsg` without breaking the row.

- [ ] **Step 3: Minimal CSS**

Add card/badge styles to `styles.css` (border, padding, muted meta, green/red badges). Keep it minimal.

- [ ] **Step 4: Manual smoke**

Search a real article → cards render, offers sorted cheapest-first; add to cart; in cart, try to exceed `maxQuantity` → blocked with message.

- [ ] **Step 5: Commit**

```bash
git add test-frontend
git commit -m "feat(test-frontend): search cards + cart quantity UX"
```

---

## Task 11: Integration verification (local stack)

**Files:** none (verification only).

- [ ] **Step 1: Ensure settings seed + migrations**

With Postgres up and `NODE_ENV=development` (synchronize creates tables) OR after `npm run migration:run`, confirm `app_settings` has the three seed rows (or are created by SettingsService defaults).

- [ ] **Step 2: End-to-end pricing check**

Set `FX_RATES` `{ "RUB": 5, "KZT": 1 }` and `DEFAULT_MARKUP_PERCENT` 20 via `PUT /api/settings`. Search an article that returns a Rossko (RUB) offer; confirm `sellPrice` ≈ `costPrice × 5 × 1.2` (cost is internal; verify the relative magnitude is plausible, exact cost visible only to ADMIN).

- [ ] **Step 3: Cart guard check**

Add an offer to cart, open cart, attempt `PUT` quantity above `maxQuantity` → `400`.

- [ ] **Step 4: RBAC check**

USER token → `GET /api/settings` = 403; ADMIN token → 200.

- [ ] **Step 5: Final build + test + commit**

```bash
npm run build && npm test
git add -A
git commit -m "chore: admin panel + pricing feature verified locally"
```

---

## Self-review notes

- Spec §1 (settings/currency/markup) → Tasks 1–5. §2 (grouping) → Task 6. §3 (cart qty) → Task 7. §4 (RBAC) → Task 8. §5 (frontend) → Tasks 9–10. "Everything via API" → settings/suppliers endpoints (Tasks 3–4) consumed by frontend (Tasks 9–10). Verification → Task 11.
- Conversion-before-markup is implemented once in `PricingService.applyMarkup` (Task 5) and used by both search and cart.
- `costPrice`/`currency` remain out of client responses (search DTO already omits them; cart omits `costPrice`).
