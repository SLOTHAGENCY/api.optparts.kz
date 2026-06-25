# Spec Gap Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining spec gaps: brand-level markup (§11), search result filters + article-writing normalization (§10), and admin-managed supplier API config — URL, encrypted API key, timeout, rate limit (§9).

**Architecture:** Extend the existing NestJS + TypeORM (Postgres) backend. New `BrandMarkup` entity feeds `PricingService`; a `SearchFilterDto` filters the already-built search groups; a `normalizeArticle` util canonicalizes group keys; the `Supplier` entity gains `timeoutMs`, `rateLimitRpm`, and an AES-256-GCM-encrypted `secretsEnc` blob, all surfaced through the existing `PATCH /suppliers/:code` admin endpoint and consumed via `resolveConfig`.

**Tech Stack:** NestJS 10, TypeORM 0.3, PostgreSQL 15, class-validator, axios, Jest + ts-jest. Node `crypto` for encryption (no new deps).

## Global Constraints

- Tests are colocated `*.spec.ts`; run with `npx jest <path>`.
- Migrations are hand-written under `src/migrations/NNN-Name.ts`, registered automatically by glob `dist/migrations/*.js`; numbering continues from `1700000000015`. Next free numbers start at `1700000000016`.
- Every new entity MUST be added to the `entities: [...]` array in `src/app.module.ts:48`.
- API keys/secrets MUST NOT be stored in the DB in plaintext (spec §18) — use the `CryptoService`.
- Admin-only mutations use `@Roles(UserRole.ADMIN)` + `RolesGuard` (already wired in `SuppliersController`).
- `decimalTransformer` (exported from `src/suppliers/entities/supplier.entity.ts`) converts TypeORM decimal strings to `number|null` — reuse it for any decimal column.
- TypeORM decimal columns come back as strings; always wrap reads in `Number(...)`.

---

### Task 1: BrandMarkup entity, migration, service, admin controller (§11 storage)

**Files:**
- Create: `src/pricing/entities/brand-markup.entity.ts`
- Create: `src/migrations/1700000000016-CreateBrandMarkups.ts`
- Create: `src/pricing/dto/upsert-brand-markup.dto.ts`
- Create: `src/pricing/brand-markup.service.ts`
- Create: `src/pricing/brand-markup.controller.ts`
- Create: `src/pricing/brand-markup.service.spec.ts`
- Modify: `src/pricing/pricing.module.ts`
- Modify: `src/app.module.ts:48` (entities array)

**Interfaces:**
- Produces: `BrandMarkup { id: string; brand: string; markupPercent: number }`
- Produces: `BrandMarkupService.findPercentByBrand(brand: string): Promise<number | null>` — normalized (UPPERCASE+trim) lookup, returns `null` when no row.
- Produces: `BrandMarkupService.findAll(): Promise<BrandMarkup[]>`, `upsert(brand: string, markupPercent: number): Promise<BrandMarkup>`, `remove(brand: string): Promise<void>`

- [ ] **Step 1: Write the entity**

```typescript
// src/pricing/entities/brand-markup.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { decimalTransformer } from '../../suppliers/entities/supplier.entity';

@Entity('brand_markups')
export class BrandMarkup {
  @ApiProperty({ example: 'b3f1...uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'BOSCH', description: 'Stored uppercased/trimmed; unique' })
  @Column({ unique: true, length: 100 })
  brand: string;

  @ApiProperty({ example: 25, description: 'Markup percent applied to offers of this brand' })
  @Column({ type: 'decimal', precision: 6, scale: 2, transformer: decimalTransformer })
  markupPercent: number;

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
```

- [ ] **Step 2: Write the migration**

```typescript
// src/migrations/1700000000016-CreateBrandMarkups.ts
import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateBrandMarkups1700000000016 implements MigrationInterface {
  name = 'CreateBrandMarkups1700000000016';
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "brand_markups" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "brand" character varying(100) NOT NULL,
        "markupPercent" numeric(6,2) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_brand_markups_brand" UNIQUE ("brand"),
        CONSTRAINT "PK_brand_markups" PRIMARY KEY ("id")
      )`);
  }
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "brand_markups"`);
  }
}
```

- [ ] **Step 3: Write the DTO**

```typescript
// src/pricing/dto/upsert-brand-markup.dto.ts
import { IsNumber, IsString, Max, Min, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpsertBrandMarkupDto {
  @ApiProperty({ example: 'BOSCH' })
  @IsString() @MinLength(1)
  brand: string;

  @ApiProperty({ example: 25, minimum: 0, maximum: 1000 })
  @IsNumber() @Min(0) @Max(1000)
  markupPercent: number;
}
```

- [ ] **Step 4: Write the failing service test**

```typescript
// src/pricing/brand-markup.service.spec.ts
import { BrandMarkupService } from './brand-markup.service';

function make(rows: any[] = []) {
  const repo = {
    find: jest.fn(async () => rows),
    findOne: jest.fn(async ({ where: { brand } }: any) =>
      rows.find((r) => r.brand === brand) ?? null),
    save: jest.fn(async (r: any) => r),
    delete: jest.fn(async () => ({ affected: 1 })),
  };
  return { svc: new BrandMarkupService(repo as any), repo };
}

describe('BrandMarkupService', () => {
  it('findPercentByBrand normalizes case and trim', async () => {
    const { svc } = make([{ brand: 'BOSCH', markupPercent: 25 }]);
    expect(await svc.findPercentByBrand('  bosch ')).toBe(25);
  });

  it('findPercentByBrand returns null when no row', async () => {
    const { svc } = make([]);
    expect(await svc.findPercentByBrand('MANN')).toBeNull();
  });

  it('upsert stores brand uppercased', async () => {
    const { svc, repo } = make([]);
    await svc.upsert(' bosch ', 25);
    expect(repo.save).toHaveBeenCalledWith({ brand: 'BOSCH', markupPercent: 25 });
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx jest src/pricing/brand-markup.service.spec.ts`
Expected: FAIL — cannot find module `./brand-markup.service`.

- [ ] **Step 6: Write the service**

