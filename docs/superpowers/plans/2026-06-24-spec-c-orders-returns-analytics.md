# Spec C — Orders + supplier_order + Returns + partner_products — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the aggregator checkout flow — final live re-check via cart, per-partner order placement with partial success, manager controls (refresh-status / retry / returns), an immutable order snapshot, and the `partner_products` analytics catalog.

**Architecture:** `POST /api/orders` pulls fresh checkout items from `CartService.getCheckoutItems()` (consumed through a local `CART_CHECKOUT` DI seam — a stub now, swapped for the real `CartService` at merge), snapshots them into `order_items`, groups them by `supplierCode`, and places one `supplier_order` per partner via `SuppliersRegistry` + connector `placeOrder`. Order status aggregates from the sub-orders (`PLACED` / `PARTIALLY_PLACED`). Manager endpoints drive `getOrderStatus` / retry `placeOrder` / `requestReturn` (semi-automatic: `NotImplementedException` ⇒ manual `returnStatus=REQUESTED`). A separate `partner-products` module upserts an analytics catalog on each checkout.

**Tech Stack:** NestJS 10, TypeORM 0.3.17 + PostgreSQL, class-validator/class-transformer, `@nestjs/swagger`, Jest + ts-jest.

## Global Constraints

- **Framework/conventions:** NestJS 10, TypeORM 0.3.17. Match existing patterns exactly.
- **Config access:** read environment via `process.env.*` directly (no `ConfigService`).
- **Entity conventions:** `@Entity('snake_case_table')`, columns declared in `camelCase`, PK = `@PrimaryGeneratedColumn('uuid')`, `@CreateDateColumn()`/`@UpdateDateColumn()`, decimals via `@Column({ type: 'decimal', precision, scale })`.
- **Decimal reads:** TypeORM returns `decimal` columns as **strings** — reuse the exported `decimalTransformer` from `src/suppliers/entities/supplier.entity.ts` so values come back as `number | null`, and always `Number(...)` before arithmetic on any raw decimal.
- **Migrations:** files in `src/migrations/`, named `{timestamp}-{Description}.ts`, `implements MigrationInterface` with `name = '...'`, raw SQL via `queryRunner.query(...)`, **double-quote** every camelCase identifier (`"supplierCode"`). Run via `npm run migration:run`. Next free timestamps: `1700000000008`, `1700000000009`, `1700000000010` (007 is taken by `CreateSuppliers`).
- **Auth:** global `JwtAuthGuard`; manager/admin routes use `@UseGuards(RolesGuard)` (class-level, already present on `OrdersController`) + `@Roles(UserRole.MANAGER, UserRole.ADMIN)` / `@Roles(UserRole.ADMIN)`. Import `UserRole` from `../users/entities/user.entity`. Current user via `@CurrentUser()` decorator returning a `User` (`user.id`, `user.roles`).
- **Validation:** global `ValidationPipe` with `whitelist: true, forbidNonWhitelisted: true, transform: true` — every request DTO field MUST carry a class-validator decorator or it is stripped/rejected. Query numbers need `@Type(() => Number)`.
- **Swagger:** `@ApiTags`, `@ApiBearerAuth`, `@ApiOperation`, `@ApiParam`, `@ApiResponse`, `@ApiProperty(Optional)` — match `SuppliersController` style.
- **Foundation types (do not redefine):** import from `src/suppliers/` — `SupplierConnector`, `SuppliersRegistry`, `PlaceOrderItem`, `SupplierOrderResult`, `SupplierOrderStatusValue`, `ReturnItem`, `ReturnResult`, `SUPPLIERS`, `MockConnector`. `SuppliersModule` exports `SuppliersRegistry`.
- **Cart seam:** the ONLY contact point with Spec B is `CartService.getCheckoutItems()` (+ `clearCart()`). Code against the local `CART_CHECKOUT` stub; do NOT touch `src/cart/*` or `src/search/*`. A `// MERGE:` comment marks the provider to swap at merge.
- **Canonical shared-file edits:** `src/app.module.ts`, `src/config/data-source.ts` — append only.
- **Immutability:** `order_items` / `supplier_order` are NEVER mutated by a re-check after creation; live re-check applies to the cart only. Partner name/data come from the snapshot.

---

### Task 1: Extend `order_items` with the offer snapshot (entity + migration)

**Files:**
- Modify: `src/orders/entities/order-item.entity.ts`
- Create: `src/migrations/1700000000008-ExtendOrderItemSnapshot.ts`
- Test: `src/orders/entities/order-item.entity.spec.ts`

**Interfaces:**
- Consumes: `decimalTransformer` from `src/suppliers/entities/supplier.entity.ts`.
- Produces: `OrderItem` gains nullable snapshot columns `supplierCode, article, brand, costPrice, sellPrice, warehouseId, raw`; `productId` already nullable; legacy `productSku`/`priceAtOrder` stay NOT NULL (populated from the snapshot at write time).

- [ ] **Step 1: Write the failing test**

Create `src/orders/entities/order-item.entity.spec.ts`:

```ts
import { OrderItem } from './order-item.entity';

describe('OrderItem snapshot fields', () => {
  it('holds aggregator offer snapshot fields', () => {
    const item = new OrderItem();
    item.productId = null;
    item.supplierCode = 'rossko';
    item.article = '0451103316';
    item.brand = 'BOSCH';
    item.costPrice = 5200;
    item.sellPrice = 6240;
    item.warehouseId = 's1';
    item.raw = { guid: 'g1', stockId: 's1' };
    item.quantity = 2;
    item.subtotal = 12480;

    expect(item.productId).toBeNull();
    expect(item.supplierCode).toBe('rossko');
    expect(item.raw).toMatchObject({ guid: 'g1' });
    expect(item.sellPrice).toBe(6240);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- order-item.entity`
Expected: FAIL — TypeScript errors: property `supplierCode`/`raw`/`sellPrice` does not exist on `OrderItem`.

- [ ] **Step 3: Add snapshot columns to `src/orders/entities/order-item.entity.ts`**

Add the import at the top (after existing imports):

```ts
import { decimalTransformer } from '../../suppliers/entities/supplier.entity';
```

Inside the `OrderItem` class, after the existing `subtotal` column (and before `createdAt`), add:

```ts
  // --- Aggregator offer snapshot (Spec C). Nullable: legacy product items leave these null. ---
  @Column({ type: 'varchar', length: 100, nullable: true })
  supplierCode: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  article: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  brand: string | null;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  costPrice: number | null;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  sellPrice: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  warehouseId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  raw: Record<string, unknown> | null;
```

Also relax the existing `productId` column to be explicit about nullability if it is not already (it already is `nullable: true` per the create migration — leave as-is).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- order-item.entity`
Expected: PASS (1 test).

- [ ] **Step 5: Create the migration `src/migrations/1700000000008-ExtendOrderItemSnapshot.ts`**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendOrderItemSnapshot1700000000008 implements MigrationInterface {
  name = 'ExtendOrderItemSnapshot1700000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items"
        ADD COLUMN "supplierCode" varchar(100)  DEFAULT NULL,
        ADD COLUMN "article"      varchar(100)  DEFAULT NULL,
        ADD COLUMN "brand"        varchar(100)  DEFAULT NULL,
        ADD COLUMN "costPrice"    numeric(12,2) DEFAULT NULL,
        ADD COLUMN "sellPrice"    numeric(12,2) DEFAULT NULL,
        ADD COLUMN "warehouseId"  varchar(100)  DEFAULT NULL,
        ADD COLUMN "raw"          jsonb         DEFAULT NULL
    `);
    // productId is already nullable (created with DEFAULT NULL); ensure it explicitly.
    await queryRunner.query(
      `ALTER TABLE "order_items" ALTER COLUMN "productId" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items"
        DROP COLUMN "supplierCode",
        DROP COLUMN "article",
        DROP COLUMN "brand",
        DROP COLUMN "costPrice",
        DROP COLUMN "sellPrice",
        DROP COLUMN "warehouseId",
        DROP COLUMN "raw"
    `);
  }
}
```

- [ ] **Step 6: Verify build compiles**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/orders/entities/order-item.entity.ts src/orders/entities/order-item.entity.spec.ts src/migrations/1700000000008-ExtendOrderItemSnapshot.ts
git commit -m "feat(orders): extend order_item with offer snapshot fields + migration"
```

