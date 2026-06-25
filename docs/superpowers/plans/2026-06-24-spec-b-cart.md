# Spec B — Cart Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the cart so adding an item stores a supplier-offer snapshot, and `GET /cart` does a live re-check of price/availability against the partner, exposing a `CartService.getCheckoutItems()` contract for Orders (Spec C).

**Architecture:** `cart_item` gains additive snapshot columns (`productId` becomes nullable). `CartService` consumes the Spec 0 foundation — `SuppliersRegistry.getByCode()` for the live re-check, `PricingService.applyMarkup()` for the fresh sell price. Re-check runs per-item in parallel (`Promise.allSettled`) with a timeout; any failure (partner down, timeout, offer gone, insufficient stock) collapses to `available: false`. `costPrice` never leaves in the client response but is included in the Orders contract.

**Tech Stack:** NestJS 10, TypeORM + PostgreSQL, `@nestjs/swagger`, Jest + ts-jest.

## Global Constraints

- Do **not** touch `search/` or `orders/` modules.
- The cart re-check consumes Spec 0 only: `SuppliersRegistry.getByCode(code)`, `connector.search(article, brand)`, `PricingService.applyMarkup(costPrice, supplierCode)`.
- `costPrice` is **never** included in the client `GET /cart` response. It **is** included in `getCheckoutItems()`.
- "Couldn't verify" (partner unavailable / timeout) **and** "offer disappeared" are a single outcome: `available: false`, with `currentPrice = priceAtAdd`.
- Migration must be **additive**: `productId` becomes nullable, new columns are nullable, the existing FK on `productId` is left in place.
- `CartModule` must **export** `CartService`.
- Decimal columns come back from TypeORM as strings — always wrap reads in `Number(...)`.
- Match existing code style: constructor DI, `@Injectable()`, Russian doc comments are fine where the codebase already uses them. Swagger reference controller is `/api/suppliers`.

---

### Task 1: cart_item snapshot — migration + entity

**Files:**
- Create: `src/migrations/1700000000008-AddCartItemSnapshot.ts`
- Modify: `src/cart/entities/cart-item.entity.ts`

**Interfaces:**
- Consumes: existing `cart_items` table (`id, cartId, productId, quantity, createdAt, updatedAt`) from `1700000000003-CreateProductsAndCart`.
- Produces: `CartItem` entity with nullable `productId` and snapshot columns `supplierCode, article, brand, productName, priceAtAdd, costPrice, warehouseId, raw`, all read by `CartService` in Task 3.

- [ ] **Step 1: Write the migration**

Create `src/migrations/1700000000008-AddCartItemSnapshot.ts`:

```ts
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddCartItemSnapshot1700000000008 implements MigrationInterface {
  name = 'AddCartItemSnapshot1700000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Aggregator offers have no own product — productId becomes optional.
    // FK on productId is intentionally left in place (kept for future own products).
    await queryRunner.query(
      `ALTER TABLE "cart_items" ALTER COLUMN "productId" DROP NOT NULL`,
    );

    await queryRunner.addColumns('cart_items', [
      new TableColumn({ name: 'supplierCode', type: 'varchar', length: '100', isNullable: true }),
      new TableColumn({ name: 'article', type: 'varchar', length: '255', isNullable: true }),
      new TableColumn({ name: 'brand', type: 'varchar', length: '255', isNullable: true }),
      new TableColumn({ name: 'productName', type: 'varchar', length: '255', isNullable: true }),
      new TableColumn({ name: 'priceAtAdd', type: 'decimal', precision: 12, scale: 2, isNullable: true }),
      new TableColumn({ name: 'costPrice', type: 'decimal', precision: 12, scale: 2, isNullable: true }),
      new TableColumn({ name: 'warehouseId', type: 'varchar', length: '255', isNullable: true }),
      new TableColumn({ name: 'raw', type: 'jsonb', isNullable: true }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('cart_items', [
      'supplierCode',
      'article',
      'brand',
      'productName',
      'priceAtAdd',
      'costPrice',
      'warehouseId',
      'raw',
    ]);
    await queryRunner.query(
      `ALTER TABLE "cart_items" ALTER COLUMN "productId" SET NOT NULL`,
    );
  }
}
```