```typescript
// src/pricing/brand-markup.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BrandMarkup } from './entities/brand-markup.entity';

function normBrand(brand: string): string {
  return (brand ?? '').trim().toUpperCase();
}

@Injectable()
export class BrandMarkupService {
  constructor(
    @InjectRepository(BrandMarkup)
    private readonly repo: Repository<BrandMarkup>,
  ) {}

  findAll(): Promise<BrandMarkup[]> {
    return this.repo.find();
  }

  async findPercentByBrand(brand: string): Promise<number | null> {
    const row = await this.repo.findOne({ where: { brand: normBrand(brand) } });
    return row ? Number(row.markupPercent) : null;
  }

  async upsert(brand: string, markupPercent: number): Promise<BrandMarkup> {
    const key = normBrand(brand);
    const existing = await this.repo.findOne({ where: { brand: key } });
    if (existing) {
      existing.markupPercent = markupPercent;
      return this.repo.save(existing);
    }
    return this.repo.save({ brand: key, markupPercent } as BrandMarkup);
  }

  async remove(brand: string): Promise<void> {
    await this.repo.delete({ brand: normBrand(brand) });
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx jest src/pricing/brand-markup.service.spec.ts`
Expected: PASS (3 tests). Note: the `upsert` test asserts `save` called with `{ brand: 'BOSCH', markupPercent: 25 }`; the service passes that object literal when no existing row.

- [ ] **Step 8: Write the controller**

```typescript
// src/pricing/brand-markup.controller.ts
import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { BrandMarkupService } from './brand-markup.service';
import { UpsertBrandMarkupDto } from './dto/upsert-brand-markup.dto';

@ApiTags('pricing')
@ApiBearerAuth()
@Controller('pricing/brand-markups')
@UseGuards(RolesGuard)
export class BrandMarkupController {
  constructor(private readonly service: BrandMarkupService) {}

  @Roles(UserRole.ADMIN)
  @Get()
  @ApiOperation({ summary: 'List brand markups (ADMIN)' })
  findAll() {
    return this.service.findAll();
  }

  @Roles(UserRole.ADMIN)
  @Put()
  @ApiOperation({ summary: 'Create or update a brand markup (ADMIN)' })
  upsert(@Body() dto: UpsertBrandMarkupDto) {
    return this.service.upsert(dto.brand, dto.markupPercent);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':brand')
  @ApiOperation({ summary: 'Delete a brand markup (ADMIN)' })
  remove(@Param('brand') brand: string) {
    return this.service.remove(brand);
  }
}
```

- [ ] **Step 9: Register entity, service, controller**

In `src/pricing/pricing.module.ts`, replace the file with:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PricingService } from './pricing.service';
import { BrandMarkup } from './entities/brand-markup.entity';
import { BrandMarkupService } from './brand-markup.service';
import { BrandMarkupController } from './brand-markup.controller';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [TypeOrmModule.forFeature([BrandMarkup]), SuppliersModule, SettingsModule],
  controllers: [BrandMarkupController],
  providers: [PricingService, BrandMarkupService],
  exports: [PricingService, BrandMarkupService],
})
export class PricingModule {}
```

In `src/app.module.ts`: add `import { BrandMarkup } from './pricing/entities/brand-markup.entity';` near the other entity imports, and append `BrandMarkup` to the `entities: [...]` array at line 48.

- [ ] **Step 10: Run full pricing suite + build**

Run: `npx jest src/pricing && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, no type errors.

- [ ] **Step 11: Commit**

```bash
git add src/pricing src/migrations/1700000000016-CreateBrandMarkups.ts src/app.module.ts
git commit -m "feat(pricing): brand markup entity, admin CRUD, migration"
```

---

### Task 2: Wire brand markup into PricingService (§11 pricing)

**Files:**
- Modify: `src/pricing/pricing.service.ts`
- Modify: `src/pricing/pricing.service.spec.ts`
- Modify: `src/search/search.service.ts:129`
- Modify: `src/cart/cart.service.ts:224`

**Interfaces:**
- Consumes: `BrandMarkupService.findPercentByBrand` (Task 1).
- Produces: `PricingService.applyMarkup(costPrice: number, supplierCode: string, currency?: string, brand?: string): Promise<number>` — precedence for the markup percent is **brand → supplier → default**.

- [ ] **Step 1: Add the failing precedence test**

Append to `src/pricing/pricing.service.spec.ts`. First, update the `make` helper to inject a brand-markup stub (replace the existing `make` function with this version):

```typescript
function make(opts: {
  supplier?: { markupPercent?: number | null; currency?: string | null };
  rates?: Record<string, number>;
  buffer?: number;
  defaultMarkup?: number;
  brandPercent?: number | null;
} = {}) {
  const suppliersService = {
    findByCode: jest.fn(async () => opts.supplier ?? { markupPercent: null, currency: null }),
  };
  const settings = {
    getFxRates: jest.fn(async () => opts.rates ?? { KZT: 1 }),
    getFxBufferPercent: jest.fn(async () => opts.buffer ?? 0),
    getDefaultMarkup: jest.fn(async () => opts.defaultMarkup ?? 20),
  };
  const brandMarkups = {
    findPercentByBrand: jest.fn(async () => opts.brandPercent ?? null),
  };
  return new PricingService(suppliersService as any, settings as any, brandMarkups as any);
}
```

Then add these cases inside the `describe`:

```typescript
it('brand markup overrides supplier and default', async () => {
  const p = make({ supplier: { markupPercent: 10, currency: 'KZT' }, brandPercent: 50 });
  expect(await p.applyMarkup(1000, 'x', 'KZT', 'BOSCH')).toBe(1500);
});

it('falls back to supplier markup when no brand markup', async () => {
  const p = make({ supplier: { markupPercent: 10, currency: 'KZT' }, brandPercent: null });
  expect(await p.applyMarkup(1000, 'x', 'KZT', 'BOSCH')).toBe(1100);
});

it('falls back to default when neither brand nor supplier set', async () => {
  const p = make({ supplier: { markupPercent: null, currency: 'KZT' }, brandPercent: null, defaultMarkup: 20 });
  expect(await p.applyMarkup(1000, 'x', 'KZT')).toBe(1200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/pricing/pricing.service.spec.ts`
Expected: FAIL — `PricingService` constructor takes 2 args / brand precedence not applied.

- [ ] **Step 3: Update PricingService**

Replace `src/pricing/pricing.service.ts` with:

