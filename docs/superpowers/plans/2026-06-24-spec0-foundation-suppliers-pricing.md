# Spec 0 — Foundation: Suppliers Core + Pricing + API-инфра — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared aggregator foundation — a normalized supplier-connector contract, a provider registry, a partner-config table, a markup/pricing service, the Rossko connector on the new contract, a reusable mock connector, and Swagger API infrastructure — so that Spec A (Search), B (Cart), and C (Orders) can code against these interfaces.

**Architecture:** A new `suppliers/` module defines normalized types (`SupplierOffer`, etc.), a `SupplierConnector` interface, a DI token `SUPPLIERS` (array of connectors), a `SuppliersRegistry` (active-filtering + lookup), a `SuppliersService` (CRUD over a new `suppliers` table), and connectors (`rossko`, `mock`). A new `pricing/` module exposes `PricingService.applyMarkup`. Swagger replaces the hand-written OpenAPI at `/api/docs`. The legacy `src/rossko/*` module stays in place (deprecated) so existing routes keep working.

**Tech Stack:** NestJS 10, TypeORM 0.3 + PostgreSQL, class-validator/class-transformer, axios + fast-xml-parser (SOAP), `@nestjs/swagger` (new), Jest + ts-jest (new test infra).

## Global Constraints

- **Framework:** NestJS 10, TypeORM 0.3.17, PostgreSQL (`pg`). Match existing patterns exactly.
- **Config access:** read environment via `process.env.*` directly (project has no `ConfigService`).
- **Entity conventions:** `@Entity('snake_case_table')`, columns declared in `camelCase` (TypeORM keeps the camelCase column name — see `firstName` in the users migration), PK = `@PrimaryGeneratedColumn('uuid')`, `@CreateDateColumn()`/`@UpdateDateColumn()` timestamps, decimals as `@Column({ type: 'decimal', precision, scale })`.
- **Migrations:** files in `src/migrations/`, named `{timestamp}-{Description}.ts`, `implements MigrationInterface` with `name = '...'`, run via `npm run migration:run`. The next free timestamp is `1700000000007`.
- **Auth:** global `JwtAuthGuard`; protect admin routes with `@UseGuards(RolesGuard)` + `@Roles(UserRole.ADMIN)` (import `UserRole` from `../users/entities/user.entity`); use `@Public()` for open routes.
- **Validation:** global `ValidationPipe` with `whitelist: true, forbidNonWhitelisted: true, transform: true` — every request DTO field MUST carry a class-validator decorator or it is stripped.
- **Decimal reads:** TypeORM returns `decimal` columns as **strings** from Postgres — always `Number(...)` before arithmetic.
- **`DEFAULT_MARKUP_PERCENT`** default when env var unset: `20`.
- **Do NOT delete** `src/rossko/*` — mark deprecated only.
- **Canonical shared-file edits** (other specs only append): `src/app.module.ts`, `src/config/data-source.ts`, `src/main.ts`, `package.json`.

---

### Task 1: Test infrastructure + new dependencies

**Files:**
- Modify: `package.json` (deps + scripts)
- Create: `jest.config.js`
- Create: `src/_smoke.spec.ts` (temporary smoke test, deleted at end of task)

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test` command using Jest + ts-jest; `@nestjs/swagger` and `@nestjs/testing` installed for later tasks.

- [ ] **Step 1: Add dependencies and test scripts to `package.json`**

Add `"@nestjs/swagger": "^7.4.0"` to `dependencies`. Add to `devDependencies`: `"@nestjs/testing": "^10.0.0"`, `"jest": "^29.7.0"`, `"ts-jest": "^29.2.5"`, `"@types/jest": "^29.5.12"`. Add to `scripts`:

```json
"test": "jest",
"test:watch": "jest --watch"
```

- [ ] **Step 2: Create `jest.config.js`**

```js
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: completes without error; `node_modules/.bin/jest` exists. (If the environment is offline, ensure these packages are otherwise available before continuing.)

- [ ] **Step 4: Write a smoke test to prove Jest + ts-jest + decorators work**

Create `src/_smoke.spec.ts`:

```ts
import 'reflect-metadata';

describe('jest smoke', () => {
  it('runs typescript tests', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the smoke test**

Run: `npm test -- _smoke`
Expected: PASS (1 test passed).

- [ ] **Step 6: Delete the smoke test**

```bash
rm src/_smoke.spec.ts
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json jest.config.js
git commit -m "chore: add jest test infra and @nestjs/swagger dependency"
```

---

### Task 2: Normalized types + connector interface + DI token

**Files:**
- Create: `src/suppliers/types.ts`
- Create: `src/suppliers/supplier-connector.interface.ts`
- Test: `src/suppliers/types.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SupplierOffer { supplierCode, article, brand, name, costPrice, count, deliveryDays, multiplicity, warehouseId, isAnalog, raw }`
  - `PlaceOrderItem { article, brand, warehouseId, quantity, raw }`
  - `SupplierOrderResult { externalOrderId: string | null, status: SupplierOrderStatusValue, errorMessage? }`
  - `SupplierOrderStatusValue = 'NEW'|'PLACED'|'FAILED'|'CONFIRMED'|'SHIPPED'|'DELIVERED'|'CANCELLED'`
  - `ReturnItem { externalOrderId, article, quantity }`
  - `ReturnResult { returnStatus: 'REQUESTED'|'IN_PROGRESS'|'DONE'|'REJECTED', externalReturnId?, errorMessage? }`
  - `interface SupplierConnector { code; name; search(); placeOrder(); getOrderStatus(); requestReturn() }`
  - `const SUPPLIERS = Symbol('SUPPLIERS')` — DI token.

- [ ] **Step 1: Write the failing test**

Create `src/suppliers/types.spec.ts`:

```ts
import { SUPPLIERS } from './supplier-connector.interface';
import type { SupplierOffer, SupplierOrderStatusValue } from './types';