- [ ] **Step 2: Update the CartItem entity**

Replace the body of `src/cart/entities/cart-item.entity.ts` with:

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
import { Cart } from './cart.entity';
import { Product } from '../../products/entities/product.entity';

@Entity('cart_items')
export class CartItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Cart, (cart) => cart.items, { onDelete: 'CASCADE' })
  @JoinColumn()
  cart: Cart;

  @Column()
  cartId: string;

  // Own product — kept for future self-catalog offers; null for aggregator offers.
  @ManyToOne(() => Product, { eager: true, onDelete: 'CASCADE', nullable: true })
  @JoinColumn()
  product: Product | null;

  @Column({ type: 'uuid', nullable: true })
  productId: string | null;

  // --- aggregator offer snapshot ---
  @Column({ type: 'varchar', nullable: true })
  supplierCode: string;

  @Column({ type: 'varchar', nullable: true })
  article: string;

  @Column({ type: 'varchar', nullable: true })
  brand: string;

  @Column({ type: 'varchar', nullable: true })
  productName: string;

  // sellPrice at the moment of adding (TypeORM returns decimals as strings).
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  priceAtAdd: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  costPrice: string;

  @Column({ type: 'varchar', nullable: true })
  warehouseId: string;

  // Raw offer identifier (from search) needed for placeOrder.
  @Column({ type: 'jsonb', nullable: true })
  raw: Record<string, unknown>;
  // --- end snapshot ---

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors. (Note: `cart.service.ts` still references `dto.productId` / `item.product.price` at this point — see below.)

> ⚠️ The current `cart.service.ts` and `add-to-cart.dto.ts` reference fields that survive this task (`productId`, `quantity`), so the build still passes. The `product.price` read in `buildResponse` also still compiles because `product` is now `Product | null` and the code already uses `item.product?.price`. If the build fails here, stop and fix before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/migrations/1700000000008-AddCartItemSnapshot.ts src/cart/entities/cart-item.entity.ts
git commit -m "feat(cart): additive cart_item snapshot columns + nullable productId"
```

---

### Task 2: Cart DTOs (request snapshot + Swagger response DTOs)

**Files:**
- Modify: `src/cart/dto/add-to-cart.dto.ts`
- Modify: `src/cart/dto/update-cart-item.dto.ts`
- Create: `src/cart/dto/cart-response.dto.ts`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces:
  - `AddToCartDto { supplierCode, article, brand, productName, sellPrice, costPrice, warehouseId, raw, quantity }` — consumed by `CartService.addItem` (Task 3) and `CartController` (Task 4).
  - `CartItemDto`, `CartResponseDto` — Swagger response shapes referenced by `CartController` (Task 4).

- [ ] **Step 1: Rewrite AddToCartDto to accept an offer snapshot**

Replace `src/cart/dto/add-to-cart.dto.ts` with:

```ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsInt,
  Min,
  IsObject,
} from 'class-validator';

/**
 * Snapshot of the offer the user picked from GET /api/search.
 * The front-end echoes back the offer it received.
 */
export class AddToCartDto {
  @ApiProperty({ example: 'rossko' })
  @IsString()
  @IsNotEmpty()
  supplierCode: string;

  @ApiProperty({ example: '0986452041' })
  @IsString()
  @IsNotEmpty()
  article: string;

  @ApiProperty({ example: 'BOSCH' })
  @IsString()
  brand: string;

  @ApiProperty({ example: 'Фильтр масляный' })
  @IsString()
  @IsNotEmpty()
  productName: string;

  @ApiProperty({ description: 'sellPrice shown to the user at selection time', example: 5200 })
  @IsNumber()
  @Min(0)
  sellPrice: number;

  @ApiProperty({ description: 'partner cost price (internal)', example: 4333 })
  @IsNumber()
  @Min(0)
  costPrice: number;

  @ApiProperty({ description: 'partner warehouse / offer id', example: 'W12' })
  @IsString()
  @IsNotEmpty()
  warehouseId: string;

  @ApiProperty({
    description: 'raw offer identifier from search, passed back for placeOrder',
    type: Object,
  })
  @IsObject()
  raw: Record<string, unknown>;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}