---

### Task 2: `SupplierOrder` entity + `OrderStatus` values + `Order.supplierOrders` relation (+ migration)

**Files:**
- Create: `src/orders/entities/supplier-order.entity.ts`
- Modify: `src/orders/entities/order.entity.ts`
- Create: `src/migrations/1700000000009-CreateSupplierOrder.ts`
- Test: `src/orders/entities/supplier-order.entity.spec.ts`

**Interfaces:**
- Consumes: `SupplierOrderStatusValue` from `src/suppliers/types.ts`; `Order` entity.
- Produces:
  - `SupplierOrderReturnStatus = 'REQUESTED' | 'IN_PROGRESS' | 'DONE' | 'REJECTED'`
  - `SupplierOrder { id, orderId, order, supplierCode, externalOrderId: string | null, status: SupplierOrderStatusValue, errorMessage: string | null, returnStatus: SupplierOrderReturnStatus | null, externalReturnId: string | null, createdAt, updatedAt }` mapped to table `supplier_orders`.
  - `OrderStatus.PLACED = 'placed'`, `OrderStatus.PARTIALLY_PLACED = 'partially_placed'`.
  - `Order.supplierOrders: SupplierOrder[]` (OneToMany, eager).

- [ ] **Step 1: Write the failing test**

Create `src/orders/entities/supplier-order.entity.spec.ts`:

```ts
import { SupplierOrder } from './supplier-order.entity';
import { OrderStatus } from './order.entity';

describe('SupplierOrder entity', () => {
  it('can hold a placed sub-order', () => {
    const sub = new SupplierOrder();
    sub.supplierCode = 'rossko';
    sub.externalOrderId = 'EXT-1';
    sub.status = 'PLACED';
    sub.errorMessage = null;
    sub.returnStatus = null;
    expect(sub.supplierCode).toBe('rossko');
    expect(sub.status).toBe('PLACED');
  });

  it('OrderStatus exposes PLACED and PARTIALLY_PLACED', () => {
    expect(OrderStatus.PLACED).toBe('placed');
    expect(OrderStatus.PARTIALLY_PLACED).toBe('partially_placed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- supplier-order.entity`
Expected: FAIL — cannot find module `./supplier-order.entity` (and `OrderStatus.PLACED` undefined).

- [ ] **Step 3: Add new statuses + relation to `src/orders/entities/order.entity.ts`**

Extend the `OrderStatus` enum (add the two values; keep existing):

```ts
export enum OrderStatus {
  NEW = 'new',
  PAID = 'paid',
  PENDING = 'pending',
  PLACED = 'placed',
  PARTIALLY_PLACED = 'partially_placed',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}
```

If an `OrderStatusLabel` map exists in the file, add labels for the two new values (Russian, matching the existing style), e.g.:

```ts
  [OrderStatus.PLACED]: 'Размещён у партнёров',
  [OrderStatus.PARTIALLY_PLACED]: 'Размещён частично',
```

Add the `SupplierOrder` import at the top:

```ts
import { SupplierOrder } from './supplier-order.entity';
```

Add the relation inside the `Order` class (after the `items` relation):

```ts
  @OneToMany(() => SupplierOrder, (so) => so.order, { cascade: true, eager: true })
  supplierOrders: SupplierOrder[];
```

(`OneToMany` is already imported in this file for `items`; if not, add it to the `typeorm` import.)

- [ ] **Step 4: Create `src/orders/entities/supplier-order.entity.ts`**

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { SupplierOrderStatusValue } from '../../suppliers/types';

export type SupplierOrderReturnStatus =
  | 'REQUESTED'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'REJECTED';

@Entity('supplier_orders')
export class SupplierOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, (order) => order.supplierOrders, {
    onDelete: 'CASCADE',
  })
  @JoinColumn()
  order: Order;

  @Column()
  orderId: string;

  @Column({ length: 100 })
  supplierCode: string;

  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  externalOrderId: string | null;

  @Column({ type: 'varchar', default: 'NEW' })
  status: SupplierOrderStatusValue;

  @Column({ type: 'text', nullable: true, default: null })
  errorMessage: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  returnStatus: SupplierOrderReturnStatus | null;

  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  externalReturnId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- supplier-order.entity`
Expected: PASS (2 tests).

- [ ] **Step 6: Create the migration `src/migrations/1700000000009-CreateSupplierOrder.ts`**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSupplierOrder1700000000009 implements MigrationInterface {
  name = 'CreateSupplierOrder1700000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "supplier_orders" (
        "id"               uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "orderId"          uuid          NOT NULL,
        "supplierCode"     varchar(100)  NOT NULL,
        "externalOrderId"  varchar(255)  DEFAULT NULL,
        "status"           varchar       NOT NULL DEFAULT 'NEW',
        "errorMessage"     text          DEFAULT NULL,
        "returnStatus"     varchar(50)   DEFAULT NULL,
        "externalReturnId" varchar(255)  DEFAULT NULL,
        "createdAt"        TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"        TIMESTAMP     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_supplier_orders" PRIMARY KEY ("id"),
        CONSTRAINT "FK_supplier_orders_orders" FOREIGN KEY ("orderId")
          REFERENCES "orders"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_supplier_orders_orderId" ON "supplier_orders" ("orderId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "supplier_orders"`);
  }
}
```

- [ ] **Step 7: Verify build compiles**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add src/orders/entities/supplier-order.entity.ts src/orders/entities/supplier-order.entity.spec.ts src/orders/entities/order.entity.ts src/migrations/1700000000009-CreateSupplierOrder.ts
git commit -m "feat(orders): add SupplierOrder entity, PARTIALLY_PLACED/PLACED statuses, migration"
```

---

### Task 3: `PartnerProduct` entity + migration

**Files:**
- Create: `src/partner-products/entities/partner-product.entity.ts`
- Create: `src/migrations/1700000000010-CreatePartnerProducts.ts`
- Test: `src/partner-products/entities/partner-product.entity.spec.ts`

**Interfaces:**
- Consumes: `decimalTransformer` from `src/suppliers/entities/supplier.entity.ts`.
- Produces: `PartnerProduct { id, supplierCode, article, brand, name, firstSeenAt, lastSeenAt, lastKnownCostPrice: number | null, lastKnownSellPrice: number | null, timesOrdered }` mapped to table `partner_products` with unique `(supplierCode, article, brand)`.

- [ ] **Step 1: Write the failing test**

Create `src/partner-products/entities/partner-product.entity.spec.ts`:

```ts
import { PartnerProduct } from './partner-product.entity';

describe('PartnerProduct entity', () => {
  it('can be instantiated with catalog fields', () => {
    const p = new PartnerProduct();
    p.supplierCode = 'rossko';
    p.article = '0451103316';
    p.brand = 'BOSCH';
    p.name = 'Oil Filter';
    p.lastKnownCostPrice = 5200;
    p.lastKnownSellPrice = 6240;
    p.timesOrdered = 1;
    expect(p.supplierCode).toBe('rossko');
    expect(p.timesOrdered).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- partner-product.entity`
Expected: FAIL — cannot find module `./partner-product.entity`.

- [ ] **Step 3: Create `src/partner-products/entities/partner-product.entity.ts`**

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Unique,
  CreateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { decimalTransformer } from '../../suppliers/entities/supplier.entity';