describe('suppliers types', () => {
  it('exposes the SUPPLIERS DI token as a symbol', () => {
    expect(typeof SUPPLIERS).toBe('symbol');
  });

  it('allows constructing a SupplierOffer object', () => {
    const offer: SupplierOffer = {
      supplierCode: 'rossko',
      article: '0451103316',
      brand: 'BOSCH',
      name: 'Filter',
      costPrice: 5200,
      count: 10,
      deliveryDays: 3,
      multiplicity: 1,
      warehouseId: 'wh-1',
      isAnalog: false,
      raw: { guid: 'g1' },
    };
    const status: SupplierOrderStatusValue = 'NEW';
    expect(offer.supplierCode).toBe('rossko');
    expect(status).toBe('NEW');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- suppliers/types`
Expected: FAIL — cannot find module `./types` / `./supplier-connector.interface`.

- [ ] **Step 3: Create `src/suppliers/types.ts`**

```ts
export interface SupplierOffer {
  supplierCode: string;
  article: string;
  brand: string;
  name: string;
  costPrice: number;
  count: number;
  deliveryDays: number;
  multiplicity: number;
  warehouseId: string;
  isAnalog: boolean;
  raw: Record<string, unknown>;
}

export interface PlaceOrderItem {
  article: string;
  brand: string;
  warehouseId: string;
  quantity: number;
  raw: Record<string, unknown>;
}

export type SupplierOrderStatusValue =
  | 'NEW'
  | 'PLACED'
  | 'FAILED'
  | 'CONFIRMED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

export interface SupplierOrderResult {
  externalOrderId: string | null;
  status: SupplierOrderStatusValue;
  errorMessage?: string;
}

export interface ReturnItem {
  externalOrderId: string;
  article: string;
  quantity: number;
}

export interface ReturnResult {
  returnStatus: 'REQUESTED' | 'IN_PROGRESS' | 'DONE' | 'REJECTED';
  externalReturnId?: string;
  errorMessage?: string;
}
```

- [ ] **Step 4: Create `src/suppliers/supplier-connector.interface.ts`**

```ts
import {
  PlaceOrderItem,
  ReturnItem,
  ReturnResult,
  SupplierOffer,
  SupplierOrderResult,
  SupplierOrderStatusValue,
} from './types';

export interface SupplierConnector {
  readonly code: string;
  readonly name: string;

  search(article: string, brand?: string): Promise<SupplierOffer[]>;
  placeOrder(items: PlaceOrderItem[]): Promise<SupplierOrderResult>;
  getOrderStatus(externalOrderId: string): Promise<SupplierOrderStatusValue>;
  requestReturn(
    externalOrderId: string,
    items: ReturnItem[],
  ): Promise<ReturnResult>;
}

/** DI token: array of registered SupplierConnector providers. */
export const SUPPLIERS = Symbol('SUPPLIERS');
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- suppliers/types`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/suppliers/types.ts src/suppliers/supplier-connector.interface.ts src/suppliers/types.spec.ts
git commit -m "feat(suppliers): add normalized types, connector interface, SUPPLIERS token"
```

---

### Task 3: `Supplier` entity + migration + Rossko seed

**Files:**
- Create: `src/suppliers/entities/supplier.entity.ts`
- Create: `src/migrations/1700000000007-CreateSuppliers.ts`
- Modify: `src/config/data-source.ts` (add `Supplier` to entities)
- Modify: `src/app.module.ts` (add `Supplier` to TypeORM entities array)
- Test: `src/suppliers/entities/supplier.entity.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Supplier { id, code, name, isActive, markupPercent: number | null, config: Record<string, unknown>, createdAt, updatedAt }` mapped to table `suppliers`; a seeded `rossko` row after `migration:run`.

- [ ] **Step 1: Write the failing test**

Create `src/suppliers/entities/supplier.entity.spec.ts`:

```ts
import { Supplier, decimalTransformer } from './supplier.entity';

describe('Supplier entity', () => {
  it('can be instantiated with expected fields', () => {
    const s = new Supplier();
    s.code = 'rossko';
    s.name = 'Rossko';
    s.isActive = true;
    s.markupPercent = null;
    s.config = {};
    expect(s.code).toBe('rossko');
    expect(s.markupPercent).toBeNull();
  });

  it('decimalTransformer converts db string to number and null to null', () => {
    expect(decimalTransformer.from('20.00')).toBe(20);
    expect(decimalTransformer.from(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- supplier.entity`
Expected: FAIL — cannot find module `./supplier.entity`.

- [ ] **Step 3: Create `src/suppliers/entities/supplier.entity.ts`**

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** TypeORM returns decimal columns as strings; normalize to number|null. */
export const decimalTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null =>
    value === null || value === undefined ? null : Number(value),
};

@Entity('suppliers')
export class Supplier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 100 })
  code: string;

  @Column({ length: 255 })
  name: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 2,
    nullable: true,
    default: null,
    transformer: decimalTransformer,
  })
  markupPercent: number | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  config: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- supplier.entity`
Expected: PASS (2 tests).

- [ ] **Step 5: Create the migration `src/migrations/1700000000007-CreateSuppliers.ts`**

```ts
import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateSuppliers1700000000007 implements MigrationInterface {
  name = 'CreateSuppliers1700000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'suppliers',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'code', type: 'varchar', length: '100', isUnique: true },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'isActive', type: 'boolean', default: true },
          {
            name: 'markupPercent',
            type: 'decimal',
            precision: 6,
            scale: 2,
            isNullable: true,
            default: null,
          },
          { name: 'config', type: 'jsonb', default: "'{}'" },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    // Seed Rossko partner (markupPercent NULL => global DEFAULT_MARKUP_PERCENT).
    await queryRunner.query(
      `INSERT INTO suppliers (code, name, "isActive", "markupPercent", config)
       VALUES ('rossko', 'Rossko', true, NULL, '{}')
       ON CONFLICT (code) DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('suppliers');
  }
}
```

- [ ] **Step 6: Register `Supplier` in `src/config/data-source.ts`**

Add the import after the other entity imports:

```ts
import { Supplier } from '../suppliers/entities/supplier.entity';
```

Add `Supplier` to the `entities` array (after `OrderItem`):

```ts
  entities: [
    User,
    Product,
    ProductImage,
    ProductProperty,
    Cart,
    CartItem,
    Address,
    Category,
    Brand,
    Order,
    OrderItem,
    Supplier,
  ],
```

- [ ] **Step 7: Register `Supplier` in `src/app.module.ts`**

Add the import alongside the other entity imports:

```ts
import { Supplier } from './suppliers/entities/supplier.entity';
```

Add `Supplier` to the end of the `entities: [...]` array inside `TypeOrmModule.forRootAsync`'s `useFactory`:

```ts
        entities: [User, Product, ProductImage, ProductProperty, Cart, CartItem, Address, Category, Brand, Order, OrderItem, Supplier],
```

- [ ] **Step 8: Verify the build compiles**

Run: `npm run build`
Expected: completes with no TypeScript errors.

- [ ] **Step 9: Run the migration against the database**

Run: `npm run migration:run`
Expected: `CreateSuppliers1700000000007` runs; `suppliers` table created and `rossko` row inserted. (If no database is reachable in this environment, skip the live run and note it; the migration file is committed and will run in CI/deploy.)

- [ ] **Step 10: Commit**

```bash
git add src/suppliers/entities/supplier.entity.ts src/suppliers/entities/supplier.entity.spec.ts src/migrations/1700000000007-CreateSuppliers.ts src/config/data-source.ts src/app.module.ts
git commit -m "feat(suppliers): add Supplier entity, migration, and Rossko seed"
```

---

### Task 4: `SuppliersService` (partner config CRUD)

**Files:**
- Create: `src/suppliers/dto/update-supplier.dto.ts`
- Create: `src/suppliers/suppliers.service.ts`
- Test: `src/suppliers/suppliers.service.spec.ts`

**Interfaces:**
- Consumes: `Supplier` entity (Task 3).
- Produces: `SuppliersService` with:
  - `findAll(): Promise<Supplier[]>`
  - `findByCode(code: string): Promise<Supplier | null>`
  - `update(code: string, dto: UpdateSupplierDto): Promise<Supplier>` — throws `NotFoundException` if code missing.
  - `UpdateSupplierDto { isActive?: boolean; markupPercent?: number | null; config?: Record<string, unknown> }`

- [ ] **Step 1: Write the failing test**

Create `src/suppliers/suppliers.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';

function makeRepoMock(initial: any[] = []) {
  const rows = [...initial];
  return {
    rows,
    find: jest.fn(async () => rows),
    findOne: jest.fn(async ({ where: { code } }: any) =>
      rows.find((r) => r.code === code) ?? null,
    ),
    save: jest.fn(async (row: any) => row),
  };
}

describe('SuppliersService', () => {
  it('findAll returns all rows', async () => {
    const repo = makeRepoMock([{ code: 'rossko' }]);
    const service = new SuppliersService(repo as any);
    await expect(service.findAll()).resolves.toHaveLength(1);
  });

  it('findByCode returns the matching row or null', async () => {
    const repo = makeRepoMock([{ code: 'rossko' }]);
    const service = new SuppliersService(repo as any);
    await expect(service.findByCode('rossko')).resolves.toEqual({ code: 'rossko' });
    await expect(service.findByCode('nope')).resolves.toBeNull();
  });

  it('update mutates fields and saves', async () => {
    const repo = makeRepoMock([
      { code: 'rossko', isActive: true, markupPercent: null, config: {} },
    ]);
    const service = new SuppliersService(repo as any);
    const updated = await service.update('rossko', {
      isActive: false,
      markupPercent: 15,
    });
    expect(updated.isActive).toBe(false);
    expect(updated.markupPercent).toBe(15);
    expect(repo.save).toHaveBeenCalled();
  });

  it('update throws NotFoundException for unknown code', async () => {
    const repo = makeRepoMock([]);
    const service = new SuppliersService(repo as any);
    await expect(service.update('ghost', { isActive: false })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- suppliers.service`
Expected: FAIL — cannot find module `./suppliers.service`.

- [ ] **Step 3: Create `src/suppliers/dto/update-supplier.dto.ts`**

```ts
import { IsBoolean, IsNumber, IsObject, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSupplierDto {
  @ApiPropertyOptional({ description: 'Enable/disable the partner without redeploy' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Markup percent for this partner; null falls back to DEFAULT_MARKUP_PERCENT',
    minimum: 0,
    maximum: 1000,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  markupPercent?: number | null;

  @ApiPropertyOptional({ description: 'Non-sensitive partner config (URLs etc.)' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
```

- [ ] **Step 4: Create `src/suppliers/suppliers.service.ts`**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from './entities/supplier.entity';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly repo: Repository<Supplier>,
  ) {}

  findAll(): Promise<Supplier[]> {
    return this.repo.find();
  }

  findByCode(code: string): Promise<Supplier | null> {
    return this.repo.findOne({ where: { code } });
  }

  async update(code: string, dto: UpdateSupplierDto): Promise<Supplier> {
    const supplier = await this.findByCode(code);
    if (!supplier) {
      throw new NotFoundException(`Supplier "${code}" not found.`);
    }
    if (dto.isActive !== undefined) supplier.isActive = dto.isActive;
    if (dto.markupPercent !== undefined) supplier.markupPercent = dto.markupPercent;
    if (dto.config !== undefined) supplier.config = dto.config;
    return this.repo.save(supplier);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- suppliers.service`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/suppliers/dto/update-supplier.dto.ts src/suppliers/suppliers.service.ts src/suppliers/suppliers.service.spec.ts
git commit -m "feat(suppliers): add SuppliersService config CRUD + UpdateSupplierDto"
```

---

### Task 5: `SuppliersRegistry` (active filter + lookup)

**Files:**
- Create: `src/suppliers/suppliers.registry.ts`
- Test: `src/suppliers/suppliers.registry.spec.ts`

**Interfaces:**
- Consumes: `SUPPLIERS` token (Task 2), `SupplierConnector` (Task 2), `SuppliersService.findAll`/`findByCode` (Task 4).
- Produces: `SuppliersRegistry` with:
  - `getActive(): Promise<SupplierConnector[]>` — only connectors whose `suppliers` row has `isActive=true`.
  - `getByCode(code: string): Promise<SupplierConnector>` — throws `NotFoundException` if connector missing, `BadRequestException` if the row is inactive.

- [ ] **Step 1: Write the failing test**

Create `src/suppliers/suppliers.registry.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SuppliersRegistry } from './suppliers.registry';
import { SupplierConnector } from './supplier-connector.interface';

function fakeConnector(code: string): SupplierConnector {
  return {
    code,
    name: code,
    search: jest.fn(),
    placeOrder: jest.fn(),
    getOrderStatus: jest.fn(),
    requestReturn: jest.fn(),
  } as unknown as SupplierConnector;
}

describe('SuppliersRegistry', () => {
  const rossko = fakeConnector('rossko');
  const emex = fakeConnector('emex');

  function makeRegistry(rows: any[]) {
    const service = {
      findAll: jest.fn(async () => rows),
      findByCode: jest.fn(async (code: string) => rows.find((r) => r.code === code) ?? null),
    };
    return new SuppliersRegistry([rossko, emex], service as any);
  }

  it('getActive returns only connectors whose row isActive', async () => {
    const reg = makeRegistry([
      { code: 'rossko', isActive: true },
      { code: 'emex', isActive: false },
    ]);
    const active = await reg.getActive();
    expect(active.map((c) => c.code)).toEqual(['rossko']);
  });

  it('getActive excludes connectors with no config row', async () => {
    const reg = makeRegistry([{ code: 'rossko', isActive: true }]);
    const active = await reg.getActive();
    expect(active.map((c) => c.code)).toEqual(['rossko']);
  });

  it('getByCode returns the active connector', async () => {
    const reg = makeRegistry([{ code: 'rossko', isActive: true }]);
    await expect(reg.getByCode('rossko')).resolves.toBe(rossko);
  });

  it('getByCode throws NotFoundException for unknown connector', async () => {
    const reg = makeRegistry([{ code: 'rossko', isActive: true }]);
    await expect(reg.getByCode('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getByCode throws BadRequestException for an inactive supplier', async () => {
    const reg = makeRegistry([{ code: 'emex', isActive: false }]);
    await expect(reg.getByCode('emex')).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- suppliers.registry`
Expected: FAIL — cannot find module `./suppliers.registry`.

- [ ] **Step 3: Create `src/suppliers/suppliers.registry.ts`**

```ts
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SUPPLIERS, SupplierConnector } from './supplier-connector.interface';
import { SuppliersService } from './suppliers.service';

@Injectable()
export class SuppliersRegistry {
  constructor(
    @Inject(SUPPLIERS) private readonly connectors: SupplierConnector[],
    private readonly suppliersService: SuppliersService,
  ) {}

  async getActive(): Promise<SupplierConnector[]> {
    const rows = await this.suppliersService.findAll();
    const activeCodes = new Set(
      rows.filter((r) => r.isActive).map((r) => r.code),
    );
    return this.connectors.filter((c) => activeCodes.has(c.code));
  }

  async getByCode(code: string): Promise<SupplierConnector> {
    const connector = this.connectors.find((c) => c.code === code);
    if (!connector) {
      throw new NotFoundException(`Supplier connector "${code}" is not registered.`);
    }
    const row = await this.suppliersService.findByCode(code);
    if (!row || !row.isActive) {
      throw new BadRequestException(`Supplier "${code}" is inactive.`);
    }
    return connector;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- suppliers.registry`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/suppliers/suppliers.registry.ts src/suppliers/suppliers.registry.spec.ts
git commit -m "feat(suppliers): add SuppliersRegistry with active filtering and lookup"
```

---

### Task 6: `MockConnector` (reusable test connector)

**Files:**
- Create: `src/suppliers/connectors/mock/mock.connector.ts`
- Test: `src/suppliers/connectors/mock/mock.connector.spec.ts`

**Interfaces:**
- Consumes: `SupplierConnector` + types (Task 2).
- Produces: `MockConnector implements SupplierConnector` — controllable for Search/Cart/Orders tests:
  - constructor `(code = 'mock', name = 'Mock Supplier')`
  - `setOffers(offers: SupplierOffer[])`
  - `failWith(error: Error)` — makes `search` reject
  - `timeoutMs(ms: number)` — makes `search` resolve after a delay (default offers)
  - `setOrderResult(result: SupplierOrderResult)`, `setStatus(status: SupplierOrderStatusValue)`, `setReturnResult(result: ReturnResult)`
  - implements all four `SupplierConnector` methods.

- [ ] **Step 1: Write the failing test (contract test)**

Create `src/suppliers/connectors/mock/mock.connector.spec.ts`:

```ts
import { MockConnector } from './mock.connector';
import { SupplierOffer } from '../../types';

const offer: SupplierOffer = {
  supplierCode: 'mock',
  article: 'A1',
  brand: 'B',
  name: 'thing',
  costPrice: 1000,
  count: 5,
  deliveryDays: 2,
  multiplicity: 1,
  warehouseId: 'w1',
  isAnalog: false,
  raw: {},
};

describe('MockConnector (contract)', () => {
  it('implements the connector shape', () => {
    const c = new MockConnector();
    expect(c.code).toBe('mock');
    expect(typeof c.search).toBe('function');
    expect(typeof c.placeOrder).toBe('function');
    expect(typeof c.getOrderStatus).toBe('function');
    expect(typeof c.requestReturn).toBe('function');
  });

  it('returns configured offers from search', async () => {
    const c = new MockConnector();
    c.setOffers([offer]);
    await expect(c.search('A1', 'B')).resolves.toEqual([offer]);
  });

  it('search rejects when failWith is set', async () => {
    const c = new MockConnector();
    c.failWith(new Error('partner down'));
    await expect(c.search('A1')).rejects.toThrow('partner down');
  });

  it('placeOrder returns the configured result', async () => {
    const c = new MockConnector();
    c.setOrderResult({ externalOrderId: 'EXT-1', status: 'PLACED' });
    await expect(c.placeOrder([])).resolves.toEqual({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
  });

  it('getOrderStatus returns the configured status', async () => {
    const c = new MockConnector();
    c.setStatus('SHIPPED');
    await expect(c.getOrderStatus('EXT-1')).resolves.toBe('SHIPPED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- mock.connector`
Expected: FAIL — cannot find module `./mock.connector`.

- [ ] **Step 3: Create `src/suppliers/connectors/mock/mock.connector.ts`**

```ts
import { SupplierConnector } from '../../supplier-connector.interface';
import {
  PlaceOrderItem,
  ReturnItem,
  ReturnResult,
  SupplierOffer,
  SupplierOrderResult,
  SupplierOrderStatusValue,
} from '../../types';

/**
 * Controllable connector for Search/Cart/Orders tests.
 * Not registered in production providers — instantiated directly in tests.
 */
export class MockConnector implements SupplierConnector {
  private offers: SupplierOffer[] = [];
  private error: Error | null = null;
  private delayMs = 0;
  private orderResult: SupplierOrderResult = {
    externalOrderId: 'MOCK-EXT-1',
    status: 'PLACED',
  };
  private status: SupplierOrderStatusValue = 'PLACED';
  private returnResult: ReturnResult = { returnStatus: 'REQUESTED' };

  constructor(
    public readonly code = 'mock',
    public readonly name = 'Mock Supplier',
  ) {}

  setOffers(offers: SupplierOffer[]): this {
    this.offers = offers;
    return this;
  }

  failWith(error: Error): this {
    this.error = error;
    return this;
  }

  timeoutMs(ms: number): this {
    this.delayMs = ms;
    return this;
  }

  setOrderResult(result: SupplierOrderResult): this {
    this.orderResult = result;
    return this;
  }

  setStatus(status: SupplierOrderStatusValue): this {
    this.status = status;
    return this;
  }

  setReturnResult(result: ReturnResult): this {
    this.returnResult = result;
    return this;
  }

  async search(_article: string, _brand?: string): Promise<SupplierOffer[]> {
    if (this.error) throw this.error;
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    return this.offers;
  }

  async placeOrder(_items: PlaceOrderItem[]): Promise<SupplierOrderResult> {
    if (this.error) throw this.error;
    return this.orderResult;
  }

  async getOrderStatus(_externalOrderId: string): Promise<SupplierOrderStatusValue> {
    return this.status;
  }

  async requestReturn(
    _externalOrderId: string,
    _items: ReturnItem[],
  ): Promise<ReturnResult> {
    return this.returnResult;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- mock.connector`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/suppliers/connectors/mock/mock.connector.ts src/suppliers/connectors/mock/mock.connector.spec.ts
git commit -m "feat(suppliers): add reusable MockConnector for downstream spec tests"
```

---

### Task 7: `PricingService` + `PricingModule`

**Files:**
- Create: `src/pricing/pricing.service.ts`
- Create: `src/pricing/pricing.module.ts`
- Test: `src/pricing/pricing.service.spec.ts`

**Interfaces:**
- Consumes: `SuppliersService.findByCode` (Task 4), env `DEFAULT_MARKUP_PERCENT`.
- Produces: `PricingService.applyMarkup(costPrice: number, supplierCode: string): Promise<number>` — returns `Math.round(costPrice * (1 + markup/100))`, where markup = partner `markupPercent` if set else `DEFAULT_MARKUP_PERCENT` (env, default 20). `PricingModule` exports `PricingService`.

> **Note (deliberate deviation from spec signature):** the spec sketches `applyMarkup(...): number` (sync), but resolving the partner's markup requires a DB read and all callers (Search/Cart) are already async. We return `Promise<number>`. This is the practical, testable choice; the rounding/fallback semantics match the spec exactly.

- [ ] **Step 1: Write the failing test**

Create `src/pricing/pricing.service.spec.ts`:

```ts
import { PricingService } from './pricing.service';

function makeService(markupPercent: number | null | 'no-row') {
  const suppliersService = {
    findByCode: jest.fn(async () =>
      markupPercent === 'no-row' ? null : { code: 'rossko', markupPercent },
    ),
  };
  return new PricingService(suppliersService as any);
}

describe('PricingService.applyMarkup', () => {
  const OLD_ENV = process.env.DEFAULT_MARKUP_PERCENT;
  afterEach(() => {
    process.env.DEFAULT_MARKUP_PERCENT = OLD_ENV;
  });

  it('uses the partner markupPercent when set', async () => {
    const service = makeService(25);
    await expect(service.applyMarkup(1000, 'rossko')).resolves.toBe(1250);
  });

  it('falls back to DEFAULT_MARKUP_PERCENT when partner markup is null', async () => {
    process.env.DEFAULT_MARKUP_PERCENT = '20';
    const service = makeService(null);
    await expect(service.applyMarkup(1000, 'rossko')).resolves.toBe(1200);
  });

  it('falls back to DEFAULT_MARKUP_PERCENT when partner row is missing', async () => {
    process.env.DEFAULT_MARKUP_PERCENT = '10';
    const service = makeService('no-row');
    await expect(service.applyMarkup(1000, 'ghost')).resolves.toBe(1100);
  });

  it('defaults to 20 percent when env is unset', async () => {
    delete process.env.DEFAULT_MARKUP_PERCENT;
    const service = makeService(null);
    await expect(service.applyMarkup(1000, 'rossko')).resolves.toBe(1200);
  });

  it('rounds to the nearest whole tenge', async () => {
    const service = makeService(15);
    // 5200 * 1.15 = 5980 exactly; use a non-integer case:
    const svc = makeService(13);
    await expect(svc.applyMarkup(999, 'rossko')).resolves.toBe(1129); // 999*1.13 = 1128.87 -> 1129
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pricing.service`
Expected: FAIL — cannot find module `./pricing.service`.

- [ ] **Step 3: Create `src/pricing/pricing.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { SuppliersService } from '../suppliers/suppliers.service';

const DEFAULT_MARKUP_PERCENT = 20;

@Injectable()
export class PricingService {
  constructor(private readonly suppliersService: SuppliersService) {}

  async applyMarkup(costPrice: number, supplierCode: string): Promise<number> {
    const supplier = await this.suppliersService.findByCode(supplierCode);
    const markup =
      supplier?.markupPercent != null
        ? Number(supplier.markupPercent)
        : this.defaultMarkup();
    return Math.round(costPrice * (1 + markup / 100));
  }

  private defaultMarkup(): number {
    const raw = process.env.DEFAULT_MARKUP_PERCENT;
    const parsed = raw != null ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : DEFAULT_MARKUP_PERCENT;
  }
}
```

- [ ] **Step 4: Create `src/pricing/pricing.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { SuppliersModule } from '../suppliers/suppliers.module';

@Module({
  imports: [SuppliersModule],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
```

> `SuppliersModule` is created in Task 8 and must export `SuppliersService`. If executing strictly in order, this import resolves once Task 8 lands; build verification for pricing happens in Task 8 Step 7.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- pricing.service`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/pricing/pricing.service.ts src/pricing/pricing.module.ts src/pricing/pricing.service.spec.ts
git commit -m "feat(pricing): add PricingService.applyMarkup with partner/default markup"
```

---

### Task 8: Rossko connector + `SuppliersModule` wiring

**Files:**
- Create: `src/suppliers/connectors/rossko/rossko.connector.ts`
- Create: `src/suppliers/suppliers.module.ts`
- Modify: `src/rossko/rossko.service.ts` (add deprecation note)
- Modify: `src/app.module.ts` (import `SuppliersModule`, `PricingModule`)
- Test: `src/suppliers/connectors/rossko/rossko.connector.spec.ts`

**Interfaces:**
- Consumes: `SupplierConnector` + types (Task 2), `SUPPLIERS` token (Task 2), `SuppliersService`/`SuppliersRegistry` (Tasks 4-5), `Supplier` entity (Task 3).
- Produces:
  - `RosskoConnector implements SupplierConnector` (`code='rossko'`), `search()` maps SOAP XML → `SupplierOffer[]` (one offer per stock; `isAnalog` computed against the query); `placeOrder`/`getOrderStatus`/`requestReturn` throw `NotImplementedException`.
  - `RosskoConnector.parseOffers(xml: string, article: string, brand?: string): SupplierOffer[]` (public, for testing).
  - `SuppliersModule` providing+exporting `SuppliersService`, `SuppliersRegistry`, and the `SUPPLIERS` token (`[RosskoConnector]`).

- [ ] **Step 1: Write the failing test with an XML fixture**

Create `src/suppliers/connectors/rossko/rossko.connector.spec.ts`:

```ts
import { NotImplementedException } from '@nestjs/common';
import { RosskoConnector } from './rossko.connector';

// Minimal SOAP fixture mirroring the real shape: SearchResult.PartsList.Part[]
// -> crosses.Part[] -> stocks.stock[]. The parent part is 0451103316/BOSCH;
// one cross matches it (exact), one is a different number (analog).
const XML = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns:GetSearchResponse xmlns:ns="https://api.rossko.ru/">
      <SearchResult>
        <success>true</success>
        <text>0451103316</text>
        <PartsList>
          <Part>
            <partnumber>0451103316</partnumber>
            <brand>BOSCH</brand>
            <crosses>
              <Part>
                <guid>g-exact</guid>
                <partnumber>0451103316</partnumber>
                <brand>BOSCH</brand>
                <name>Oil Filter</name>
                <stocks>
                  <stock><id>s1</id><price>5200</price><count>10</count><multiplicity>1</multiplicity><delivery>3</delivery></stock>
                  <stock><id>s2</id><price>5400</price><count>4</count><multiplicity>1</multiplicity><delivery>1</delivery></stock>
                </stocks>
              </Part>
              <Part>
                <guid>g-analog</guid>
                <partnumber>W71262</partnumber>
                <brand>MANN</brand>
                <name>Oil Filter Analog</name>
                <stocks>
                  <stock><id>s3</id><price>4100</price><count>7</count><multiplicity>1</multiplicity><delivery>5</delivery></stock>
                </stocks>
              </Part>
            </crosses>
          </Part>
        </PartsList>
      </SearchResult>
    </ns:GetSearchResponse>
  </soap:Body>
</soap:Envelope>`;

describe('RosskoConnector.parseOffers', () => {
  const connector = new RosskoConnector();

  it('maps each stock to a SupplierOffer', () => {
    const offers = connector.parseOffers(XML, '0451103316', 'BOSCH');
    expect(offers).toHaveLength(3); // 2 stocks on exact + 1 on analog
    const first = offers.find((o) => o.warehouseId === 's1');
    expect(first).toMatchObject({
      supplierCode: 'rossko',
      article: '0451103316',
      brand: 'BOSCH',
      name: 'Oil Filter',
      costPrice: 5200,
      count: 10,
      deliveryDays: 3,
      multiplicity: 1,
      warehouseId: 's1',
      isAnalog: false,
    });
  });

  it('flags non-matching cross numbers as analogs', () => {
    const offers = connector.parseOffers(XML, '0451103316', 'BOSCH');
    const analog = offers.find((o) => o.warehouseId === 's3');
    expect(analog?.isAnalog).toBe(true);
    expect(analog?.article).toBe('W71262');
  });

  it('carries raw identifiers for placeOrder', () => {
    const offers = connector.parseOffers(XML, '0451103316', 'BOSCH');
    const first = offers.find((o) => o.warehouseId === 's1');
    expect(first?.raw).toMatchObject({ guid: 'g-exact', stockId: 's1' });
  });

  it('placeOrder is not implemented yet', async () => {
    await expect(connector.placeOrder([])).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- rossko.connector`
Expected: FAIL — cannot find module `./rossko.connector`.

- [ ] **Step 3: Create `src/suppliers/connectors/rossko/rossko.connector.ts`**

```ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotImplementedException,
} from '@nestjs/common';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { SupplierConnector } from '../../supplier-connector.interface';
import {
  PlaceOrderItem,
  ReturnItem,
  ReturnResult,
  SupplierOffer,
  SupplierOrderResult,
  SupplierOrderStatusValue,
} from '../../types';

@Injectable()
export class RosskoConnector implements SupplierConnector {
  readonly code = 'rossko';
  readonly name = 'Rossko';

  private readonly logger = new Logger(RosskoConnector.name);
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    isArray: (name) => ['Part', 'stock'].includes(name),
  });

  async search(article: string, brand?: string): Promise<SupplierOffer[]> {
    const soap = this.buildSoapEnvelope(article);
    let rawXml: string;
    try {
      const response = await axios.post(
        `${process.env.ROSSKO_API_URL}/service/v2.1/GetSearch`,
        soap,
        {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: 'https://api.rossko.ru/service/v2.1/GetSearch',
          },
          timeout: 15000,
        },
      );
      rawXml = response.data;
    } catch (err) {
      this.logger.error('Rossko API request failed', err?.message);
      throw new BadRequestException('External parts API is unavailable.');
    }
    return this.parseOffers(rawXml, article, brand);
  }

  /** Public for unit testing without a live SOAP call. */
  parseOffers(xml: string, article: string, brand?: string): SupplierOffer[] {
    const parsed = this.parser.parse(xml);
    const searchResult = parsed?.Envelope?.Body?.GetSearchResponse?.SearchResult;
    if (!searchResult) {
      throw new BadRequestException('Invalid response from parts API.');
    }

    const rawParts: any[] = searchResult?.PartsList?.Part ?? [];
    const wantArticle = this.normalize(article);
    const wantBrand = brand ? this.normalize(brand) : null;

    const seen = new Set<string>();
    const offers: SupplierOffer[] = [];

    for (const part of rawParts) {
      const crosses: any[] = part?.crosses?.Part ?? [];
      for (const cross of crosses) {
        const stocks: any[] = Array.isArray(cross?.stocks?.stock)
          ? cross.stocks.stock
          : [];
        const crossArticle = cross.partnumber ?? '';
        const crossBrand = cross.brand ?? '';
        const isAnalog = !(
          this.normalize(crossArticle) === wantArticle &&
          (wantBrand === null || this.normalize(crossBrand) === wantBrand)
        );

        for (const stock of stocks) {
          const warehouseId = String(stock.id);
          const dedupeKey = `${cross.guid}|${warehouseId}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          offers.push({
            supplierCode: this.code,
            article: crossArticle,
            brand: crossBrand,
            name: cross.name ?? '',
            costPrice: Number(stock.price),
            count: Number(stock.count),
            deliveryDays: Number(stock.delivery),
            multiplicity: Number(stock.multiplicity),
            warehouseId,
            isAnalog,
            raw: {
              guid: cross.guid,
              partnumber: crossArticle,
              brand: crossBrand,
              stockId: warehouseId,
            },
          });
        }
      }
    }

    return offers;
  }

  async placeOrder(_items: PlaceOrderItem[]): Promise<SupplierOrderResult> {
    throw new NotImplementedException(
      'Rossko placeOrder is not yet implemented — order requires manual processing (see Spec C).',
    );
  }

  async getOrderStatus(_externalOrderId: string): Promise<SupplierOrderStatusValue> {
    throw new NotImplementedException(
      'Rossko getOrderStatus is not yet implemented.',
    );
  }

  async requestReturn(
    _externalOrderId: string,
    _items: ReturnItem[],
  ): Promise<ReturnResult> {
    throw new NotImplementedException(
      'Rossko requestReturn is not yet implemented — handle return manually.',
    );
  }

  private normalize(value: string): string {
    return String(value ?? '').trim().toUpperCase();
  }

  private buildSoapEnvelope(text: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <tns:GetSearch xmlns:tns="https://api.rossko.ru/">
      <tns:KEY1>${process.env.ROSSKO_KEY1}</tns:KEY1>
      <tns:KEY2>${process.env.ROSSKO_KEY2}</tns:KEY2>
      <tns:text>${this.escapeXml(text)}</tns:text>
      <tns:delivery_id>${process.env.ROSSKO_DELIVERY_ID}</tns:delivery_id>
      <tns:address_id>${process.env.ROSSKO_ADDRESS_ID}</tns:address_id>
    </tns:GetSearch>
  </soap:Body>
</soap:Envelope>`;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- rossko.connector`
Expected: PASS (4 tests).

- [ ] **Step 5: Create `src/suppliers/suppliers.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './entities/supplier.entity';
import { SuppliersService } from './suppliers.service';
import { SuppliersRegistry } from './suppliers.registry';
import { SUPPLIERS } from './supplier-connector.interface';
import { RosskoConnector } from './connectors/rossko/rossko.connector';

@Module({
  imports: [TypeOrmModule.forFeature([Supplier])],
  providers: [
    SuppliersService,
    SuppliersRegistry,
    RosskoConnector,
    {
      provide: SUPPLIERS,
      useFactory: (rossko: RosskoConnector) => [rossko],
      inject: [RosskoConnector],
    },
  ],
  exports: [SuppliersService, SuppliersRegistry, SUPPLIERS],
})
export class SuppliersModule {}
```

- [ ] **Step 6: Mark the legacy Rossko service deprecated**

In `src/rossko/rossko.service.ts`, add a deprecation JSDoc directly above the `@Injectable()` class declaration (`export class RosskoService`):

```ts
/**
 * @deprecated Superseded by suppliers/connectors/rossko/rossko.connector.ts
 * (implements SupplierConnector). Kept temporarily so existing /api/parts
 * routes keep working; remove in a later cleanup task once all specs migrate.
 */
@Injectable()
export class RosskoService {
```

- [ ] **Step 7: Register `SuppliersModule` and `PricingModule` in `src/app.module.ts`**

Add imports near the other module imports:

```ts
import { SuppliersModule } from './suppliers/suppliers.module';
import { PricingModule } from './pricing/pricing.module';
```

Add both to the `imports: [...]` array (after `RosskoModule`):

```ts
    RosskoModule,
    SuppliersModule,
    PricingModule,
```

- [ ] **Step 8: Verify the whole project builds and all tests pass**

Run: `npm run build && npm test`
Expected: build succeeds; all spec files pass.

- [ ] **Step 9: Commit**

```bash
git add src/suppliers/connectors/rossko/rossko.connector.ts src/suppliers/connectors/rossko/rossko.connector.spec.ts src/suppliers/suppliers.module.ts src/rossko/rossko.service.ts src/app.module.ts
git commit -m "feat(suppliers): add Rossko connector, wire SuppliersModule + PricingModule"
```

---

### Task 9: `/api/suppliers` admin controller (with Swagger annotations)

**Files:**
- Create: `src/suppliers/suppliers.controller.ts`
- Modify: `src/suppliers/suppliers.module.ts` (register controller)
- Modify: `src/suppliers/entities/supplier.entity.ts` (add `@ApiProperty` annotations)
- Test: `src/suppliers/suppliers.controller.spec.ts`

**Interfaces:**
- Consumes: `SuppliersService` (Task 4), `UpdateSupplierDto` (Task 4), `RolesGuard`/`@Roles`/`UserRole`.
- Produces: `GET /api/suppliers` (list) and `PATCH /api/suppliers/:code` (update isActive/markupPercent/config), both ADMIN-only, annotated with `@ApiTags`/`@ApiOperation`/`@ApiBearerAuth`.

- [ ] **Step 1: Write the failing test**

Create `src/suppliers/suppliers.controller.spec.ts`:

```ts
import { SuppliersController } from './suppliers.controller';

describe('SuppliersController', () => {
  const service = {
    findAll: jest.fn(async () => [{ code: 'rossko' }]),
    update: jest.fn(async (code: string, dto: any) => ({ code, ...dto })),
  };
  const controller = new SuppliersController(service as any);

  it('GET list delegates to service.findAll', async () => {
    await expect(controller.findAll()).resolves.toEqual([{ code: 'rossko' }]);
    expect(service.findAll).toHaveBeenCalled();
  });

  it('PATCH delegates to service.update with code + dto', async () => {
    const dto = { isActive: false, markupPercent: 12 };
    await expect(controller.update('rossko', dto)).resolves.toEqual({
      code: 'rossko',
      isActive: false,
      markupPercent: 12,
    });
    expect(service.update).toHaveBeenCalledWith('rossko', dto);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- suppliers.controller`
Expected: FAIL — cannot find module `./suppliers.controller`.

- [ ] **Step 3: Create `src/suppliers/suppliers.controller.ts`**

```ts
import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { SuppliersService } from './suppliers.service';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@ApiTags('Suppliers')
@ApiBearerAuth()
@Controller('suppliers')
@UseGuards(RolesGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Roles(UserRole.ADMIN)
  @Get()
  @ApiOperation({ summary: 'List all supplier partner configs (ADMIN)' })
  findAll() {
    return this.suppliersService.findAll();
  }

  @Roles(UserRole.ADMIN)
  @Patch(':code')
  @ApiOperation({ summary: 'Update a supplier: isActive / markupPercent / config (ADMIN)' })
  @ApiParam({ name: 'code', example: 'rossko' })
  update(@Param('code') code: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliersService.update(code, dto);
  }
}
```

- [ ] **Step 4: Register the controller in `src/suppliers/suppliers.module.ts`**

Add the import:

```ts
import { SuppliersController } from './suppliers.controller';
```

Add `controllers` to the `@Module({...})` decorator (between `imports` and `providers`):

```ts
  controllers: [SuppliersController],
```

- [ ] **Step 5: Annotate the `Supplier` entity with `@ApiProperty` (Swagger model example)**

In `src/suppliers/entities/supplier.entity.ts`, add `import { ApiProperty } from '@nestjs/swagger';` and decorate each persisted field. Example for the first three (apply the same pattern to `isActive`, `markupPercent`, `config`, `createdAt`, `updatedAt`):

```ts
  @ApiProperty({ example: 'b3f1...uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'rossko', description: 'Unique partner code' })
  @Column({ unique: true, length: 100 })
  code: string;

  @ApiProperty({ example: 'Rossko' })
  @Column({ length: 255 })
  name: string;

  @ApiProperty({ example: true })
  @Column({ default: true })
  isActive: boolean;

  @ApiProperty({ example: 20, nullable: true, description: 'null => DEFAULT_MARKUP_PERCENT' })
  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true, default: null, transformer: decimalTransformer })
  markupPercent: number | null;

  @ApiProperty({ example: {}, description: 'Non-sensitive partner config' })
  @Column({ type: 'jsonb', default: () => "'{}'" })
  config: Record<string, unknown>;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- suppliers.controller`
Expected: PASS (2 tests).

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add src/suppliers/suppliers.controller.ts src/suppliers/suppliers.controller.spec.ts src/suppliers/suppliers.module.ts src/suppliers/entities/supplier.entity.ts
git commit -m "feat(suppliers): add /api/suppliers ADMIN controller with Swagger annotations"
```

---

### Task 10: Swagger setup in `main.ts` + reconcile `/api/docs`

**Files:**
- Modify: `src/main.ts` (mount SwaggerModule at `api/docs`)
- Modify: `src/docs/docs.module.ts` (stop registering the conflicting `DocsController`)
- Modify: `src/docs/docs.controller.ts` (add deprecation note — file retained, no longer wired)

**Interfaces:**
- Consumes: all annotated controllers/DTOs (Tasks 9).
- Produces: generated OpenAPI served at `/api/docs` (Swagger UI) and `/api/docs-json` (JSON), replacing the hand-written Stoplight/`openapi.yaml` page as the single canonical docs path.

- [ ] **Step 1: Add Swagger bootstrap to `src/main.ts`**

Add the import at the top with the other imports:

```ts
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
```

Inside `bootstrap()`, **after** `app.setGlobalPrefix('api');` and **before** `await app.listen(port);`, add:

```ts
  const swaggerConfig = new DocumentBuilder()
    .setTitle('optparts.kz API')
    .setDescription('Multi-supplier auto parts aggregator API')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);
```

- [ ] **Step 2: Stop registering the conflicting `DocsController` in `src/docs/docs.module.ts`**

Open `src/docs/docs.module.ts`. Remove `DocsController` from the `controllers: [...]` array (leave the array empty `controllers: []` or remove the key entirely) and remove its import, so the legacy `@Get('docs')` route no longer collides with `SwaggerModule.setup('api/docs', ...)`. Keep `DocsModule` imported in `app.module.ts` (it is now a no-op placeholder, leaving room without a larger refactor).

- [ ] **Step 3: Add a deprecation note to `src/docs/docs.controller.ts`**

Add directly above `export class DocsController`:

```ts
/**
 * @deprecated The hand-written Stoplight/openapi.yaml docs are superseded by
 * generated Swagger served at /api/docs (see main.ts). This controller is no
 * longer registered in DocsModule; kept only for reference until removed.
 */
```

- [ ] **Step 4: Verify the app builds and boots with Swagger**

Run: `npm run build`
Expected: no TypeScript errors.

Then (if a database is reachable) run: `npm run start` and confirm `GET http://localhost:3000/api/docs` returns the Swagger UI and `GET /api/docs-json` returns JSON containing the `Suppliers` tag. If no DB is reachable, verify the build only and note the manual check is deferred.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/docs/docs.module.ts src/docs/docs.controller.ts
git commit -m "feat(docs): serve generated Swagger at /api/docs, deprecate hand-written spec"
```

---

### Task 11: Documentation — README + `.env.example`

**Files:**
- Modify: `README.md` (add "Поставщики (агрегатор)" section)
- Modify: `.env.example` (document `DEFAULT_MARKUP_PERCENT` + Rossko keys)

**Interfaces:**
- Consumes: everything built above.
- Produces: developer docs for adding a partner; documented env vars.

- [ ] **Step 1: Append the suppliers section to `README.md`**

Append at the end of `README.md`:

```markdown
## Поставщики (агрегатор)

Бэкенд работает как агрегатор предложений партнёров-поставщиков. Каждый партнёр
подключается через **коннектор** — класс, реализующий контракт
`SupplierConnector` (`src/suppliers/supplier-connector.interface.ts`). Коннектор
инкапсулирует протокол партнёра (SOAP/REST/прайс) и наружу отдаёт только
нормализованные типы из `src/suppliers/types.ts` (`SupplierOffer` и др.).

### Как добавить нового партнёра

1. **Создать коннектор:** `src/suppliers/connectors/<partner>/<partner>.connector.ts`,
   класс с `@Injectable()`, реализующий `SupplierConnector`
   (`code`, `name`, `search`, `placeOrder`, `getOrderStatus`, `requestReturn`).
   Методы, недоступные у партнёра, бросают `NotImplementedException`.
2. **Зарегистрировать в провайдерах `SUPPLIERS`:** в `src/suppliers/suppliers.module.ts`
   добавить класс в `providers` и в фабрику токена `SUPPLIERS`
   (`useFactory: (rossko, partner) => [rossko, partner]`, `inject: [...]`).
3. **Завести запись в таблице `suppliers`:** строка с `code` партнёра, `name`,
   `isActive`, опциональным `markupPercent` (миграцией или через
   `PATCH /api/suppliers/:code`). Секреты (ключи API) — в `.env`, не в БД.

Ядро (`SuppliersRegistry`, `SearchService`, `PricingService`) трогать не нужно —
реестр сам подхватит активный коннектор.

### Наценка (pricing)

`PricingService.applyMarkup(costPrice, supplierCode)` превращает закупочную цену в
продажную: `sellPrice = round(costPrice * (1 + markup/100))`. `markup` берётся из
`suppliers.markupPercent` партнёра, иначе из `DEFAULT_MARKUP_PERCENT` (`.env`).
Закупочная цена клиенту никогда не отдаётся.

### API-документация

Swagger доступен по `/api/docs` (UI) и `/api/docs-json` (OpenAPI JSON),
генерируется из аннотаций контроллеров/DTO. Эталон — контроллер `/api/suppliers`.
```

- [ ] **Step 2: Document new env vars in `.env.example`**

Append to `.env.example`:

```env

# Pricing
# Default markup percent applied when a supplier has no markupPercent set
DEFAULT_MARKUP_PERCENT=20

# Rossko supplier (SOAP API credentials)
ROSSKO_API_URL=https://api.rossko.ru
ROSSKO_KEY1=your-rossko-key1
ROSSKO_KEY2=your-rossko-key2
ROSSKO_DELIVERY_ID=your-delivery-id
ROSSKO_ADDRESS_ID=your-address-id
```

- [ ] **Step 3: Commit**

```bash
git add README.md .env.example
git commit -m "docs: document suppliers aggregator, markup, and new env vars"
```

---

### Task 12: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all spec files pass (types, supplier.entity, suppliers.service, suppliers.registry, mock.connector, pricing.service, rossko.connector, suppliers.controller).

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 3: (If DB reachable) run migrations and boot**

Run: `npm run migration:run && npm run start`
Expected: `suppliers` table present with seeded `rossko`; app boots; `GET /api/docs` shows Swagger UI including the `Suppliers` tag. If no DB is available in this environment, note this step as deferred to deploy/CI.

- [ ] **Step 4: Confirm acceptance criteria**

Tick each spec acceptance item against the implementation:
- `SupplierConnector`, types, registry, `SUPPLIERS` token exported (Tasks 2, 5, 8).
- `suppliers` table + migration + Rossko seed (Task 3).
- `PricingService.applyMarkup` works and is tested (Task 7).
- Rossko available as a connector via the registry; legacy module deprecated, not deleted (Task 8).
- `MockConnector` available for other specs (Task 6).
- `/api/suppliers` ADMIN list + edit (Task 9).
- Swagger at `/api/docs` serving generated spec; `/api/suppliers` annotated (Tasks 9, 10).
- README + `.env` documented (Task 11).
```