```

- [ ] **Step 2: Add Swagger annotation to UpdateCartItemDto**

Replace `src/cart/dto/update-cart-item.dto.ts` with:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class UpdateCartItemDto {
  @ApiProperty({ example: 3, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}
```

- [ ] **Step 3: Create the response DTOs**

Create `src/cart/dto/cart-response.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

export class CartItemDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'rossko' }) supplierCode: string;
  @ApiProperty({ example: 'Rossko' }) supplierName: string;
  @ApiProperty() article: string;
  @ApiProperty() brand: string;
  @ApiProperty() productName: string;
  @ApiProperty({ description: 'sellPrice at the moment of adding', example: 5200 })
  priceAtAdd: number;
  @ApiProperty({ description: 'fresh sellPrice from live re-check', example: 5450 })
  currentPrice: number;
  @ApiProperty({ description: 'currentPrice differs from priceAtAdd', example: true })
  priceChanged: boolean;
  @ApiProperty({ description: 'false if partner unavailable or offer gone', example: true })
  available: boolean;
  @ApiProperty({ example: 2 }) quantity: number;
  @ApiProperty({ description: 'currentPrice * quantity', example: 10900 })
  subtotal: number;
}

export class CartResponseDto {
  @ApiProperty({ type: [CartItemDto] })
  items: CartItemDto[];

  @ApiProperty({ description: 'sum of subtotals (fresh prices)', example: 10900 })
  totalAmount: number;

  @ApiProperty({ description: 'any item changed price or is unavailable', example: true })
  hasChanges: boolean;
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: FAIL — `cart.service.ts` and `cart.controller.ts` still reference the old `AddToCartDto.productId`. This is expected; Task 3 replaces the service. Confirm the only errors are in `cart.service.ts` / `cart.controller.ts` referencing `productId`, not in the DTO files themselves.

- [ ] **Step 5: Commit**

```bash
git add src/cart/dto/add-to-cart.dto.ts src/cart/dto/update-cart-item.dto.ts src/cart/dto/cart-response.dto.ts
git commit -m "feat(cart): offer-snapshot AddToCartDto + Swagger response DTOs"
```

---

### Task 3: CartService rewrite (live re-check + checkout contract)

**Files:**
- Modify: `src/cart/cart.service.ts` (full rewrite)
- Modify: `src/cart/cart.module.ts`
- Test: `src/cart/cart.service.spec.ts` (create)

**Interfaces:**
- Consumes:
  - `SuppliersRegistry.getByCode(code: string): Promise<SupplierConnector>` (from `../suppliers/suppliers.registry`). Throws if the connector is unregistered or inactive.
  - `SupplierConnector.search(article: string, brand?: string): Promise<SupplierOffer[]>` and `.name`.
  - `PricingService.applyMarkup(costPrice: number, supplierCode: string): Promise<number>` (from `../pricing/pricing.service`).
  - `SupplierOffer` from `../suppliers/types` (`{ supplierCode, article, brand, name, costPrice, count, deliveryDays, multiplicity, warehouseId, isAnalog, raw }`).
  - `AddToCartDto` from Task 2.
- Produces:
  - `CartService.getCheckoutItems(userId: string): Promise<CheckoutItem[]>` and exported `interface CheckoutItem` — consumed by Orders (Spec C).
  - `CartService.getCart`, `.addItem`, `.updateItem`, `.removeItem`, `.clearCart` — consumed by `CartController` (Task 4).

- [ ] **Step 1: Write the failing tests**

Create `src/cart/cart.service.spec.ts`:

```ts
import { CartService } from './cart.service';
import { MockConnector } from '../suppliers/connectors/mock/mock.connector';
import { SupplierOffer } from '../suppliers/types';

function makeOffer(partial: Partial<SupplierOffer> = {}): SupplierOffer {
  return {
    supplierCode: 'mock',
    article: 'A1',
    brand: 'BR',
    name: 'Part',
    costPrice: 100,
    count: 10,
    deliveryDays: 3,
    multiplicity: 1,
    warehouseId: 'W1',
    isAnalog: false,
    raw: { offerId: 'raw-1' },
    ...partial,
  };
}