@Entity('partner_products')
@Unique('UQ_partner_products_offer', ['supplierCode', 'article', 'brand'])
export class PartnerProduct {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ length: 100 })
  supplierCode: string;

  @ApiProperty()
  @Column({ length: 100 })
  article: string;

  @ApiProperty()
  @Column({ length: 100 })
  brand: string;

  @ApiProperty()
  @Column({ length: 255 })
  name: string;

  @ApiProperty()
  @CreateDateColumn()
  firstSeenAt: Date;

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'now()' })
  lastSeenAt: Date;

  @ApiProperty({ type: Number, nullable: true })
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  lastKnownCostPrice: number | null;

  @ApiProperty({ type: Number, nullable: true })
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  lastKnownSellPrice: number | null;

  @ApiProperty()
  @Column({ type: 'int', default: 0 })
  timesOrdered: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- partner-product.entity`
Expected: PASS (1 test).

- [ ] **Step 5: Create the migration `src/migrations/1700000000010-CreatePartnerProducts.ts`**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePartnerProducts1700000000010 implements MigrationInterface {
  name = 'CreatePartnerProducts1700000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "partner_products" (
        "id"                 uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "supplierCode"       varchar(100)  NOT NULL,
        "article"            varchar(100)  NOT NULL,
        "brand"              varchar(100)  NOT NULL,
        "name"               varchar(255)  NOT NULL,
        "firstSeenAt"        TIMESTAMP     NOT NULL DEFAULT now(),
        "lastSeenAt"         TIMESTAMP     NOT NULL DEFAULT now(),
        "lastKnownCostPrice" numeric(12,2) DEFAULT NULL,
        "lastKnownSellPrice" numeric(12,2) DEFAULT NULL,
        "timesOrdered"       int           NOT NULL DEFAULT 0,
        CONSTRAINT "PK_partner_products" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_partner_products_offer" UNIQUE ("supplierCode", "article", "brand")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "partner_products"`);
  }
}
```

- [ ] **Step 6: Verify build compiles**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/partner-products/entities/partner-product.entity.ts src/partner-products/entities/partner-product.entity.spec.ts src/migrations/1700000000010-CreatePartnerProducts.ts
git commit -m "feat(analytics): add PartnerProduct entity + migration"
```

---

### Task 4: Cart checkout seam — `CheckoutItem` contract + `CART_CHECKOUT` token + stub

**Files:**
- Create: `src/orders/cart-checkout.contract.ts`
- Test: `src/orders/cart-checkout.contract.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface CheckoutItem { supplierCode; article; brand; productName; costPrice; sellPrice; currentPrice; priceAtAdd; warehouseId; raw; quantity; available; priceChanged }` (verbatim from Spec B §5).
  - `interface CartCheckoutContract { getCheckoutItems(userId: string): Promise<CheckoutItem[]>; clearCart(userId: string): Promise<unknown>; }`
  - `const CART_CHECKOUT = Symbol('CART_CHECKOUT')` — DI token.
  - `class CartCheckoutStub implements CartCheckoutContract` — throws `ServiceUnavailableException` (placeholder until Spec B merge).

- [ ] **Step 1: Write the failing test**

Create `src/orders/cart-checkout.contract.spec.ts`:

```ts
import { ServiceUnavailableException } from '@nestjs/common';
import { CART_CHECKOUT, CartCheckoutStub } from './cart-checkout.contract';

describe('cart checkout seam', () => {
  it('exposes the CART_CHECKOUT DI token as a symbol', () => {
    expect(typeof CART_CHECKOUT).toBe('symbol');
  });

  it('stub throws ServiceUnavailable until Spec B is merged', async () => {
    const stub = new CartCheckoutStub();
    await expect(stub.getCheckoutItems('u1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- cart-checkout.contract`
Expected: FAIL — cannot find module `./cart-checkout.contract`.

- [ ] **Step 3: Create `src/orders/cart-checkout.contract.ts`**

```ts
import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/**
 * Checkout contract shared with Spec B (Cart). Frozen identically in both specs.
 * Returns cart positions with a fresh live re-check.
 */
export interface CheckoutItem {
  supplierCode: string;
  article: string;
  brand: string;
  productName: string;
  costPrice: number;
  sellPrice: number;
  currentPrice: number;
  priceAtAdd: number;
  warehouseId: string;
  raw: Record<string, unknown>;
  quantity: number;
  available: boolean;
  priceChanged: boolean;
}

export interface CartCheckoutContract {
  getCheckoutItems(userId: string): Promise<CheckoutItem[]>;
  clearCart(userId: string): Promise<unknown>;
}

/** DI token for the cart checkout seam. */
export const CART_CHECKOUT = Symbol('CART_CHECKOUT');

/**
 * MERGE: this stub is the seam with Spec B. Once CartModule is merged,
 * replace the `{ provide: CART_CHECKOUT, useClass: CartCheckoutStub }`
 * provider in OrdersModule with `{ provide: CART_CHECKOUT, useExisting: CartService }`
 * (and import CartModule). CartService already implements getCheckoutItems()/clearCart().
 */
@Injectable()
export class CartCheckoutStub implements CartCheckoutContract {
  getCheckoutItems(_userId: string): Promise<CheckoutItem[]> {
    throw new ServiceUnavailableException(
      'Cart integration not wired yet — merge Spec B (CartService.getCheckoutItems).',
    );
  }

  clearCart(_userId: string): Promise<unknown> {
    throw new ServiceUnavailableException(
      'Cart integration not wired yet — merge Spec B (CartService.clearCart).',
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- cart-checkout.contract`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orders/cart-checkout.contract.ts src/orders/cart-checkout.contract.spec.ts
git commit -m "feat(orders): add cart checkout contract seam (CART_CHECKOUT stub)"
```

---

### Task 5: `PartnerProductsService` (analytics upsert + query)

**Files:**
- Create: `src/partner-products/dto/query-partner-products.dto.ts`
- Create: `src/partner-products/partner-products.service.ts`
- Test: `src/partner-products/partner-products.service.spec.ts`

**Interfaces:**
- Consumes: `PartnerProduct` entity (Task 3).
- Produces:
  - `interface RecordOrderInput { supplierCode: string; article: string; brand: string; name: string; costPrice: number; sellPrice: number; }`
  - `PartnerProductsService.recordOrder(input: RecordOrderInput): Promise<PartnerProduct>` — insert new (`timesOrdered=1`, `firstSeenAt`/`lastSeenAt`=now) or update existing (`lastSeenAt`=now, `lastKnown*Price` refreshed, `timesOrdered += 1`).
  - `PartnerProductsService.findMany(query: QueryPartnerProductsDto): Promise<{ items: PartnerProduct[]; total: number; page: number; limit: number }>`
  - `QueryPartnerProductsDto { supplierCode?: string; article?: string; page: number = 1; limit: number = 20 }`

- [ ] **Step 1: Write the failing test**

Create `src/partner-products/partner-products.service.spec.ts`:

```ts
import { PartnerProductsService } from './partner-products.service';

function makeRepoMock(initial: any[] = []) {
  const rows = [...initial];
  return {
    rows,
    findOne: jest.fn(async ({ where }: any) =>
      rows.find(
        (r) =>
          r.supplierCode === where.supplierCode &&
          r.article === where.article &&
          r.brand === where.brand,
      ) ?? null,
    ),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (row: any) => {
      if (!rows.includes(row)) rows.push(row);
      return row;
    }),
    findAndCount: jest.fn(async () => [rows, rows.length]),
  };
}