```typescript
import { Injectable } from '@nestjs/common';
import { SuppliersService } from '../suppliers/suppliers.service';
import { SettingsService } from '../settings/settings.service';
import { BrandMarkupService } from './brand-markup.service';

@Injectable()
export class PricingService {
  constructor(
    private readonly suppliersService: SuppliersService,
    private readonly settings: SettingsService,
    private readonly brandMarkups: BrandMarkupService,
  ) {}

  async applyMarkup(
    costPrice: number,
    supplierCode: string,
    currency = 'KZT',
    brand?: string,
  ): Promise<number> {
    const supplier = await this.suppliersService.findByCode(supplierCode);
    const effectiveCurrency = supplier?.currency || currency || 'KZT';

    const rates = await this.settings.getFxRates();
    const rate = Number.isFinite(rates[effectiveCurrency])
      ? rates[effectiveCurrency]
      : 1;
    const buffer = await this.settings.getFxBufferPercent();
    const kzt = costPrice * rate * (1 + buffer / 100);

    // Precedence: brand markup → supplier markup → global default.
    const brandPercent = brand
      ? await this.brandMarkups.findPercentByBrand(brand)
      : null;
    const markup =
      brandPercent != null
        ? brandPercent
        : supplier?.markupPercent != null
          ? Number(supplier.markupPercent)
          : await this.settings.getDefaultMarkup();

    return Math.round(kzt * (1 + markup / 100));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/pricing/pricing.service.spec.ts`
Expected: PASS (all cases, including the pre-existing ones).

- [ ] **Step 5: Pass brand at the search call site**

In `src/search/search.service.ts`, the `applyMarkup` call at line 129 becomes:

```typescript
    const sellPrice = await this.pricing.applyMarkup(
      offer.costPrice,
      offer.supplierCode,
      offer.currency,
      offer.brand,
    );
```

- [ ] **Step 6: Pass brand at the cart call site**

In `src/cart/cart.service.ts`, the `applyMarkup` call at line 224 becomes:

```typescript
      const currentPrice = await this.pricing.applyMarkup(
        offer.costPrice,
        item.supplierCode,
        offer.currency,
        offer.brand,
      );
```

- [ ] **Step 7: Build and run affected suites**

Run: `npx jest src/pricing src/search src/cart && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/pricing/pricing.service.ts src/pricing/pricing.service.spec.ts src/search/search.service.ts src/cart/cart.service.ts
git commit -m "feat(pricing): apply brand markup with brand>supplier>default precedence"
```

---

### Task 3: Search result filters (§10 filtering)

**Files:**
- Create: `src/search/dto/search-filter.dto.ts`
- Modify: `src/search/search.controller.ts`
- Modify: `src/search/search.service.ts`
- Modify: `src/search/search.service.spec.ts`

**Interfaces:**
- Produces: `SearchFilterDto { brand?: string; priceMin?: number; priceMax?: number; inStock?: boolean; maxDeliveryDays?: number; suppliers?: string[] }`
- Produces: `SearchService.search(article, brand?, userId?, filter?: SearchFilterDto)` — filters are applied to offers **after** `groupAndRank`; groups left with zero offers are dropped.

- [ ] **Step 1: Write the filter DTO**

```typescript
// src/search/dto/search-filter.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class SearchFilterDto {
  @ApiPropertyOptional({ example: 'BOSCH' })
  @IsOptional() @IsString()
  brand?: string;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0)
  priceMin?: number;

  @ApiPropertyOptional({ example: 9000 })
  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0)
  priceMax?: number;

  @ApiPropertyOptional({ example: true, description: 'Only offers with count > 0' })
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean()
  inStock?: boolean;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0)
  maxDeliveryDays?: number;

  @ApiPropertyOptional({ example: 'rossko,tabys', description: 'Comma-separated supplier codes' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.split(',').map((s) => s.trim()).filter(Boolean)
      : value,
  )
  @IsArray() @IsString({ each: true })
  suppliers?: string[];
}
```

- [ ] **Step 2: Write the failing service test**

Append to `src/search/search.service.spec.ts` a focused unit test for the new private filter via the public `applyFilters` helper (exposed as a public method for testing). Add inside the existing top-level `describe` (or a new one):

```typescript
describe('SearchService.applyFilters', () => {
  const svc = Object.create(SearchService.prototype) as any;
  const group = (brand: string, offers: any[]) => ({ article: 'A', brand, name: 'n', offers });
  const groups = () => [
    group('BOSCH', [
      { supplierCode: 'rossko', sellPrice: 1000, deliveryDays: 2, count: 5 },
      { supplierCode: 'tabys', sellPrice: 3000, deliveryDays: 10, count: 0 },
    ]),
    group('MANN', [
      { supplierCode: 'rossko', sellPrice: 5000, deliveryDays: 1, count: 3 },
    ]),
  ];

  it('filters by price range and drops empty groups', () => {
    const out = svc.applyFilters(groups(), { priceMin: 0, priceMax: 1500 });
    expect(out).toHaveLength(1);
    expect(out[0].brand).toBe('BOSCH');
    expect(out[0].offers).toHaveLength(1);
  });

  it('filters by inStock', () => {
    const out = svc.applyFilters(groups(), { inStock: true });
    expect(out.flatMap((g: any) => g.offers).every((o: any) => o.count > 0)).toBe(true);
  });

  it('filters by maxDeliveryDays and supplier', () => {
    const out = svc.applyFilters(groups(), { maxDeliveryDays: 3, suppliers: ['rossko'] });
    expect(out.flatMap((g: any) => g.offers)).toHaveLength(2);
  });

  it('filters by brand', () => {
    const out = svc.applyFilters(groups(), { brand: 'mann' });
    expect(out).toHaveLength(1);
    expect(out[0].brand).toBe('MANN');
  });

  it('returns all groups when filter is empty', () => {
    expect(svc.applyFilters(groups(), {})).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/search/search.service.spec.ts -t applyFilters`
Expected: FAIL — `svc.applyFilters is not a function`.

- [ ] **Step 4: Implement applyFilters and thread filter through search**

In `src/search/search.service.ts`:

(a) Add the import near the top:

```typescript
import { SearchFilterDto } from './dto/search-filter.dto';
```

(b) Change the `search` signature and apply filters before returning. Replace the method header and the `groupAndRank`/return block:

```typescript
  async search(
    article: string,
    brand?: string,
    userId?: string,
    filter?: SearchFilterDto,
  ): Promise<SearchResponseDto> {
```

and replace lines that compute/return `exact`/`analogs` (currently `const { exact, analogs } = this.groupAndRank(normalized);` … `return { query: ..., exact, analogs };`) with:

```typescript
    const ranked = this.groupAndRank(normalized);
    const exact = this.applyFilters(ranked.exact, filter ?? {});
    const analogs = this.applyFilters(ranked.analogs, filter ?? {});
    const totalResults = this.countOffers(exact) + this.countOffers(analogs);

    this.logSearch({
      userId: userId ?? null,
      article,
      brand: brand ?? null,
      totalResults,
      suppliersQueried,
      suppliersFailed,
    });

    return { query: { article, brand: brand ?? null }, exact, analogs };
```

(c) Add the public method (place it just after `search`):

```typescript
  /** Public for unit testing. Filters offers within each group; drops empty groups. */
  applyFilters(groups: SearchGroupDto[], f: SearchFilterDto): SearchGroupDto[] {
    const brand = f.brand?.trim().toUpperCase();
    const suppliers = f.suppliers?.length
      ? new Set(f.suppliers.map((s) => s.toLowerCase()))
      : null;
    const out: SearchGroupDto[] = [];
    for (const group of groups) {
      if (brand && group.brand.trim().toUpperCase() !== brand) continue;
      const offers = group.offers.filter((o) => {
        if (f.priceMin != null && o.sellPrice < f.priceMin) return false;
        if (f.priceMax != null && o.sellPrice > f.priceMax) return false;
        if (f.inStock && !(o.count > 0)) return false;
        if (f.maxDeliveryDays != null && o.deliveryDays > f.maxDeliveryDays) return false;
        if (suppliers && !suppliers.has(o.supplierCode.toLowerCase())) return false;
        return true;
      });
      if (offers.length) out.push({ ...group, offers });
    }
    return out;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/search/search.service.spec.ts`
Expected: PASS (new `applyFilters` cases + existing tests).

- [ ] **Step 6: Wire filters into the controller**

In `src/search/search.controller.ts`:

(a) Add imports:

```typescript
import { SearchFilterDto } from './dto/search-filter.dto';
```

(b) Add `@ApiQuery` docs and the `@Query()` binding. Replace the `search` handler signature and call with:

```typescript
  @ApiQuery({ name: 'brand', required: false, example: 'BOSCH' })
  @ApiQuery({ name: 'priceMin', required: false, example: 1000 })
  @ApiQuery({ name: 'priceMax', required: false, example: 9000 })
  @ApiQuery({ name: 'inStock', required: false, example: true })
  @ApiQuery({ name: 'maxDeliveryDays', required: false, example: 5 })
  @ApiQuery({ name: 'suppliers', required: false, example: 'rossko,tabys' })
  @ApiOkResponse({ type: SearchResponseDto })
  async search(
    @Query('article') article: string,
    @Query('brand') brand: string | undefined,
    @Query() filter: SearchFilterDto,
    @CurrentUser() user: User | undefined,
  ): Promise<SearchResponseDto> {
    if (!article || !article.trim()) {
      throw new BadRequestException('Query parameter "article" is required.');
    }
    return this.searchService.search(
      article.trim(),
      brand?.trim() || undefined,
      user?.id,
      filter,
    );
  }
```

Note: a global `ValidationPipe` with `transform: true` must be active for `@Transform` to run. Verify `main.ts` has `app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))`; if `transform` is missing, add it (do not remove existing options).

- [ ] **Step 7: Build and run search suite**

Run: `npx jest src/search && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/search src/main.ts
git commit -m "feat(search): brand/price/stock/delivery/supplier result filters"
```

---

### Task 4: Article-writing normalization (§10 dashes/spaces/case)

**Files:**
- Create: `src/search/normalize-article.util.ts`
- Create: `src/search/normalize-article.util.spec.ts`
- Modify: `src/search/search.service.ts:176` (group key)

**Interfaces:**
- Produces: `normalizeArticle(value: string): string` — uppercases and strips `-`, spaces, `.`, `/` for use as a canonical dedup/group key.

- [ ] **Step 1: Write the failing util test**

```typescript
// src/search/normalize-article.util.spec.ts
import { normalizeArticle } from './normalize-article.util';

describe('normalizeArticle', () => {
  it('strips dashes, spaces, dots, slashes and uppercases', () => {
    expect(normalizeArticle('0451-103 316')).toBe('0451103316');
    expect(normalizeArticle('a.1/2 b')).toBe('A12B');
    expect(normalizeArticle('  bosch ')).toBe('BOSCH');
  });

  it('is idempotent and null-safe', () => {
    expect(normalizeArticle(normalizeArticle('04-51'))).toBe('0451');
    expect(normalizeArticle(undefined as any)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/search/normalize-article.util.spec.ts`
Expected: FAIL — cannot find module `./normalize-article.util`.

- [ ] **Step 3: Implement the util**

```typescript
// src/search/normalize-article.util.ts
/** Canonical key for grouping/deduping offers across supplier writing variants. */
export function normalizeArticle(value: string): string {
  return (value ?? '').toUpperCase().replace(/[-\s./]/g, '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/search/normalize-article.util.spec.ts`
Expected: PASS.

- [ ] **Step 5: Use the util for the group key**

In `src/search/search.service.ts`, add the import:

```typescript
import { normalizeArticle } from './normalize-article.util';
```

and replace the group key line (currently `const key = \`${offer.article.trim().toUpperCase()}|${offer.brand.trim().toUpperCase()}\`;`) with:

```typescript
      const key = `${normalizeArticle(offer.article)}|${normalizeArticle(offer.brand)}`;
```

This merges offers whose article/brand differ only by dashes, spaces, dots, slashes, or case. The outgoing query string sent to connectors is intentionally left untouched (some supplier APIs require the exact written form); only result grouping is canonicalized.

- [ ] **Step 6: Run search suite + build**

Run: `npx jest src/search && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/search/normalize-article.util.ts src/search/normalize-article.util.spec.ts src/search/search.service.ts
git commit -m "feat(search): normalize dashes/spaces/case when grouping offers"
```

---

### Task 5: CryptoService for secret encryption (§9 / §18)