function makeItem(partial: Record<string, any> = {}) {
  return {
    id: 'i1',
    supplierCode: 'mock',
    article: 'A1',
    brand: 'BR',
    productName: 'Part',
    warehouseId: 'W1',
    quantity: 2,
    priceAtAdd: '120',
    costPrice: '100',
    raw: { offerId: 'snap' },
    ...partial,
  };
}

function makeService(opts: {
  items?: any[];
  connector?: MockConnector;
  applyMarkup?: (cost: number, code: string) => Promise<number>;
} = {}) {
  const cart = { id: 'cart-1', userId: 'u1', items: opts.items ?? [] };
  const cartRepo = {
    findOne: jest.fn(async () => cart),
    create: jest.fn((d: any) => ({ ...d, items: [] })),
    save: jest.fn(async (c: any) => c),
  };
  const itemRepo = {
    create: jest.fn((d: any) => ({ id: 'item-new', ...d })),
    save: jest.fn(async (i: any) => i),
    remove: jest.fn(async () => undefined),
  };
  const connector = opts.connector ?? new MockConnector('mock', 'Mock Supplier');
  const registry = {
    getByCode: jest.fn(async (code: string) => {
      if (code !== connector.code) throw new Error('inactive');
      return connector;
    }),
  };
  const pricing = {
    applyMarkup: jest.fn(
      opts.applyMarkup ?? (async (cost: number) => Math.round(cost * 1.2)),
    ),
  };
  const service = new CartService(
    cartRepo as any,
    itemRepo as any,
    registry as any,
    pricing as any,
  );
  return { service, cart, cartRepo, itemRepo, registry, pricing, connector };
}