describe('PartnerProductsService', () => {
  const input = {
    supplierCode: 'rossko',
    article: 'A1',
    brand: 'BOSCH',
    name: 'Filter',
    costPrice: 5200,
    sellPrice: 6240,
  };

  it('inserts a new catalog row with timesOrdered=1', async () => {
    const repo = makeRepoMock([]);
    const service = new PartnerProductsService(repo as any);
    const row = await service.recordOrder(input);
    expect(row.timesOrdered).toBe(1);
    expect(row.lastKnownCostPrice).toBe(5200);
    expect(row.lastKnownSellPrice).toBe(6240);
    expect(repo.save).toHaveBeenCalled();
  });

  it('increments timesOrdered and refreshes prices on repeat order', async () => {
    const existing = {
      supplierCode: 'rossko',
      article: 'A1',
      brand: 'BOSCH',
      name: 'Filter',
      lastKnownCostPrice: 5000,
      lastKnownSellPrice: 6000,
      timesOrdered: 1,
      lastSeenAt: new Date('2020-01-01'),
    };
    const repo = makeRepoMock([existing]);
    const service = new PartnerProductsService(repo as any);
    const row = await service.recordOrder(input);
    expect(row.timesOrdered).toBe(2);
    expect(row.lastKnownSellPrice).toBe(6240);
  });

  it('findMany paginates and returns total', async () => {
    const repo = makeRepoMock([{ supplierCode: 'rossko' }]);
    const service = new PartnerProductsService(repo as any);
    const res = await service.findMany({ page: 1, limit: 20 } as any);
    expect(res.total).toBe(1);
    expect(res.page).toBe(1);
    expect(repo.findAndCount).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- partner-products.service`
Expected: FAIL — cannot find module `./partner-products.service`.

- [ ] **Step 3: Create `src/partner-products/dto/query-partner-products.dto.ts`**

```ts
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryPartnerProductsDto {
  @ApiPropertyOptional({ description: 'Filter by supplier code', example: 'rossko' })
  @IsOptional()
  @IsString()
  supplierCode?: string;

  @ApiPropertyOptional({ description: 'Filter by article (exact match)' })
  @IsOptional()
  @IsString()
  article?: string;

  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit: number = 20;
}
```

- [ ] **Step 4: Create `src/partner-products/partner-products.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { PartnerProduct } from './entities/partner-product.entity';
import { QueryPartnerProductsDto } from './dto/query-partner-products.dto';

export interface RecordOrderInput {
  supplierCode: string;
  article: string;
  brand: string;
  name: string;
  costPrice: number;
  sellPrice: number;
}

@Injectable()
export class PartnerProductsService {
  constructor(
    @InjectRepository(PartnerProduct)
    private readonly repo: Repository<PartnerProduct>,
  ) {}

  /** Upsert analytics catalog on checkout (Spec C §6). Not a source of price/search. */
  async recordOrder(input: RecordOrderInput): Promise<PartnerProduct> {
    const now = new Date();
    const existing = await this.repo.findOne({
      where: {
        supplierCode: input.supplierCode,
        article: input.article,
        brand: input.brand,
      },
    });

    if (existing) {
      existing.name = input.name;
      existing.lastSeenAt = now;
      existing.lastKnownCostPrice = input.costPrice;
      existing.lastKnownSellPrice = input.sellPrice;
      existing.timesOrdered = (existing.timesOrdered ?? 0) + 1;
      return this.repo.save(existing);
    }

    const row = this.repo.create({
      supplierCode: input.supplierCode,
      article: input.article,
      brand: input.brand,
      name: input.name,
      lastSeenAt: now,
      lastKnownCostPrice: input.costPrice,
      lastKnownSellPrice: input.sellPrice,
      timesOrdered: 1,
    });
    return this.repo.save(row);
  }

  async findMany(query: QueryPartnerProductsDto): Promise<{
    items: PartnerProduct[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: FindOptionsWhere<PartnerProduct> = {};
    if (query.supplierCode) where.supplierCode = query.supplierCode;
    if (query.article) where.article = query.article;

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { lastSeenAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total, page, limit };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- partner-products.service`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/partner-products/partner-products.service.ts src/partner-products/dto/query-partner-products.dto.ts src/partner-products/partner-products.service.spec.ts
git commit -m "feat(analytics): add PartnerProductsService upsert + paginated query"
```

---

### Task 6: `PartnerProductsController` + `PartnerProductsModule`

**Files:**
- Create: `src/partner-products/partner-products.controller.ts`
- Create: `src/partner-products/partner-products.module.ts`
- Test: `src/partner-products/partner-products.controller.spec.ts`

**Interfaces:**
- Consumes: `PartnerProductsService` (Task 5), `RolesGuard`/`@Roles`/`UserRole`.
- Produces:
  - `GET /api/partner-products` (MANAGER/ADMIN, filters `supplierCode`/`article`, pagination) → delegates to `findMany`.
  - `PartnerProductsModule` registering `TypeOrmModule.forFeature([PartnerProduct])`, providing+exporting `PartnerProductsService`, registering the controller.

- [ ] **Step 1: Write the failing test**

Create `src/partner-products/partner-products.controller.spec.ts`:

```ts
import { PartnerProductsController } from './partner-products.controller';

describe('PartnerProductsController', () => {
  const service = {
    findMany: jest.fn(async () => ({ items: [], total: 0, page: 1, limit: 20 })),
  };
  const controller = new PartnerProductsController(service as any);

  it('GET delegates to service.findMany with the query', async () => {
    const query = { supplierCode: 'rossko', page: 1, limit: 20 } as any;
    await expect(controller.findMany(query)).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    expect(service.findMany).toHaveBeenCalledWith(query);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- partner-products.controller`
Expected: FAIL — cannot find module `./partner-products.controller`.

- [ ] **Step 3: Create `src/partner-products/partner-products.controller.ts`**

```ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { PartnerProductsService } from './partner-products.service';
import { QueryPartnerProductsDto } from './dto/query-partner-products.dto';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('partner-products')
@UseGuards(RolesGuard)
export class PartnerProductsController {
  constructor(private readonly service: PartnerProductsService) {}

  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @Get()
  @ApiOperation({
    summary:
      'List the partner products analytics catalog (MANAGER/ADMIN). Not a price/search source.',
  })
  @ApiResponse({ status: 200, description: 'Paginated catalog rows.' })
  findMany(@Query() query: QueryPartnerProductsDto) {
    return this.service.findMany(query);
  }
}
```

- [ ] **Step 4: Create `src/partner-products/partner-products.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PartnerProduct } from './entities/partner-product.entity';
import { PartnerProductsService } from './partner-products.service';
import { PartnerProductsController } from './partner-products.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PartnerProduct])],
  providers: [PartnerProductsService],
  controllers: [PartnerProductsController],
  exports: [PartnerProductsService],
})
export class PartnerProductsModule {}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- partner-products.controller`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add src/partner-products/partner-products.controller.ts src/partner-products/partner-products.module.ts src/partner-products/partner-products.controller.spec.ts
git commit -m "feat(analytics): add GET /api/partner-products (MANAGER/ADMIN)"
```

---

### Task 7: `aggregateOrderStatus` helper + checkout flow in `OrdersService`

**Files:**
- Modify: `src/orders/orders.service.ts`
- Modify: `src/orders/dto/create-order.dto.ts`
- Test: `src/orders/orders.service.spec.ts` (create)

**Interfaces:**
- Consumes: `CART_CHECKOUT`/`CartCheckoutContract`/`CheckoutItem` (Task 4), `SuppliersRegistry` (foundation), `SupplierOrder` entity (Task 2), `OrderStatus`/`Order`/`OrderItem`, `PartnerProductsService` (Task 5), `PlaceOrderItem`/`SupplierOrderStatusValue` (foundation).
- Produces:
  - exported `aggregateOrderStatus(statuses: SupplierOrderStatusValue[]): OrderStatus` — all `PLACED` ⇒ `OrderStatus.PLACED`; any `FAILED` ⇒ `OrderStatus.PARTIALLY_PLACED`; else `OrderStatus.PLACED`.
  - rewritten `OrdersService.create(userId, dto)` per Spec C §4 (409 on changes, snapshots, per-partner placement, aggregation, analytics upsert, cart clear).
  - `CreateOrderDto { addressId?: string }` (items now come from the cart).

- [ ] **Step 1: Write the failing test (helper + create flow)**

Create `src/orders/orders.service.spec.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { OrdersService, aggregateOrderStatus } from './orders.service';
import { OrderStatus } from './entities/order.entity';
import { MockConnector } from '../suppliers/connectors/mock/mock.connector';

function makeCheckoutItem(over: Partial<any> = {}) {
  return {
    supplierCode: 'mock',
    article: 'A1',
    brand: 'BOSCH',
    productName: 'Filter',
    costPrice: 5000,
    sellPrice: 6000,
    currentPrice: 6000,
    priceAtAdd: 6000,
    warehouseId: 'w1',
    raw: { stockId: 'w1' },
    quantity: 1,
    available: true,
    priceChanged: false,
    ...over,
  };
}

function makeDeps(items: any[], connectorByCode: Record<string, MockConnector>) {
  const saved: any[] = [];
  const orderRepo = {
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (o: any) => {
      o.id = o.id ?? 'order-1';
      if (!saved.includes(o)) saved.push(o);
      return o;
    }),
    findOne: jest.fn(async () => saved[0] ?? null),
  };
  let subSeq = 0;
  const supplierOrderRepo = {
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (s: any) => {
      s.id = s.id ?? `sub-${++subSeq}`;
      return s;
    }),
    findOne: jest.fn(),
  };
  const cart = {
    getCheckoutItems: jest.fn(async () => items),
    clearCart: jest.fn(async () => undefined),
  };
  const registry = {
    getByCode: jest.fn(async (code: string) => connectorByCode[code]),
  };
  const partnerProducts = { recordOrder: jest.fn(async () => undefined) };
  const service = new OrdersService(
    orderRepo as any,
    supplierOrderRepo as any,
    cart as any,
    registry as any,
    partnerProducts as any,
  );
  return { service, orderRepo, supplierOrderRepo, cart, registry, partnerProducts };
}

describe('aggregateOrderStatus', () => {
  it('all PLACED => PLACED', () => {
    expect(aggregateOrderStatus(['PLACED', 'PLACED'])).toBe(OrderStatus.PLACED);
  });
  it('any FAILED => PARTIALLY_PLACED', () => {
    expect(aggregateOrderStatus(['PLACED', 'FAILED'])).toBe(
      OrderStatus.PARTIALLY_PLACED,
    );
  });
});

describe('OrdersService.create', () => {
  it('throws 409 when an item is unavailable or price changed', async () => {
    const { service } = makeDeps(
      [makeCheckoutItem({ available: false })],
      { mock: new MockConnector() },
    );
    await expect(service.create('u1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('places all sub-orders and sets Order.PLACED, upserts analytics, clears cart', async () => {
    const mock = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const { service, cart, partnerProducts } = makeDeps(
      [makeCheckoutItem()],
      { mock },
    );
    const order = await service.create('u1', {});
    expect(order.status).toBe(OrderStatus.PLACED);
    expect(order.supplierOrders).toHaveLength(1);
    expect(order.supplierOrders[0].externalOrderId).toBe('EXT-1');
    expect(partnerProducts.recordOrder).toHaveBeenCalledTimes(1);
    expect(cart.clearCart).toHaveBeenCalledWith('u1');
  });

  it('marks Order.PARTIALLY_PLACED when one partner has no order API', async () => {
    const ok = new MockConnector('mock', 'Mock').setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const failing = new MockConnector('rossko', 'Rossko').failWith(
      new Error('No order API'),
    );
    const { service } = makeDeps(
      [
        makeCheckoutItem({ supplierCode: 'mock' }),
        makeCheckoutItem({ supplierCode: 'rossko', warehouseId: 'w2' }),
      ],
      { mock: ok, rossko: failing },
    );
    const order = await service.create('u1', {});
    expect(order.status).toBe(OrderStatus.PARTIALLY_PLACED);
    const failed = order.supplierOrders.find((s: any) => s.supplierCode === 'rossko');
    expect(failed.status).toBe('FAILED');
    expect(failed.errorMessage).toBeTruthy();
  });

  it('snapshots order items independent of live offers', async () => {
    const mock = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const { service } = makeDeps([makeCheckoutItem()], { mock });
    const order = await service.create('u1', {});
    const item = order.items[0];
    expect(item.supplierCode).toBe('mock');
    expect(item.article).toBe('A1');
    expect(item.sellPrice).toBe(6000);
    expect(item.subtotal).toBe(6000);
    expect(item.productId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- orders.service`
Expected: FAIL — `aggregateOrderStatus` not exported / `OrdersService` constructor signature mismatch.

- [ ] **Step 3: Replace `CreateOrderDto` in `src/orders/dto/create-order.dto.ts`**

```ts
import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Items are taken from the cart's live re-check (CartService.getCheckoutItems),
 * not from the request body (Spec C §4).
 */
export class CreateOrderDto {
  @ApiPropertyOptional({ description: 'Delivery address id', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  addressId?: string;
}
```

- [ ] **Step 4: Rewrite `src/orders/orders.service.ts`**

Replace the file contents with:

```ts
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { SupplierOrder } from './entities/supplier-order.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  CART_CHECKOUT,
  CartCheckoutContract,
  CheckoutItem,
} from './cart-checkout.contract';
import { SuppliersRegistry } from '../suppliers/suppliers.registry';
import { PartnerProductsService } from '../partner-products/partner-products.service';
import {
  PlaceOrderItem,
  ReturnItem,
  SupplierOrderStatusValue,
} from '../suppliers/types';

/** Aggregate the order status from its sub-order statuses (Spec C §4.6). */
export function aggregateOrderStatus(
  statuses: SupplierOrderStatusValue[],
): OrderStatus {
  if (statuses.length > 0 && statuses.every((s) => s === 'PLACED')) {
    return OrderStatus.PLACED;
  }
  if (statuses.some((s) => s === 'FAILED')) {
    return OrderStatus.PARTIALLY_PLACED;
  }
  return OrderStatus.PLACED;
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(SupplierOrder)
    private readonly supplierOrderRepo: Repository<SupplierOrder>,
    @Inject(CART_CHECKOUT)
    private readonly cart: CartCheckoutContract,
    private readonly suppliersRegistry: SuppliersRegistry,
    private readonly partnerProducts: PartnerProductsService,
  ) {}

  // ---- Reads ----

  findAllByUser(userId: string): Promise<Order[]> {
    return this.orderRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  findAll(): Promise<Order[]> {
    return this.orderRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string, userId: string): Promise<Order> {
    const order = await this.orderRepo.findOne({ where: { id, userId } });
    if (!order) throw new NotFoundException('Order not found.');
    return order;
  }

  private async loadOrder(id: string): Promise<Order> {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Order not found.');
    return order;
  }

  // ---- Checkout (Spec C §4) ----

  async create(userId: string, dto: CreateOrderDto): Promise<Order> {
    const items = await this.cart.getCheckoutItems(userId);
    if (!items.length) {
      throw new ConflictException({
        message: 'Cart is empty.',
        changes: [],
      });
    }

    // §4.2 — block when the live re-check found unavailable items or price changes.
    const changes = items
      .filter((i) => !i.available || i.priceChanged)
      .map((i) => ({
        supplierCode: i.supplierCode,
        article: i.article,
        brand: i.brand,
        available: i.available,
        priceChanged: i.priceChanged,
        priceAtAdd: i.priceAtAdd,
        currentPrice: i.currentPrice,
      }));
    if (changes.length) {
      throw new ConflictException({
        message:
          'Cart changed since last review. Confirm new prices or remove unavailable items.',
        changes,
      });
    }

    // §4.3 — create Order + immutable order_item snapshots (prices from currentPrice).
    const order = this.orderRepo.create({
      userId,
      addressId: dto.addressId ?? null,
      status: OrderStatus.NEW,
      totalAmount: items.reduce((sum, i) => sum + i.currentPrice * i.quantity, 0),
      items: items.map((i) => this.buildOrderItem(i)),
    });
    const saved = await this.orderRepo.save(order);

    // §4.4-4.6 — group by supplier, place each group, aggregate status.
    const groups = new Map<string, CheckoutItem[]>();
    for (const item of items) {
      const list = groups.get(item.supplierCode) ?? [];
      list.push(item);
      groups.set(item.supplierCode, list);
    }
    const subOrders: SupplierOrder[] = [];
    for (const [supplierCode, groupItems] of groups) {
      subOrders.push(
        await this.placeSupplierOrder(saved.id, supplierCode, groupItems),
      );
    }
    saved.supplierOrders = subOrders;
    saved.status = aggregateOrderStatus(subOrders.map((s) => s.status));
    await this.orderRepo.save(saved);

    // §4.7 — analytics upsert + clear cart.
    for (const item of items) {
      await this.partnerProducts.recordOrder({
        supplierCode: item.supplierCode,
        article: item.article,
        brand: item.brand,
        name: item.productName,
        costPrice: item.costPrice,
        sellPrice: item.currentPrice,
      });
    }
    await this.cart.clearCart(userId);

    return saved;
  }

  private buildOrderItem(item: CheckoutItem): OrderItem {
    const orderItem = new OrderItem();
    orderItem.productId = null;
    orderItem.productName = item.productName;
    // Legacy NOT NULL columns — fill from the snapshot for aggregator items.
    orderItem.productSku = item.article;
    orderItem.priceAtOrder = item.currentPrice;
    // Aggregator snapshot.
    orderItem.supplierCode = item.supplierCode;
    orderItem.article = item.article;
    orderItem.brand = item.brand;
    orderItem.costPrice = item.costPrice;
    orderItem.sellPrice = item.currentPrice;
    orderItem.warehouseId = item.warehouseId;
    orderItem.raw = item.raw;
    orderItem.quantity = item.quantity;
    orderItem.subtotal = item.currentPrice * item.quantity;
    return orderItem;
  }

  private async placeSupplierOrder(
    orderId: string,
    supplierCode: string,
    items: CheckoutItem[],
  ): Promise<SupplierOrder> {
    const sub = this.supplierOrderRepo.create({
      orderId,
      supplierCode,
      status: 'NEW' as SupplierOrderStatusValue,
      externalOrderId: null,
      errorMessage: null,
      returnStatus: null,
      externalReturnId: null,
    });
    try {
      const connector = await this.suppliersRegistry.getByCode(supplierCode);
      const result = await connector.placeOrder(this.toPlaceOrderItems(items));
      sub.externalOrderId = result.externalOrderId;
      sub.status = result.status;
      sub.errorMessage = result.errorMessage ?? null;
    } catch (err) {
      sub.status = 'FAILED';
      sub.errorMessage =
        err instanceof NotImplementedException
          ? 'No order API for this partner — manual processing required.'
          : err?.message ?? 'placeOrder failed.';
    }
    return this.supplierOrderRepo.save(sub);
  }

  private toPlaceOrderItems(items: CheckoutItem[]): PlaceOrderItem[] {
    return items.map((i) => ({
      article: i.article,
      brand: i.brand,
      warehouseId: i.warehouseId,
      quantity: i.quantity,
      raw: i.raw,
    }));
  }
}
```

> Note: `ReturnItem` is imported here for Task 8's methods, which are appended to this same service. If executing strictly task-by-task and the unused import trips a lint/build, leave it — Task 8 uses it. (NestJS `tsconfig` does not error on unused imports by default.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- orders.service`
Expected: PASS (helper 2 tests + create 4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/orders/orders.service.ts src/orders/dto/create-order.dto.ts src/orders/orders.service.spec.ts
git commit -m "feat(orders): aggregator checkout flow with per-partner placement + 409 re-check"
```

---

### Task 8: Manager sub-order controls — refresh-status / retry / return

**Files:**
- Modify: `src/orders/orders.service.ts`
- Create: `src/orders/dto/request-return.dto.ts`
- Modify: `src/orders/orders.service.spec.ts` (add cases)

**Interfaces:**
- Consumes: everything from Task 7; `ReturnItem`/`ReturnResult` (foundation).
- Produces, added to `OrdersService`:
  - `refreshSupplierStatus(orderId, supplierOrderId): Promise<Order>` — calls `connector.getOrderStatus`, updates sub status, re-aggregates.
  - `retrySupplierOrder(orderId, supplierOrderId): Promise<Order>` — only when sub is `FAILED`; rebuilds `PlaceOrderItem[]` from the order_item snapshot, re-places, re-aggregates.
  - `requestSupplierReturn(orderId, supplierOrderId, dto): Promise<Order>` — `connector.requestReturn` where available, else `NotImplementedException` ⇒ `returnStatus='REQUESTED'` (manual).
  - `RequestReturnDto { items: { article: string; quantity: number }[] }`

- [ ] **Step 1: Write the failing test (append to `orders.service.spec.ts`)**

Add this `describe` block to `src/orders/orders.service.spec.ts`:

```ts
describe('OrdersService manager controls', () => {
  function makeServiceWithSub(sub: any, connector: MockConnector, items: any[] = []) {
    const order = {
      id: 'order-1',
      supplierOrders: [sub],
      items,
      status: OrderStatus.PARTIALLY_PLACED,
    };
    const orderRepo = {
      findOne: jest.fn(async () => order),
      save: jest.fn(async (o: any) => o),
    };
    const supplierOrderRepo = {
      findOne: jest.fn(async () => sub),
      save: jest.fn(async (s: any) => s),
    };
    const service = new OrdersService(
      orderRepo as any,
      supplierOrderRepo as any,
      { getCheckoutItems: jest.fn(), clearCart: jest.fn() } as any,
      { getByCode: jest.fn(async () => connector) } as any,
      { recordOrder: jest.fn() } as any,
    );
    return { service, order, orderRepo, supplierOrderRepo };
  }

  it('refresh-status updates the sub-order status from the connector', async () => {
    const sub = { id: 'sub-1', orderId: 'order-1', supplierCode: 'mock', externalOrderId: 'EXT-1', status: 'PLACED' };
    const connector = new MockConnector().setStatus('SHIPPED');
    const { service, supplierOrderRepo } = makeServiceWithSub(sub, connector);
    await service.refreshSupplierStatus('order-1', 'sub-1');
    expect(sub.status).toBe('SHIPPED');
    expect(supplierOrderRepo.save).toHaveBeenCalled();
  });

  it('retry re-places a FAILED sub-order and flips it to PLACED', async () => {
    const sub = { id: 'sub-1', orderId: 'order-1', supplierCode: 'mock', externalOrderId: null, status: 'FAILED', errorMessage: 'x' };
    const items = [{ supplierCode: 'mock', article: 'A1', brand: 'BOSCH', warehouseId: 'w1', quantity: 1, raw: {} }];
    const connector = new MockConnector().setOrderResult({ externalOrderId: 'EXT-2', status: 'PLACED' });
    const { service } = makeServiceWithSub(sub, connector, items);
    await service.retrySupplierOrder('order-1', 'sub-1');
    expect(sub.status).toBe('PLACED');
    expect(sub.externalOrderId).toBe('EXT-2');
  });

  it('return via connector API sets returnStatus from the result', async () => {
    const sub = { id: 'sub-1', orderId: 'order-1', supplierCode: 'mock', externalOrderId: 'EXT-1', status: 'PLACED', returnStatus: null };
    const connector = new MockConnector().setReturnResult({ returnStatus: 'IN_PROGRESS', externalReturnId: 'RET-1' });
    const { service } = makeServiceWithSub(sub, connector);
    await service.requestSupplierReturn('order-1', 'sub-1', { items: [{ article: 'A1', quantity: 1 }] });
    expect(sub.returnStatus).toBe('IN_PROGRESS');
    expect(sub.externalReturnId).toBe('RET-1');
  });

  it('return without API falls back to manual REQUESTED', async () => {
    const sub = { id: 'sub-1', orderId: 'order-1', supplierCode: 'rossko', externalOrderId: 'EXT-1', status: 'PLACED', returnStatus: null };
    const connector = new MockConnector('rossko', 'Rossko');
    jest.spyOn(connector, 'requestReturn').mockRejectedValue(
      new (require('@nestjs/common').NotImplementedException)('no api'),
    );
    const { service } = makeServiceWithSub(sub, connector);
    await service.requestSupplierReturn('order-1', 'sub-1', { items: [{ article: 'A1', quantity: 1 }] });
    expect(sub.returnStatus).toBe('REQUESTED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- orders.service`
Expected: FAIL — `refreshSupplierStatus`/`retrySupplierOrder`/`requestSupplierReturn` not a function.

- [ ] **Step 3: Create `src/orders/dto/request-return.dto.ts`**

```ts
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReturnLineDto {
  @ApiProperty({ description: 'Article of the returned position' })
  @IsString()
  article: string;

  @ApiProperty({ description: 'Quantity to return', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class RequestReturnDto {
  @ApiProperty({ type: [ReturnLineDto], description: 'Positions/quantities to return' })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  items: ReturnLineDto[];
}
```

- [ ] **Step 4: Append manager-control methods to `OrdersService` (`src/orders/orders.service.ts`)**

Add the `RequestReturnDto` import near the other DTO import:

```ts
import { RequestReturnDto } from './dto/request-return.dto';
```

Add these methods inside the `OrdersService` class (after `toPlaceOrderItems`):

```ts
  // ---- Manager sub-order controls (Spec C §5) ----

  private async getSubOrder(
    orderId: string,
    supplierOrderId: string,
  ): Promise<SupplierOrder> {
    const sub = await this.supplierOrderRepo.findOne({
      where: { id: supplierOrderId, orderId },
    });
    if (!sub) throw new NotFoundException('Supplier sub-order not found.');
    return sub;
  }

  private async reaggregate(orderId: string): Promise<void> {
    const order = await this.loadOrder(orderId);
    order.status = aggregateOrderStatus(
      (order.supplierOrders ?? []).map((s) => s.status),
    );
    await this.orderRepo.save(order);
  }

  async refreshSupplierStatus(
    orderId: string,
    supplierOrderId: string,
  ): Promise<Order> {
    const sub = await this.getSubOrder(orderId, supplierOrderId);
    if (!sub.externalOrderId) {
      throw new ConflictException('No external order id to refresh.');
    }
    const connector = await this.suppliersRegistry.getByCode(sub.supplierCode);
    sub.status = await connector.getOrderStatus(sub.externalOrderId);
    await this.supplierOrderRepo.save(sub);
    await this.reaggregate(orderId);
    return this.loadOrder(orderId);
  }

  async retrySupplierOrder(
    orderId: string,
    supplierOrderId: string,
  ): Promise<Order> {
    const sub = await this.getSubOrder(orderId, supplierOrderId);
    if (sub.status !== 'FAILED') {
      throw new ConflictException('Only FAILED sub-orders can be retried.');
    }
    const order = await this.loadOrder(orderId);
    const groupItems = (order.items ?? []).filter(
      (it) => it.supplierCode === sub.supplierCode,
    );
    const placeItems: PlaceOrderItem[] = groupItems.map((it) => ({
      article: it.article ?? '',
      brand: it.brand ?? '',
      warehouseId: it.warehouseId ?? '',
      quantity: it.quantity,
      raw: it.raw ?? {},
    }));
    try {
      const connector = await this.suppliersRegistry.getByCode(sub.supplierCode);
      const result = await connector.placeOrder(placeItems);
      sub.externalOrderId = result.externalOrderId;
      sub.status = result.status;
      sub.errorMessage = result.errorMessage ?? null;
    } catch (err) {
      sub.status = 'FAILED';
      sub.errorMessage =
        err instanceof NotImplementedException
          ? 'No order API for this partner — manual processing required.'
          : err?.message ?? 'placeOrder failed.';
    }
    await this.supplierOrderRepo.save(sub);
    await this.reaggregate(orderId);
    return this.loadOrder(orderId);
  }

  async requestSupplierReturn(
    orderId: string,
    supplierOrderId: string,
    dto: RequestReturnDto,
  ): Promise<Order> {
    const sub = await this.getSubOrder(orderId, supplierOrderId);
    const returnItems: ReturnItem[] = dto.items.map((line) => ({
      externalOrderId: sub.externalOrderId ?? '',
      article: line.article,
      quantity: line.quantity,
    }));
    try {
      const connector = await this.suppliersRegistry.getByCode(sub.supplierCode);
      const result = await connector.requestReturn(
        sub.externalOrderId ?? '',
        returnItems,
      );
      sub.returnStatus = result.returnStatus;
      sub.externalReturnId = result.externalReturnId ?? null;
    } catch (err) {
      if (err instanceof NotImplementedException) {
        // Semi-automatic: no return API — record a manual return request.
        sub.returnStatus = 'REQUESTED';
      } else {
        throw err;
      }
    }
    await this.supplierOrderRepo.save(sub);
    return this.loadOrder(orderId);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- orders.service`
Expected: PASS (all create + manager-control cases).

- [ ] **Step 6: Commit**

```bash
git add src/orders/orders.service.ts src/orders/dto/request-return.dto.ts src/orders/orders.service.spec.ts
git commit -m "feat(orders): manager refresh-status/retry/return sub-order controls"
```

---

### Task 9: `OrdersController` endpoints + Swagger + `OrdersModule` wiring

**Files:**
- Modify: `src/orders/orders.controller.ts`
- Modify: `src/orders/orders.module.ts`
- Test: `src/orders/orders.controller.spec.ts` (create)

**Interfaces:**
- Consumes: `OrdersService` (Tasks 7-8), `CART_CHECKOUT`/`CartCheckoutStub` (Task 4), `SuppliersModule`, `PartnerProductsModule`, `SupplierOrder`/`OrderItem`/`Order` entities, `RequestReturnDto`.
- Produces:
  - `POST /api/orders/:id/suppliers/:sid/refresh-status` (MANAGER/ADMIN)
  - `POST /api/orders/:id/suppliers/:sid/retry` (MANAGER/ADMIN)
  - `POST /api/orders/:id/suppliers/:sid/return` (MANAGER/ADMIN, body `RequestReturnDto`)
  - `@ApiTags('orders')` + Swagger annotations on `create` (incl. `409`) and the new endpoints.
  - `OrdersModule` registering `TypeOrmModule.forFeature([Order, OrderItem, SupplierOrder])`, importing `SuppliersModule` + `PartnerProductsModule`, providing `OrdersService` + `{ provide: CART_CHECKOUT, useClass: CartCheckoutStub }`.

- [ ] **Step 1: Write the failing test**

Create `src/orders/orders.controller.spec.ts`:

```ts
import { OrdersController } from './orders.controller';

describe('OrdersController sub-order endpoints', () => {
  const service = {
    refreshSupplierStatus: jest.fn(async () => ({ id: 'o1' })),
    retrySupplierOrder: jest.fn(async () => ({ id: 'o1' })),
    requestSupplierReturn: jest.fn(async () => ({ id: 'o1' })),
  };
  const controller = new OrdersController(service as any);

  it('refresh-status delegates with order + sub ids', async () => {
    await controller.refreshSupplierStatus('o1', 's1');
    expect(service.refreshSupplierStatus).toHaveBeenCalledWith('o1', 's1');
  });

  it('retry delegates with order + sub ids', async () => {
    await controller.retrySupplierOrder('o1', 's1');
    expect(service.retrySupplierOrder).toHaveBeenCalledWith('o1', 's1');
  });

  it('return delegates with order id, sub id, and dto', async () => {
    const dto = { items: [{ article: 'A1', quantity: 1 }] };
    await controller.requestSupplierReturn('o1', 's1', dto as any);
    expect(service.requestSupplierReturn).toHaveBeenCalledWith('o1', 's1', dto);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- orders.controller`
Expected: FAIL — methods not defined on `OrdersController`.

- [ ] **Step 3: Add endpoints + Swagger to `src/orders/orders.controller.ts`**

Add/extend imports at the top:

```ts
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { RequestReturnDto } from './dto/request-return.dto';
```

Add class-level Swagger decorators above `@Controller('orders')`:

```ts
@ApiTags('orders')
@ApiBearerAuth()
```

Annotate the existing `create` handler:

```ts
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Place an aggregator order: final live re-check of the cart, then place with partners.',
  })
  @ApiResponse({ status: 201, description: 'Order created and placed with partners.' })
  @ApiResponse({
    status: 409,
    description:
      'Cart changed since last review (unavailable items / price changes) — order not created.',
  })
  create(@CurrentUser() user: User, @Body() dto: CreateOrderDto): Promise<Order> {
    return this.ordersService.create(user.id, dto);
  }
```

Add the three manager endpoints inside the class (after `create`):

```ts
  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @Post(':id/suppliers/:sid/refresh-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh a sub-order status from the partner (MANAGER/ADMIN).' })
  @ApiParam({ name: 'id', description: 'Order id' })
  @ApiParam({ name: 'sid', description: 'Supplier sub-order id' })
  refreshSupplierStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sid', ParseUUIDPipe) sid: string,
  ): Promise<Order> {
    return this.ordersService.refreshSupplierStatus(id, sid);
  }

  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @Post(':id/suppliers/:sid/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry placing a FAILED sub-order (MANAGER/ADMIN).' })
  @ApiParam({ name: 'id', description: 'Order id' })
  @ApiParam({ name: 'sid', description: 'Supplier sub-order id' })
  retrySupplierOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sid', ParseUUIDPipe) sid: string,
  ): Promise<Order> {
    return this.ordersService.retrySupplierOrder(id, sid);
  }

  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @Post(':id/suppliers/:sid/return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Request a return for a sub-order (semi-automatic: API where available, else manual) (MANAGER/ADMIN).',
  })
  @ApiParam({ name: 'id', description: 'Order id' })
  @ApiParam({ name: 'sid', description: 'Supplier sub-order id' })
  requestSupplierReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @Body() dto: RequestReturnDto,
  ): Promise<Order> {
    return this.ordersService.requestSupplierReturn(id, sid, dto);
  }
```

> Ensure `ParseUUIDPipe`, `Post`, `Param`, `Body`, `HttpCode`, `HttpStatus` are already imported (they are, for existing handlers). `Order`, `CurrentUser`, `User`, `CreateOrderDto`, `Roles`, `UserRole` are already imported.

- [ ] **Step 4: Wire `src/orders/orders.module.ts`**

Replace the module with:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { SupplierOrder } from './entities/supplier-order.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { PartnerProductsModule } from '../partner-products/partner-products.module';
import { CART_CHECKOUT, CartCheckoutStub } from './cart-checkout.contract';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, SupplierOrder]),
    SuppliersModule,
    PartnerProductsModule,
  ],
  providers: [
    OrdersService,
    // MERGE: replace with { provide: CART_CHECKOUT, useExisting: CartService }
    // and import CartModule once Spec B is merged.
    { provide: CART_CHECKOUT, useClass: CartCheckoutStub },
  ],
  controllers: [OrdersController],
})
export class OrdersModule {}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- orders.controller`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/orders/orders.controller.ts src/orders/orders.module.ts src/orders/orders.controller.spec.ts
git commit -m "feat(orders): sub-order manager endpoints + orders Swagger + module wiring"
```

---

### Task 10: App wiring, full build/test, documentation

**Files:**
- Modify: `src/app.module.ts`
- Modify: `src/config/data-source.ts`
- Modify: `README.md` (or `docs/` — match where suppliers/markup docs live)

**Interfaces:**
- Consumes: all prior tasks.
- Produces: `SupplierOrder` + `PartnerProduct` registered in both entity arrays; `PartnerProductsModule` imported in `AppModule`; green build + tests; documented order lifecycle.

- [ ] **Step 1: Register entities in `src/config/data-source.ts`**

Add imports after the other entity imports:

```ts
import { SupplierOrder } from '../orders/entities/supplier-order.entity';
import { PartnerProduct } from '../partner-products/entities/partner-product.entity';
```

Add `SupplierOrder` and `PartnerProduct` to the `entities` array (after `Supplier`).

- [ ] **Step 2: Register entities + module in `src/app.module.ts`**

Add imports alongside the other entity/module imports:

```ts
import { SupplierOrder } from './orders/entities/supplier-order.entity';
import { PartnerProduct } from './partner-products/entities/partner-product.entity';
import { PartnerProductsModule } from './partner-products/partner-products.module';
```

Add `SupplierOrder, PartnerProduct` to the end of the `entities: [...]` array inside `TypeOrmModule.forRootAsync`'s `useFactory`:

```ts
        entities: [User, Product, ProductImage, ProductProperty, Cart, CartItem, Address, Category, Brand, Order, OrderItem, Supplier, SupplierOrder, PartnerProduct],
```

Add `PartnerProductsModule` to the `imports: [...]` array (after `OrdersModule`):

```ts
    OrdersModule,
    PartnerProductsModule,
```

- [ ] **Step 3: Verify the whole project builds and all tests pass**

Run: `npm run build && npm test`
Expected: build succeeds with no TypeScript errors; all spec files pass.

- [ ] **Step 4: Run migrations (if a database is reachable)**

Run: `npm run migration:run`
Expected: `1700000000008`, `1700000000009`, `1700000000010` apply cleanly. (If no DB is reachable in this environment, skip and note it; the migration files are committed and run in CI/deploy.)

- [ ] **Step 5: Document the order lifecycle**

In `README.md` (or the doc file where suppliers/markup are documented), add an "Orders & returns (aggregator)" section covering:
- Order lifecycle: `NEW → PLACED / PARTIALLY_PLACED` (aggregated from sub-orders), plus `DELIVERED`/`CANCELLED`.
- `supplier_order` per partner; partial success → `PARTIALLY_PLACED`; `placeOrder` errors / `NotImplementedException` → `FAILED` (manual processing).
- Final live re-check at checkout: `409 Conflict` (with a `changes[]` list) when items became unavailable or prices changed; the order is not created.
- Manager controls: `refresh-status` (pull partner status), `retry` (re-place a FAILED sub-order from the immutable snapshot), `return` (semi-automatic: partner API where available, else manual `returnStatus=REQUESTED`).
- Immutability: `order_items`/`supplier_order` are snapshots — never changed by a later re-check; deactivating a partner does not cascade to existing orders (partner name comes from the snapshot).
- `partner_products`: analytics catalog upserted on each checkout (`firstSeen`/`lastSeen`, `lastKnown*Price`, `timesOrdered`). **Not a source of price or search.** Read via `GET /api/partner-products` (MANAGER/ADMIN).
- Cart seam: `POST /api/orders` consumes `CartService.getCheckoutItems()` (currently a local `CART_CHECKOUT` stub; swapped at Spec B merge).

- [ ] **Step 6: Commit**

```bash
git add src/app.module.ts src/config/data-source.ts README.md
git commit -m "docs(orders): wire entities/module, document aggregator order lifecycle"
```

---

## Self-Review

**Spec coverage:**
- §1 order_item snapshot + productId nullable → Task 1. ✓
- §2 supplier_order entity + migration → Task 2. ✓
- §3 `PARTIALLY_PLACED` (+`PLACED`) + aggregation → Task 2 (enum) + Task 7 (`aggregateOrderStatus`). ✓
- §4 checkout flow (re-check, 409, snapshots, grouping, place, aggregate, analytics, clear cart) → Task 7. ✓
- §5 manager controls (refresh-status, retry, return, list with `supplier_order[]`) → Task 8 (service) + Task 9 (endpoints); list endpoints return `supplierOrders` via the eager relation added in Task 2. ✓
- §6 partner_products entity/migration/upsert/endpoint → Tasks 3, 5, 6. ✓
- §7 immutability → snapshots written once; re-check only on cart (Task 7 builds snapshots, never mutated by reads). ✓
- Swagger → Tasks 6, 9. README → Task 10. ✓
- Tests (success/partial/retry/409/snapshot/upsert/return-with-and-without-API) → Tasks 5, 7, 8. ✓

**Placeholder scan:** no TBD/TODO; all steps carry real code. ✓

**Type consistency:** `aggregateOrderStatus`, `placeSupplierOrder`, `toPlaceOrderItems`, `getSubOrder`, `reaggregate`, `refreshSupplierStatus`, `retrySupplierOrder`, `requestSupplierReturn`, `recordOrder`, `findMany`, `CART_CHECKOUT`, `CartCheckoutContract`, `CheckoutItem`, `RequestReturnDto` are named identically across tasks. `OrdersService` constructor arity (5 deps: orderRepo, supplierOrderRepo, cart, registry, partnerProducts) matches the Task 7 & 8 tests. `SupplierOrder.status` uses `SupplierOrderStatusValue`; `Order.status` uses `OrderStatus`. ✓