**Files:**
- Create: `src/common/crypto.service.ts`
- Create: `src/common/crypto.service.spec.ts`
- Create: `src/common/common.module.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `CryptoService.encrypt(plain: string): string` — returns `ivHex:tagHex:cipherHex`.
- Produces: `CryptoService.decrypt(payload: string): string` — inverse; throws on tampered/garbage input.
- Reads `APP_SECRET` from env; derives a 32-byte key via SHA-256.

- [ ] **Step 1: Write the failing test**

```typescript
// src/common/crypto.service.spec.ts
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  const old = process.env.APP_SECRET;
  beforeAll(() => { process.env.APP_SECRET = 'test-master-secret'; });
  afterAll(() => { process.env.APP_SECRET = old; });

  it('round-trips a secret', () => {
    const c = new CryptoService();
    const enc = c.encrypt('rossko-key-123');
    expect(enc).not.toContain('rossko-key-123');
    expect(c.decrypt(enc)).toBe('rossko-key-123');
  });

  it('produces different ciphertext each call (random IV)', () => {
    const c = new CryptoService();
    expect(c.encrypt('x')).not.toBe(c.encrypt('x'));
  });

  it('throws on tampered payload', () => {
    const c = new CryptoService();
    const enc = c.encrypt('secret');
    const tampered = enc.slice(0, -2) + (enc.endsWith('aa') ? 'bb' : 'aa');
    expect(() => c.decrypt(tampered)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/common/crypto.service.spec.ts`
Expected: FAIL — cannot find module `./crypto.service`.

- [ ] **Step 3: Implement the service**

```typescript
// src/common/crypto.service.ts
import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';

@Injectable()
export class CryptoService {
  private key(): Buffer {
    const secret = process.env.APP_SECRET || '';
    if (!secret) {
      throw new Error('APP_SECRET is not set — cannot encrypt/decrypt supplier secrets.');
    }
    return createHash('sha256').update(secret).digest(); // 32 bytes
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key(), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  }

  decrypt(payload: string): string {
    const [ivHex, tagHex, dataHex] = payload.split(':');
    if (!ivHex || !tagHex || !dataHex) {
      throw new Error('Malformed encrypted payload.');
    }
    const decipher = createDecipheriv(ALGO, this.key(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/common/crypto.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create a shared module that exports CryptoService**

```typescript
// src/common/common.module.ts
import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CommonModule {}
```

Add `CommonModule` to the `imports: [...]` array in `src/app.module.ts` (import it: `import { CommonModule } from './common/common.module';`). Because it is `@Global`, `CryptoService` becomes injectable everywhere without re-importing.

- [ ] **Step 6: Document APP_SECRET**

Add to `.env.example`:

```
# Master key used to encrypt supplier API secrets stored in the DB (§18). Set a long random value in production.
APP_SECRET=change-this-to-a-long-random-string
```

- [ ] **Step 7: Build and commit**

Run: `npx jest src/common && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, no type errors.

```bash
git add src/common .env.example src/app.module.ts
git commit -m "feat(common): AES-256-GCM CryptoService for supplier secrets"
```

---

### Task 6: Supplier config columns — timeout, rate limit, encrypted secrets (§9)

**Files:**
- Create: `src/migrations/1700000000017-AddSupplierApiConfig.ts`
- Modify: `src/suppliers/entities/supplier.entity.ts`
- Modify: `src/suppliers/dto/update-supplier.dto.ts`
- Modify: `src/suppliers/suppliers.service.ts`
- Modify: `src/suppliers/suppliers.service.spec.ts` (create if absent)

**Interfaces:**
- Produces: `Supplier.timeoutMs: number | null`, `Supplier.rateLimitRpm: number | null`, `Supplier.secretsEnc: string | null` (encrypted JSON map of sensitive keys).
- Produces: `SuppliersService.update` accepts `apiUrl`, `secrets` (plaintext map → encrypted into `secretsEnc`), `timeoutMs`, `rateLimitRpm`. `apiUrl` is written into the non-sensitive `config.API_URL`.
- Produces: `SuppliersService.getSecrets(code): Promise<Record<string,string>>` — decrypts `secretsEnc`, returns `{}` when unset.

- [ ] **Step 1: Write the migration**

```typescript
// src/migrations/1700000000017-AddSupplierApiConfig.ts
import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSupplierApiConfig1700000000017 implements MigrationInterface {
  name = 'AddSupplierApiConfig1700000000017';
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "suppliers" ADD "timeoutMs" integer`);
    await q.query(`ALTER TABLE "suppliers" ADD "rateLimitRpm" integer`);
    await q.query(`ALTER TABLE "suppliers" ADD "secretsEnc" text`);
  }
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "suppliers" DROP COLUMN "secretsEnc"`);
    await q.query(`ALTER TABLE "suppliers" DROP COLUMN "rateLimitRpm"`);
    await q.query(`ALTER TABLE "suppliers" DROP COLUMN "timeoutMs"`);
  }
}
```

- [ ] **Step 2: Add entity columns**

In `src/suppliers/entities/supplier.entity.ts`, after the `deliveryBufferDays` column and before `config`, add:

```typescript
  @ApiProperty({ example: 15000, nullable: true, description: 'Per-request timeout (ms); null => default 15000' })
  @Column({ type: 'int', nullable: true })
  timeoutMs: number | null;

  @ApiProperty({ example: 120, nullable: true, description: 'Max requests per minute to this partner; null => unlimited' })
  @Column({ type: 'int', nullable: true })
  rateLimitRpm: number | null;

  @ApiProperty({ description: 'Encrypted JSON of sensitive keys (never returned in plaintext)', nullable: true })
  @Column({ type: 'text', nullable: true })
  secretsEnc: string | null;
```

- [ ] **Step 3: Extend the DTO**

In `src/suppliers/dto/update-supplier.dto.ts`, add fields (keep existing ones):

```typescript
  @ApiPropertyOptional({ description: 'Partner API base URL (stored in config.API_URL)', example: 'https://api.tabys.parts' })
  @IsOptional() @IsString()
  apiUrl?: string;

  @ApiPropertyOptional({ description: 'Per-request timeout in ms', minimum: 1000, maximum: 60000, nullable: true })
  @IsOptional() @IsNumber() @Min(1000) @Max(60000)
  timeoutMs?: number | null;

  @ApiPropertyOptional({ description: 'Rate limit (requests per minute); null = unlimited', minimum: 1, maximum: 100000, nullable: true })
  @IsOptional() @IsNumber() @Min(1) @Max(100000)
  rateLimitRpm?: number | null;

  @ApiPropertyOptional({
    description: 'Sensitive keys (API_KEY/KEY1/KEY2/LOGIN/PASSWORD…). Stored encrypted; never returned.',
    example: { API_KEY: 'secret' },
  })
  @IsOptional() @IsObject()
  secrets?: Record<string, string>;
```

- [ ] **Step 4: Write the failing service test**

```typescript
// src/suppliers/suppliers.service.spec.ts
import { SuppliersService } from './suppliers.service';

function make(supplier: any) {
  const repo = {
    findOne: jest.fn(async () => supplier),
    find: jest.fn(async () => [supplier]),
    save: jest.fn(async (s: any) => s),
  };
  const crypto = {
    encrypt: jest.fn((s: string) => `enc(${s})`),
    decrypt: jest.fn((s: string) => s.replace(/^enc\(|\)$/g, '')),
  };
  return { svc: new SuppliersService(repo as any, crypto as any), repo, crypto };
}

describe('SuppliersService secrets & config', () => {
  it('encrypts secrets on update and stores apiUrl in config', async () => {
    const supplier: any = { code: 'tabys', config: {}, secretsEnc: null };
    const { svc, crypto } = make(supplier);
    const saved = await svc.update('tabys', { apiUrl: 'https://x', secrets: { API_KEY: 'k' } } as any);
    expect(crypto.encrypt).toHaveBeenCalledWith(JSON.stringify({ API_KEY: 'k' }));
    expect(saved.secretsEnc).toBe('enc({"API_KEY":"k"})');
    expect(saved.config).toEqual({ API_URL: 'https://x' });
  });

  it('getSecrets decrypts, empty when unset', async () => {
    const { svc } = make({ code: 'tabys', secretsEnc: 'enc({"API_KEY":"k"})' });
    expect(await svc.getSecrets('tabys')).toEqual({ API_KEY: 'k' });
    const empty = make({ code: 'tabys', secretsEnc: null });
    expect(await empty.svc.getSecrets('tabys')).toEqual({});
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx jest src/suppliers/suppliers.service.spec.ts`
Expected: FAIL — `SuppliersService` constructor takes 1 arg; `getSecrets` undefined.

- [ ] **Step 6: Update the service**

Replace `src/suppliers/suppliers.service.ts` with:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from './entities/supplier.entity';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CryptoService } from '../common/crypto.service';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly repo: Repository<Supplier>,
    private readonly crypto: CryptoService,
  ) {}

  findAll(): Promise<Supplier[]> {
    return this.repo.find();
  }

  findByCode(code: string): Promise<Supplier | null> {
    return this.repo.findOne({ where: { code } });
  }

  async getSecrets(code: string): Promise<Record<string, string>> {
    const supplier = await this.findByCode(code);
    if (!supplier?.secretsEnc) return {};
    try {
      return JSON.parse(this.crypto.decrypt(supplier.secretsEnc));
    } catch {
      return {};
    }
  }

  async update(code: string, dto: UpdateSupplierDto): Promise<Supplier> {
    const supplier = await this.findByCode(code);
    if (!supplier) {
      throw new NotFoundException(`Supplier "${code}" not found.`);
    }
    if (dto.isActive !== undefined) supplier.isActive = dto.isActive;
    if (dto.markupPercent !== undefined) supplier.markupPercent = dto.markupPercent;
    if (dto.currency !== undefined) supplier.currency = dto.currency;
    if (dto.config !== undefined) supplier.config = dto.config;
    if (dto.deliveryBufferDays !== undefined) supplier.deliveryBufferDays = dto.deliveryBufferDays;
    if (dto.timeoutMs !== undefined) supplier.timeoutMs = dto.timeoutMs;
    if (dto.rateLimitRpm !== undefined) supplier.rateLimitRpm = dto.rateLimitRpm;
    if (dto.apiUrl !== undefined) {
      supplier.config = { ...(supplier.config ?? {}), API_URL: dto.apiUrl };
    }
    if (dto.secrets !== undefined) {
      supplier.secretsEnc = this.crypto.encrypt(JSON.stringify(dto.secrets));
    }
    return this.repo.save(supplier);
  }
}
```

- [ ] **Step 7: Strip secretsEnc from list responses**

So the admin `GET /suppliers` never leaks ciphertext, update `findAll` to omit it. Replace the `findAll` body with:

```typescript
  async findAll(): Promise<Supplier[]> {
    const rows = await this.repo.find();
    return rows.map((s) => ({ ...s, secretsEnc: s.secretsEnc ? '***' : null }));
  }
```

- [ ] **Step 8: Register the entity column array & run**

`Supplier` is already in `src/app.module.ts` entities; no array change needed (new columns are on the existing entity). Run:

Run: `npx jest src/suppliers/suppliers.service.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/migrations/1700000000017-AddSupplierApiConfig.ts src/suppliers/entities/supplier.entity.ts src/suppliers/dto/update-supplier.dto.ts src/suppliers/suppliers.service.ts src/suppliers/suppliers.service.spec.ts
git commit -m "feat(suppliers): admin-managed apiUrl/timeout/rateLimit + encrypted secrets"
```

---

### Task 7: resolveConfig reads encrypted secrets + per-supplier timeout; connectors honor timeout (§9)

**Files:**
- Modify: `src/suppliers/connector-config.util.ts`
- Modify: `src/suppliers/connector-config.util.spec.ts` (create if absent)
- Modify: `src/suppliers/connectors/tabys/tabys.connector.ts`
- Modify: `src/suppliers/connectors/shatem/shatem.connector.ts`
- Modify: `src/suppliers/connectors/rossko/rossko.connector.ts`
- Modify: `src/suppliers/connectors/autotrade/autotrade.connector.ts`

**Interfaces:**
- Consumes: `SuppliersService.getSecrets`, `Supplier.timeoutMs` (Task 6).
- Produces: `resolveConfig(suppliersService, code, envMap)` now also returns `TIMEOUT_MS` (from `supplier.timeoutMs`, default `15000`) and merges decrypted secrets with priority **secrets → config → env**.

- [ ] **Step 1: Write the failing util test**

```typescript
// src/suppliers/connector-config.util.spec.ts
import { resolveConfig, hasKeys } from './connector-config.util';

function svc(supplier: any) {
  return {
    findByCode: jest.fn(async () => supplier),
    getSecrets: jest.fn(async () => supplier?.secrets ?? {}),
  } as any;
}

describe('resolveConfig', () => {
  const OLD = process.env.TABYS_API_KEY;
  afterAll(() => { process.env.TABYS_API_KEY = OLD; });

  it('priority secrets > config > env', async () => {
    process.env.TABYS_API_KEY = 'from-env';
    const s = svc({ config: { API_KEY: 'from-config' }, secrets: { API_KEY: 'from-secret' }, timeoutMs: null });
    const out = await resolveConfig(s, 'tabys', { API_KEY: 'TABYS_API_KEY' });
    expect(out.API_KEY).toBe('from-secret');
  });

  it('falls back to env when neither secret nor config set', async () => {
    process.env.TABYS_API_KEY = 'from-env';
    const s = svc({ config: {}, secrets: {}, timeoutMs: null });
    const out = await resolveConfig(s, 'tabys', { API_KEY: 'TABYS_API_KEY' });
    expect(out.API_KEY).toBe('from-env');
  });

  it('exposes TIMEOUT_MS from supplier, default 15000', async () => {
    const s1 = svc({ config: {}, secrets: {}, timeoutMs: 3000 });
    expect((await resolveConfig(s1, 'tabys', {})).TIMEOUT_MS).toBe('3000');
    const s2 = svc({ config: {}, secrets: {}, timeoutMs: null });
    expect((await resolveConfig(s2, 'tabys', {})).TIMEOUT_MS).toBe('15000');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/suppliers/connector-config.util.spec.ts`
Expected: FAIL — secrets not merged / `TIMEOUT_MS` undefined.

- [ ] **Step 3: Update the util**

Replace `src/suppliers/connector-config.util.ts` with:

```typescript
interface HasConfig {
  findByCode(code: string): Promise<
    { config?: Record<string, unknown> | null; timeoutMs?: number | null } | null
  >;
  getSecrets?(code: string): Promise<Record<string, string>>;
}

const DEFAULT_TIMEOUT_MS = 15000;

export async function resolveConfig(
  suppliersService: HasConfig,
  code: string,
  envMap: Record<string, string>,
): Promise<Record<string, string>> {
  const supplier = await suppliersService.findByCode(code);
  const config = (supplier?.config ?? {}) as Record<string, unknown>;
  const secrets = suppliersService.getSecrets
    ? await suppliersService.getSecrets(code)
    : {};
  const out: Record<string, string> = {};
  for (const [key, envName] of Object.entries(envMap)) {
    const fromSecret = secrets[key];
    const fromCfg = config[key];
    const secretStr = fromSecret == null ? '' : String(fromSecret).trim();
    const cfgStr = fromCfg == null ? '' : String(fromCfg).trim();
    out[key] =
      secretStr !== '' ? secretStr
      : cfgStr !== '' ? cfgStr
      : process.env[envName] ?? '';
  }
  out.TIMEOUT_MS = String(supplier?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return out;
}

export function hasKeys(resolved: Record<string, string>, required: string[]): boolean {
  return required.every((k) => (resolved[k] ?? '').trim() !== '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/suppliers/connector-config.util.spec.ts`
Expected: PASS.

- [ ] **Step 5: Honor TIMEOUT_MS in each connector's axios instance**

In each connector's `http(c)` method, replace `timeout: 15000,` with:

```typescript
      timeout: Number(c.TIMEOUT_MS) || 15000,
```

Apply to: `tabys.connector.ts` (line ~51), `shatem.connector.ts`, `rossko.connector.ts`, `autotrade.connector.ts`. Each builds its axios client from the resolved config `c`, so `c.TIMEOUT_MS` is present. If a connector hardcodes the timeout somewhere other than `http(c)` (e.g. a per-request `axios.get(url, { timeout: ... })`), update that literal too.

- [ ] **Step 6: Build and run supplier suites**

Run: `npx jest src/suppliers && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/suppliers/connector-config.util.ts src/suppliers/connector-config.util.spec.ts src/suppliers/connectors
git commit -m "feat(suppliers): resolveConfig merges encrypted secrets + per-supplier timeout"
```

---

### Task 8: Per-supplier rate limiting (§9)

**Files:**
- Create: `src/suppliers/rate-limiter.ts`
- Create: `src/suppliers/rate-limiter.spec.ts`
- Create: `src/suppliers/rate-limiter.registry.ts`
- Modify: `src/suppliers/suppliers.module.ts`
- Modify: `src/search/search.service.ts` (gate the fan-out)
- Modify: `src/orders/orders.service.ts` (gate placeOrder)

**Interfaces:**
- Produces: `class RateLimiter { constructor(rpm: number); acquire(): Promise<void> }` — token bucket; `rpm <= 0` means unlimited (resolves immediately).
- Produces: `RateLimiterRegistry.gate(code: string, rpm: number | null, fn: () => Promise<T>): Promise<T>` — caches one `RateLimiter` per supplier code, re-creating it if `rpm` changed; runs `fn` after acquiring a slot.

- [ ] **Step 1: Write the failing limiter test**

```typescript
// src/suppliers/rate-limiter.spec.ts
import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  it('unlimited (rpm<=0) resolves immediately', async () => {
    const rl = new RateLimiter(0);
    const start = Date.now();
    await rl.acquire(); await rl.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('allows up to rpm tokens, then spaces the next one out', async () => {
    // 60 rpm => 1 token/sec, bucket starts full with 1 burst token here.
    const rl = new RateLimiter(60, 1, () => now.value);
    const now = { value: 0 };
    // first acquire consumes the initial token immediately
    await rl.acquire();
    let resolved = false;
    rl.acquire().then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false); // no token yet
    now.value = 1000; // 1s later -> +1 token
    await rl.tick();
    await Promise.resolve();
    expect(resolved).toBe(true);
  });
});
```

Note: the limiter is built test-first with an injectable clock and a `tick()` to refill deterministically (no real timers in tests).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/suppliers/rate-limiter.spec.ts`
Expected: FAIL — cannot find module `./rate-limiter`.

- [ ] **Step 3: Implement the limiter**

```typescript
// src/suppliers/rate-limiter.ts
type Clock = () => number;

/** Token-bucket limiter. rpm<=0 => unlimited. Deterministic via injected clock + tick(). */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly rpm: number,
    burst = Math.max(1, Math.ceil(rpm / 60)),
    private readonly clock: Clock = () => Date.now(),
  ) {
    this.tokens = rpm <= 0 ? Number.POSITIVE_INFINITY : burst;
    this.lastRefill = this.clock();
  }

  private refill(): void {
    if (this.rpm <= 0) return;
    const now = this.clock();
    const elapsedMs = now - this.lastRefill;
    const gained = (elapsedMs / 60000) * this.rpm;
    if (gained > 0) {
      this.tokens = Math.min(this.tokens + gained, Math.max(1, this.rpm));
      this.lastRefill = now;
    }
    while (this.tokens >= 1 && this.waiters.length) {
      this.tokens -= 1;
      this.waiters.shift()!();
    }
  }

  /** Test hook: advance refill after moving the injected clock. */
  tick(): void { this.refill(); }

  async acquire(): Promise<void> {
    if (this.rpm <= 0) return;
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/suppliers/rate-limiter.spec.ts`
Expected: PASS.

- [ ] **Step 5: Implement the registry**

```typescript
// src/suppliers/rate-limiter.registry.ts
import { Injectable } from '@nestjs/common';
import { RateLimiter } from './rate-limiter';

@Injectable()
export class RateLimiterRegistry {
  private readonly limiters = new Map<string, { rpm: number; rl: RateLimiter }>();

  private get(code: string, rpm: number): RateLimiter {
    const existing = this.limiters.get(code);
    if (existing && existing.rpm === rpm) return existing.rl;
    const rl = new RateLimiter(rpm);
    this.limiters.set(code, { rpm, rl });
    return rl;
  }

  async gate<T>(code: string, rpm: number | null, fn: () => Promise<T>): Promise<T> {
    const limit = rpm ?? 0;
    if (limit > 0) {
      await this.get(code, limit).acquire();
    }
    return fn();
  }
}
```

In `src/suppliers/suppliers.module.ts`: add `RateLimiterRegistry` to `providers` and to `exports`. Import it at the top.

- [ ] **Step 6: Gate the search fan-out**

In `src/search/search.service.ts`, inject the registry (add to the constructor params: `private readonly rateLimiter: RateLimiterRegistry,`) and import it. Wrap the per-connector call. Currently:

```typescript
      connectors.map((connector) =>
        this.withTimeout(connector.search(article, brand), this.timeoutMs).then(
          (offers) => ({ connector, offers }),
        ),
      ),
```

becomes:

```typescript
      connectors.map((connector) =>
        this.rateLimiter
          .gate(connector.code, this.rpmFor(connector.code, supplierRowsByCode), () =>
            this.withTimeout(connector.search(article, brand), this.timeoutMs),
          )
          .then((offers) => ({ connector, offers })),
      ),
```

To supply `rpm`, fetch supplier rows once before the fan-out (the service already calls `this.suppliersService.findAll()` later — move that call above the fan-out and build `const supplierRowsByCode = new Map(supplierRows.map((s) => [s.code, s.rateLimitRpm]));`, reusing the same `supplierRows` for the existing `bufferByCode`). Add the helper:

```typescript
  private rpmFor(code: string, byCode: Map<string, number | null>): number | null {
    return byCode.get(code) ?? null;
  }
```

(Existing `bufferByCode` already derives from `supplierRows`; keep one `findAll()` call and derive both maps from it.)

- [ ] **Step 7: Gate supplier order placement**

In `src/orders/orders.service.ts`, find `placeSupplierOrder` where it calls `connector.placeOrder(items)`. Inject `RateLimiterRegistry` (constructor) and wrap:

```typescript
    const supplier = await this.suppliersService.findByCode(supplierCode);
    const result = await this.rateLimiter.gate(
      supplierCode,
      supplier?.rateLimitRpm ?? null,
      () => connector.placeOrder(items),
    );
```

(Use the existing `connector` and `items` variables already in scope; only the `placeOrder` call is wrapped. `OrdersModule` already imports `SuppliersModule`, so `RateLimiterRegistry` is available once exported in Step 5.)

- [ ] **Step 8: Build and run affected suites**

Run: `npx jest src/suppliers src/search src/orders && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/suppliers/rate-limiter.ts src/suppliers/rate-limiter.spec.ts src/suppliers/rate-limiter.registry.ts src/suppliers/suppliers.module.ts src/search/search.service.ts src/orders/orders.service.ts
git commit -m "feat(suppliers): per-supplier rate limiting on search and order placement"
```

---

### Task 9: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npx jest`
Expected: all suites PASS.

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: clean build into `dist/`.

- [ ] **Step 3: Run migrations against a dev DB**

Run: `npm run migration:run`
Expected: `CreateBrandMarkups1700000000016`, `AddSupplierApiConfig1700000000017` applied without error.

- [ ] **Step 4: Smoke-test the admin endpoints (manual)**

With the app running and an ADMIN token:
- `PUT /pricing/brand-markups` `{ "brand": "BOSCH", "markupPercent": 25 }` → 200.
- `PATCH /suppliers/tabys` `{ "timeoutMs": 8000, "rateLimitRpm": 120, "apiUrl": "https://api.tabys.parts", "secrets": { "API_KEY": "x" } }` → 200.
- `GET /suppliers` → `secretsEnc` shows `***`, never plaintext.
- `GET /search?article=0451-103-316&brand=BOSCH&priceMax=9000&inStock=true&suppliers=rossko,tabys` → filtered groups; dashed article merges with undashed offers.

- [ ] **Step 5: Final commit (if any doc updates)**

```bash
git add -A
git commit -m "chore: spec gap fixes — verification pass"
```

---

## Self-Review Notes

- **Spec coverage:** §11 brand markup → Tasks 1–2. §10 filters → Task 3. §10 dash/space/case normalization → Task 4. §9 admin API URL/key (encrypted) → Tasks 5–6. §9 timeout → Tasks 6–7. §9 rate limit → Tasks 6 (column) + 8 (enforcement). Minimum margin and warehouse-priority/combined-rules are intentionally **out of scope** per the latest instruction.
- **Type consistency:** `applyMarkup(costPrice, supplierCode, currency?, brand?)`, `findPercentByBrand`, `getSecrets`, `resolveConfig` returning `TIMEOUT_MS`, `RateLimiterRegistry.gate(code, rpm, fn)` are used identically across producing and consuming tasks.
- **Decisions locked:** brand markup outranks supplier markup; outgoing supplier query is NOT dash-stripped (only the grouping key is); secrets stored as one encrypted JSON blob; rate limiting enforced at the two outbound choke points (search fan-out, order placement) rather than inside every connector.
</content>
</invoke>