describe('CartService', () => {
  it('addItem stores offer snapshot with priceAtAdd and null productId', async () => {
    const { service, itemRepo } = makeService({ items: [] });
    await service.addItem('u1', {
      supplierCode: 'mock',
      article: 'A1',
      brand: 'BR',
      productName: 'Part',
      sellPrice: 120,
      costPrice: 100,
      warehouseId: 'W1',
      raw: { offerId: 'r' },
      quantity: 2,
    });
    expect(itemRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        supplierCode: 'mock',
        article: 'A1',
        brand: 'BR',
        productName: 'Part',
        priceAtAdd: 120,
        costPrice: 100,
        warehouseId: 'W1',
        quantity: 2,
        productId: null,
        raw: { offerId: 'r' },
      }),
    );
    expect(itemRepo.save).toHaveBeenCalled();
  });

  it('addItem dedups by (supplierCode, article, brand, warehouseId) and sums quantity', async () => {
    const existing = makeItem({ quantity: 1 });
    const { service, itemRepo } = makeService({ items: [existing] });
    await service.addItem('u1', {
      supplierCode: 'mock',
      article: 'A1',
      brand: 'BR',
      productName: 'Part',
      sellPrice: 130,
      costPrice: 110,
      warehouseId: 'W1',
      raw: {},
      quantity: 3,
    });
    expect(existing.quantity).toBe(4);
    expect(itemRepo.create).not.toHaveBeenCalled();
    expect(itemRepo.save).toHaveBeenCalledWith(existing);
  });

  it('getCart marks priceChanged and uses fresh price for subtotal when price rose', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ costPrice: 125, count: 10, warehouseId: 'W1' }),
    ]);
    const { service } = makeService({
      items: [makeItem()],
      connector,
      applyMarkup: async (c) => Math.round(c * 1.2), // 125 -> 150
    });
    const res = await service.getCart('u1');
    expect(res.items[0].currentPrice).toBe(150);
    expect(res.items[0].priceAtAdd).toBe(120);
    expect(res.items[0].priceChanged).toBe(true);
    expect(res.items[0].available).toBe(true);
    expect(res.items[0].subtotal).toBe(300);
    expect(res.items[0].supplierName).toBe('Mock Supplier');
    expect(res.totalAmount).toBe(300);
    expect(res.hasChanges).toBe(true);
    expect(res.items[0]).not.toHaveProperty('costPrice');
  });

  it('getCart treats partner failure as unavailable with currentPrice = priceAtAdd', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').failWith(
      new Error('partner down'),
    );
    const { service } = makeService({ items: [makeItem()], connector });
    const res = await service.getCart('u1');
    expect(res.items[0].available).toBe(false);
    expect(res.items[0].currentPrice).toBe(120);
    expect(res.items[0].priceChanged).toBe(false);
    expect(res.items[0].subtotal).toBe(240);
    expect(res.hasChanges).toBe(true);
  });

  it('getCart treats a disappeared offer as unavailable', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ warehouseId: 'OTHER' }),
    ]);
    const { service } = makeService({ items: [makeItem()], connector });
    const res = await service.getCart('u1');
    expect(res.items[0].available).toBe(false);
    expect(res.items[0].currentPrice).toBe(120);
  });

  it('getCart marks available=false when stock is below requested quantity', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ costPrice: 100, count: 1, warehouseId: 'W1' }),
    ]);
    const { service } = makeService({
      items: [makeItem({ quantity: 5 })],
      connector,
      applyMarkup: async (c) => Math.round(c * 1.2), // 120, equals priceAtAdd
    });
    const res = await service.getCart('u1');
    expect(res.items[0].available).toBe(false);
    expect(res.items[0].currentPrice).toBe(120);
    expect(res.items[0].priceChanged).toBe(false);
  });

  it('rechecks multiple items (parallel) and re-checks each one', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ warehouseId: 'W1', costPrice: 100 }),
      makeOffer({ warehouseId: 'W2', costPrice: 200 }),
    ]);
    const items = [
      makeItem({ id: 'i1', warehouseId: 'W1' }),
      makeItem({ id: 'i2', warehouseId: 'W2', priceAtAdd: '240' }),
    ];
    const { service, registry } = makeService({
      items,
      connector,
      applyMarkup: async (c) => Math.round(c * 1.2),
    });
    const res = await service.getCart('u1');
    expect(registry.getByCode).toHaveBeenCalledTimes(2);
    expect(res.items).toHaveLength(2);
    expect(res.items.every((i: any) => i.available)).toBe(true);
    expect(res.totalAmount).toBe(120 * 2 + 240 * 2);
  });

  it('getCheckoutItems returns the checkout contract including costPrice and sellPrice', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ costPrice: 125, count: 10, warehouseId: 'W1', raw: { offerId: 'fresh' } }),
    ]);
    const { service } = makeService({
      items: [makeItem()],
      connector,
      applyMarkup: async (c) => Math.round(c * 1.2), // 150
    });
    const res = await service.getCheckoutItems('u1');
    expect(res[0]).toEqual({
      supplierCode: 'mock',
      article: 'A1',
      brand: 'BR',
      productName: 'Part',
      costPrice: 125,
      sellPrice: 150,
      currentPrice: 150,
      priceAtAdd: 120,
      warehouseId: 'W1',
      raw: { offerId: 'fresh' },
      quantity: 2,
      available: true,
      priceChanged: true,
    });
  });

  it('getCheckoutItems falls back to snapshot cost/price when the partner fails', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').failWith(
      new Error('down'),
    );
    const { service } = makeService({ items: [makeItem()], connector });
    const res = await service.getCheckoutItems('u1');
    expect(res[0].available).toBe(false);
    expect(res[0].costPrice).toBe(100);
    expect(res[0].currentPrice).toBe(120);
    expect(res[0].sellPrice).toBe(120);
    expect(res[0].raw).toEqual({ offerId: 'snap' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/cart/cart.service.spec.ts`
Expected: FAIL — `CartService` constructor signature does not yet accept `(cartRepo, itemRepo, registry, pricing)` / `getCheckoutItems` is undefined.

- [ ] **Step 3: Rewrite the service**

Replace `src/cart/cart.service.ts` with:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { SuppliersRegistry } from '../suppliers/suppliers.registry';
import { PricingService } from '../pricing/pricing.service';

/**
 * Cart line with a fresh re-check (same as GET /cart), including the
 * cost/sell/raw/warehouse data Orders (Spec C) needs to place the order.
 * Contract duplicated verbatim in Spec B and Spec C.
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

interface RecheckResult {
  item: CartItem;
  supplierName: string;
  costPrice: number;
  currentPrice: number;
  available: boolean;
  priceChanged: boolean;
  raw: Record<string, unknown>;
  warehouseId: string;
}

const DEFAULT_RECHECK_TIMEOUT_MS = 10000;

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart)
    private readonly cartRepo: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly itemRepo: Repository<CartItem>,
    private readonly registry: SuppliersRegistry,
    private readonly pricing: PricingService,
  ) {}

  async getOrCreateCart(userId: string): Promise<Cart> {
    let cart = await this.cartRepo.findOne({
      where: { userId },
      relations: ['items'],
    });
    if (!cart) {
      cart = this.cartRepo.create({ userId, items: [] });
      await this.cartRepo.save(cart);
    }
    return cart;
  }

  async getCart(userId: string) {
    const cart = await this.getOrCreateCart(userId);
    const results = await this.recheckAll(cart.items ?? []);

    const items = results.map((r) => {
      const subtotal = r.currentPrice * r.item.quantity;
      return {
        id: r.item.id,
        supplierCode: r.item.supplierCode,
        supplierName: r.supplierName,
        article: r.item.article,
        brand: r.item.brand,
        productName: r.item.productName,
        priceAtAdd: Number(r.item.priceAtAdd),
        currentPrice: r.currentPrice,
        priceChanged: r.priceChanged,
        available: r.available,
        quantity: r.item.quantity,
        subtotal,
      };
    });

    const totalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);
    const hasChanges = items.some((i) => i.priceChanged || !i.available);

    return { items, totalAmount, hasChanges };
  }

  /** Cart lines with a fresh re-check, for Orders (Spec C). */
  async getCheckoutItems(userId: string): Promise<CheckoutItem[]> {
    const cart = await this.getOrCreateCart(userId);
    const results = await this.recheckAll(cart.items ?? []);
    return results.map((r) => ({
      supplierCode: r.item.supplierCode,
      article: r.item.article,
      brand: r.item.brand,
      productName: r.item.productName,
      costPrice: r.costPrice,
      sellPrice: r.currentPrice,
      currentPrice: r.currentPrice,
      priceAtAdd: Number(r.item.priceAtAdd),
      warehouseId: r.warehouseId,
      raw: r.raw,
      quantity: r.item.quantity,
      available: r.available,
      priceChanged: r.priceChanged,
    }));
  }

  async addItem(userId: string, dto: AddToCartDto) {
    const cart = await this.getOrCreateCart(userId);

    const existing = cart.items?.find(
      (i) =>
        i.supplierCode === dto.supplierCode &&
        i.article === dto.article &&
        i.brand === dto.brand &&
        i.warehouseId === dto.warehouseId,
    );

    if (existing) {
      existing.quantity += dto.quantity;
      await this.itemRepo.save(existing);
    } else {
      const item = this.itemRepo.create({
        cartId: cart.id,
        productId: null,
        supplierCode: dto.supplierCode,
        article: dto.article,
        brand: dto.brand,
        productName: dto.productName,
        priceAtAdd: dto.sellPrice as unknown as string,
        costPrice: dto.costPrice as unknown as string,
        warehouseId: dto.warehouseId,
        raw: dto.raw,
        quantity: dto.quantity,
      });
      await this.itemRepo.save(item);
    }

    return this.getCart(userId);
  }

  async updateItem(userId: string, itemId: string, quantity: number) {
    const cart = await this.getOrCreateCart(userId);
    const item = cart.items?.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Cart item not found.');
    item.quantity = quantity;
    await this.itemRepo.save(item);
    return this.getCart(userId);
  }

  async removeItem(userId: string, itemId: string) {
    const cart = await this.getOrCreateCart(userId);
    const item = cart.items?.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Cart item not found.');
    await this.itemRepo.remove(item);
    return this.getCart(userId);
  }

  async clearCart(userId: string) {
    const cart = await this.getOrCreateCart(userId);
    if (cart.items?.length) {
      await this.itemRepo.remove(cart.items);
    }
    return this.getCart(userId);
  }

  // --- live re-check ---

  private async recheckAll(items: CartItem[]): Promise<RecheckResult[]> {
    const settled = await Promise.allSettled(
      items.map((item) => this.recheckItem(item)),
    );
    // recheckItem catches its own errors, but stay defensive.
    return settled.map((s, idx) =>
      s.status === 'fulfilled' ? s.value : this.unavailable(items[idx]),
    );
  }

  private async recheckItem(item: CartItem): Promise<RecheckResult> {
    try {
      const connector = await this.registry.getByCode(item.supplierCode);
      const offers = await this.withTimeout(
        connector.search(item.article, item.brand),
      );
      const offer = offers.find((o) => o.warehouseId === item.warehouseId);
      if (!offer) return this.unavailable(item);

      const currentPrice = await this.pricing.applyMarkup(
        offer.costPrice,
        item.supplierCode,
      );
      const priceAtAdd = Number(item.priceAtAdd);
      return {
        item,
        supplierName: connector.name,
        costPrice: offer.costPrice,
        currentPrice,
        available: offer.count >= item.quantity,
        priceChanged: currentPrice !== priceAtAdd,
        raw: offer.raw,
        warehouseId: offer.warehouseId,
      };
    } catch {
      // Couldn't verify (partner down / timeout / inactive) => not available.
      return this.unavailable(item);
    }
  }

  /** Couldn't verify / offer gone: fall back to the snapshot, mark unavailable. */
  private unavailable(item: CartItem): RecheckResult {
    return {
      item,
      supplierName: item.supplierCode,
      costPrice: Number(item.costPrice),
      currentPrice: Number(item.priceAtAdd),
      available: false,
      priceChanged: false,
      raw: item.raw ?? {},
      warehouseId: item.warehouseId,
    };
  }

  private withTimeout<T>(p: Promise<T>): Promise<T> {
    const ms =
      Number(process.env.CART_RECHECK_TIMEOUT_MS) || DEFAULT_RECHECK_TIMEOUT_MS;
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('recheck timeout')), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
  }
}
```

- [ ] **Step 4: Wire SuppliersModule + PricingModule into CartModule and export CartService**

Replace `src/cart/cart.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { PricingModule } from '../pricing/pricing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Cart, CartItem]),
    SuppliersModule,
    PricingModule,
  ],
  providers: [CartService],
  controllers: [CartController],
  exports: [CartService],
})
export class CartModule {}
```

> Note: `ProductsModule` is no longer needed by the cart (own-product lookup is gone). Removing it from imports is correct.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/cart/cart.service.spec.ts`
Expected: PASS — all CartService tests green.

- [ ] **Step 6: Commit**

```bash
git add src/cart/cart.service.ts src/cart/cart.service.spec.ts src/cart/cart.module.ts
git commit -m "feat(cart): live re-check GET /cart + getCheckoutItems contract"
```

---

### Task 4: Cart controller Swagger

**Files:**
- Modify: `src/cart/cart.controller.ts`

**Interfaces:**
- Consumes: `AddToCartDto`, `UpdateCartItemDto`, `CartResponseDto` (Task 2); `CartService` methods (Task 3).
- Produces: annotated `/api/cart` endpoints under the `cart` Swagger tag.

- [ ] **Step 1: Annotate the controller**

Replace `src/cart/cart.controller.ts` with:

```ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiParam,
} from '@nestjs/swagger';
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CartResponseDto } from './dto/cart-response.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('cart')
@ApiBearerAuth()
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Get the cart with a live price/availability re-check' })
  @ApiOkResponse({ type: CartResponseDto })
  getCart(@CurrentUser() user: User) {
    return this.cartService.getCart(user.id);
  }

  @Post('items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a selected search offer (snapshot) to the cart' })
  @ApiOkResponse({ type: CartResponseDto })
  addItem(@CurrentUser() user: User, @Body() dto: AddToCartDto) {
    return this.cartService.addItem(user.id, dto);
  }

  @Put('items/:itemId')
  @ApiOperation({ summary: 'Change a cart item quantity' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiOkResponse({ type: CartResponseDto })
  updateItem(
    @CurrentUser() user: User,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItem(user.id, itemId, dto.quantity);
  }

  @Delete('items/:itemId')
  @ApiOperation({ summary: 'Remove a cart item' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiOkResponse({ type: CartResponseDto })
  removeItem(
    @CurrentUser() user: User,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.cartService.removeItem(user.id, itemId);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear the cart' })
  @ApiOkResponse({ type: CartResponseDto })
  clearCart(@CurrentUser() user: User) {
    return this.cartService.clearCart(user.id);
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS — whole project compiles.

- [ ] **Step 3: Commit**

```bash
git add src/cart/cart.controller.ts
git commit -m "docs(cart): Swagger annotations for /api/cart"
```

---

### Task 5: README — cart freshness model

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: documentation only.

- [ ] **Step 1: Add a "Корзина (свежесть цены)" section**

In `README.md`, insert a new `##` section immediately before `### API-документация` (currently around line 131), after the `### Наценка (pricing)` section:

```markdown
## Корзина (свежесть цены)

Корзина хранит **снапшот выбранного оффера**, а `GET /api/cart` делает **живой
запрос** к партнёру и пересчитывает цену/наличие.

- **`POST /api/cart/items`** принимает оффер, как фронт получил его из
  `GET /api/search`: `supplierCode, article, brand, productName, sellPrice,
  costPrice, warehouseId, raw, quantity`. Сохраняется снапшот с
  `priceAtAdd = sellPrice` и `productId = null`. Дедуп — по ключу оффера
  `(supplierCode, article, brand, warehouseId)`: повтор суммирует количество.
- **`GET /api/cart`** по каждой позиции параллельно (`Promise.allSettled`,
  с таймаутом `CART_RECHECK_TIMEOUT_MS`, по умолчанию 10000 мс) перезапрашивает
  партнёра:
  - `priceAtAdd` — цена на момент добавления; `currentPrice` — свежая
    (`PricingService.applyMarkup` от текущего `costPrice`); `priceChanged`
    подсвечивает разницу.
  - `subtotal` и `totalAmount` считаются по **свежей** `currentPrice`.
  - **«Не удалось проверить» = «нет в наличии».** Партнёр недоступен/таймаут,
    оффер пропал или склада меньше запрошенного количества ⇒ `available: false`,
    `currentPrice = priceAtAdd`. Позицию нельзя заказать — предлагаем удалить.
  - `costPrice` в клиентский ответ **не включается**.
- **Контракт для заказов:** `CartService.getCheckoutItems(userId)` возвращает те же
  позиции со свежей перепроверкой, но включая `costPrice`/`sellPrice`/`raw`/
  `warehouseId` — всё, что нужно оформлению (Spec C). `CartModule` экспортирует
  `CartService`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document cart freshness model (priceAtAdd vs currentPrice)"
```

---

### Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: PASS, no TypeScript errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS — all suites green, including `cart.service.spec.ts` and the untouched suppliers/pricing suites.

- [ ] **Step 3: Confirm clean tree**

Run: `git status`
Expected: clean (everything committed across Tasks 1–5). If anything is uncommitted, commit it with an appropriate message.

---

## Self-Review

**Spec coverage:**
- §1 `cart_item` additive migration + nullable `productId` → Task 1. ✅
- §2 `POST /api/cart/items` snapshot + dedup by offer key → Task 2 (DTO) + Task 3 (`addItem`). ✅
- §3 `GET /api/cart` live re-check, parallel, timeout, price-up, unavailable, fresh subtotal, no `costPrice` leak → Task 3 (`getCart`, `recheckAll`, `withTimeout`, `unavailable`). ✅
- §4 PUT/DELETE item, DELETE cart → Task 3 (`updateItem`/`removeItem`/`clearCart`) + Task 4 (routes). ✅
- §5 `getCheckoutItems()` contract + `CartModule` exports `CartService` → Task 3. ✅
- Swagger: `@ApiTags('cart')`, annotated DTOs + response DTO → Task 2 + Task 4. ✅
- Docs: README freshness model + what to POST → Task 5. ✅
- Testing: snapshot+priceAtAdd, dedup, price-up→priceChanged, partner down/offer gone→unavailable, parallel re-check, `getCheckoutItems` shape → Task 3 spec. ✅
- Acceptance checklist all mapped. ✅

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step is complete. ✅

**Type consistency:** `CheckoutItem` fields match the spec interface exactly (`costPrice, sellPrice, currentPrice, priceAtAdd, warehouseId, raw, quantity, available, priceChanged`). `getByCode`/`search`/`applyMarkup`/`SupplierOffer` signatures match the Spec 0 source files verified in this repo. `RecheckResult` is internal and consistent between `recheckItem`, `unavailable`, `getCart`, `getCheckoutItems`. ✅
