# Order Mode (test/prod) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global test/prod order mode — in test mode orders are saved in our system but never sent to suppliers (`connector.placeOrder` is not called).

**Architecture:** A new `app_settings` key `ORDER_MODE` (`'test'|'prod'`, default `'test'`) read by `OrdersService.create`. In test mode each sub-order is persisted with `status='NEW'`, `externalOrderId=null`, `isTest=true`, no network call, and the parent order stays `NEW`. New `isTest` boolean columns on `orders` and `supplier_orders` mark test data.

**Tech Stack:** NestJS 10, TypeORM 0.3 (PostgreSQL), Jest, class-validator, @nestjs/swagger, vanilla test-frontend.

## Global Constraints

- Переключатель глобальный: `ORDER_MODE` in `app_settings`, values `'test'|'prod'`, default `'test'`.
- In test mode `connector.placeOrder` MUST NOT be called; sub-order `status='NEW'`, `externalOrderId=null`, `errorMessage=null`, `isTest=true`; parent `Order.status=NEW`, `order.isTest=true`.
- In prod mode behaviour is unchanged (current `placeSupplierOrder` + `aggregateOrderStatus`).
- Order/snapshots/`partnerProducts.recordOrder`/`cart.clearCart` run in BOTH modes.
- Credentials/costPrice never exposed to non-admin clients (unchanged); `isTest` is non-sensitive and may appear in all order reads.
- build (`npm run build`) + full test (`npm test`, currently 117) pass before each commit.
- Do NOT call any connector `placeOrder` in tests (use `MockConnector` with a spy asserting 0 calls).

---

### Task 1: ORDER_MODE setting + getOrderMode + DTO

**Files:**
- Modify: `src/settings/settings.service.ts`
- Modify: `src/settings/dto/update-settings.dto.ts`
- Test: `src/settings/settings.service.spec.ts`

**Interfaces:**
- Produces: `SettingsService.getOrderMode(): Promise<'test' | 'prod'>`; `AppSettings.ORDER_MODE: 'test' | 'prod'`; `UpdateSettingsDto.ORDER_MODE?: 'test' | 'prod'`.

- [ ] **Step 1: Write the failing tests** — open `src/settings/settings.service.spec.ts`, find the existing `makeService(rows)` helper (it builds a `SettingsService` whose repo `.find()` returns `rows`), and add this describe block:

```ts
describe('SettingsService.getOrderMode', () => {
  it('defaults to test when unset', async () => {
    const svc = makeService([]);
    expect(await svc.getOrderMode()).toBe('test');
  });
  it('reads stored prod', async () => {
    const svc = makeService([{ key: 'ORDER_MODE', value: 'prod' }]);
    expect(await svc.getOrderMode()).toBe('prod');
  });
  it('falls back to test on an unknown value', async () => {
    const svc = makeService([{ key: 'ORDER_MODE', value: 'nonsense' }]);
    expect(await svc.getOrderMode()).toBe('test');
  });
});
```

(If `makeService` lives under a different name, reuse whatever the file already uses to construct the service with seeded rows — do not invent a new harness.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/settings/settings.service.spec.ts -t getOrderMode`
Expected: FAIL — `getOrderMode is not a function`.

- [ ] **Step 3: Add ORDER_MODE to the interface, defaults, getAll, and the getter** in `src/settings/settings.service.ts`.

In the `AppSettings` interface add:
```ts
  ORDER_MODE: 'test' | 'prod';
```
In `DEFAULTS` add:
```ts
  ORDER_MODE: 'test',
```
Inside `getAll()`, within the object assigned to `this.cache`, add this property (ORDER_MODE is a string, so it does NOT use the numeric `num()` helper):
```ts
      ORDER_MODE: map.get('ORDER_MODE') === 'prod' ? 'prod' : 'test',
```
Add the getter next to the other getters:
```ts
  async getOrderMode(): Promise<'test' | 'prod'> {
    return (await this.getAll()).ORDER_MODE;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/settings/settings.service.spec.ts -t getOrderMode`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the DTO field** in `src/settings/dto/update-settings.dto.ts`. Change the imports line to include `IsIn`:
```ts
import { IsObject, IsOptional, IsNumber, Min, IsIn } from 'class-validator';
```
Add this field to the class (after `DELIVERY_BUFFER_DAYS`):
```ts
  @ApiPropertyOptional({ example: 'test', enum: ['test', 'prod'] })
  @IsOptional() @IsIn(['test', 'prod'])
  ORDER_MODE?: 'test' | 'prod';
```

- [ ] **Step 6: Build + full test**

Run: `npm run build && npm test`
Expected: build clean; all suites pass (117 + 3 new).

- [ ] **Step 7: Commit**

```bash
git add src/settings/settings.service.ts src/settings/dto/update-settings.dto.ts src/settings/settings.service.spec.ts
git commit -m "feat(settings): ORDER_MODE setting + getOrderMode getter"
```

---

### Task 2: isTest columns + migration

**Files:**
- Modify: `src/orders/entities/order.entity.ts`
- Modify: `src/orders/entities/supplier-order.entity.ts`
- Create: `src/migrations/1700000000016-AddOrderTestMode.ts`

**Interfaces:**
- Produces: `Order.isTest: boolean`, `SupplierOrder.isTest: boolean` (both default `false`).

- [ ] **Step 1: Add the column to `Order`** in `src/orders/entities/order.entity.ts`. Ensure `@ApiProperty` is imported from `@nestjs/swagger` (add to the existing swagger import, or add `import { ApiProperty } from '@nestjs/swagger';` if the file has none). Add this column alongside the other `@Column` properties (e.g. right after the `status` column):
```ts
  @ApiProperty({ description: 'True when the order was placed in test mode (not sent to suppliers).', example: false })
  @Column({ default: false })
  isTest: boolean;
```

- [ ] **Step 2: Add the column to `SupplierOrder`** in `src/orders/entities/supplier-order.entity.ts`, same import rule, add alongside its `@Column` properties:
```ts
  @ApiProperty({ description: 'True when this sub-order was created in test mode (placeOrder skipped).', example: false })
  @Column({ default: false })
  isTest: boolean;
```

- [ ] **Step 3: Create the migration** `src/migrations/1700000000016-AddOrderTestMode.ts`. Match the style of the latest existing migration in `src/migrations/` (open `1700000000015-AddSupplierDeliveryBuffer.ts` for the exact import + class shape). Content:
```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderTestMode1700000000016 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "isTest" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "supplier_orders" ADD "isTest" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "supplier_orders" DROP COLUMN "isTest"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "isTest"`);
  }
}
```
(Confirm the actual table names by reading the `@Entity(...)` decorators in the two entity files — use `orders` / `supplier_orders` unless the decorators say otherwise.)

- [ ] **Step 4: Build + full test**

Run: `npm run build && npm test`
Expected: build clean; 120 tests pass (no behaviour change yet; new columns default false).

- [ ] **Step 5: Commit**

```bash
git add src/orders/entities/order.entity.ts src/orders/entities/supplier-order.entity.ts src/migrations/1700000000016-AddOrderTestMode.ts
git commit -m "feat(orders): isTest columns on orders and supplier_orders + migration"
```

---

### Task 3: OrdersService test-mode branch

**Files:**
- Modify: `src/orders/orders.service.ts`
- Modify: `src/orders/orders.module.ts`
- Test: `src/orders/orders.service.spec.ts`

**Interfaces:**
- Consumes: `SettingsService.getOrderMode()` (Task 1); `Order.isTest`, `SupplierOrder.isTest` (Task 2).
- Produces: in test mode `create()` returns an order with `isTest=true`, `status=NEW`, sub-orders `status='NEW'`/`externalOrderId=null`/`isTest=true`, and `placeOrder` uncalled.

- [ ] **Step 1: Update the test harness for the new constructor arg.** In `src/orders/orders.service.spec.ts`:

Change `makeDeps` to accept a mode and pass a settings stub as the 6th constructor argument. Replace the `makeDeps` signature line and the `service` construction:
```ts
function makeDeps(
  items: any[],
  connectorByCode: Record<string, MockConnector>,
  mode: 'test' | 'prod' = 'prod',
) {
```
Add, just before `const service = new OrdersService(`:
```ts
  const settings = { getOrderMode: jest.fn(async () => mode) };
```
Add `settings as any,` as the last argument of `new OrdersService(...)` and add `settings` to the returned object:
```ts
  const service = new OrdersService(
    orderRepo as any,
    supplierOrderRepo as any,
    cart as any,
    registry as any,
    partnerProducts as any,
    settings as any,
  );
  return { service, orderRepo, supplierOrderRepo, cart, registry, partnerProducts, settings };
```

In `makeServiceWithSub`, add the same 6th argument to its `new OrdersService(...)` call:
```ts
    const service = new OrdersService(
      orderRepo as any,
      supplierOrderRepo as any,
      { getCheckoutItems: jest.fn(), clearCart: jest.fn() } as any,
      { getByCode: jest.fn(async () => connector) } as any,
      { recordOrder: jest.fn() } as any,
      { getOrderMode: jest.fn(async () => 'prod') } as any,
    );
```

- [ ] **Step 2: Add the failing test-mode test** to the `describe('OrdersService.create', ...)` block:
```ts
  it('test mode: does not call placeOrder; saves order+sub as NEW and isTest', async () => {
    const mock = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const spy = jest.spyOn(mock, 'placeOrder');
    const { service, cart, partnerProducts } = makeDeps(
      [makeCheckoutItem()],
      { mock },
      'test',
    );
    const order = await service.create('u1', {});
    expect(spy).not.toHaveBeenCalled();
    expect(order.isTest).toBe(true);
    expect(order.status).toBe(OrderStatus.NEW);
    expect(order.supplierOrders).toHaveLength(1);
    expect(order.supplierOrders[0].status).toBe('NEW');
    expect(order.supplierOrders[0].externalOrderId).toBeNull();
    expect(order.supplierOrders[0].isTest).toBe(true);
    expect(partnerProducts.recordOrder).toHaveBeenCalledTimes(1);
    expect(cart.clearCart).toHaveBeenCalledWith('u1');
  });
```

- [ ] **Step 3: Run to verify the new test fails (and the prod tests still pass)**

Run: `npx jest src/orders/orders.service.spec.ts`
Expected: the existing `create` tests PASS (settings stub defaults to `'prod'`); the new test FAILS (`order.isTest` undefined / `placeOrder` was called).

- [ ] **Step 4: Inject SettingsService and branch in `create`.** In `src/orders/orders.service.ts`:

Add the import near the other imports:
```ts
import { SettingsService } from '../settings/settings.service';
```
Add the constructor parameter as the last one (after `partnerProducts`):
```ts
    private readonly partnerProducts: PartnerProductsService,
    private readonly settings: SettingsService,
```
In `create()`, read the mode once — add right after the `changes`/409 block, before `// §4.3 — create Order`:
```ts
    const isTest = (await this.settings.getOrderMode()) === 'test';
```
In the `this.orderRepo.create({ ... })` call add `isTest,` to the object (e.g. after `status: OrderStatus.NEW,`):
```ts
      status: OrderStatus.NEW,
      isTest,
```
Change the sub-order loop to pass `isTest` through:
```ts
    for (const [supplierCode, groupItems] of groups) {
      subOrders.push(
        await this.placeSupplierOrder(saved.id, supplierCode, groupItems, isTest),
      );
    }
    saved.supplierOrders = subOrders;
    saved.status = isTest
      ? OrderStatus.NEW
      : aggregateOrderStatus(subOrders.map((s) => s.status));
```

- [ ] **Step 5: Branch in `placeSupplierOrder`.** Replace the `placeSupplierOrder` method body so test mode skips the network call:
```ts
  private async placeSupplierOrder(
    orderId: string,
    supplierCode: string,
    items: CheckoutItem[],
    isTest = false,
  ): Promise<SupplierOrder> {
    const sub = this.supplierOrderRepo.create({
      orderId,
      supplierCode,
      status: 'NEW' as SupplierOrderStatusValue,
      externalOrderId: null,
      errorMessage: null,
      returnStatus: null,
      externalReturnId: null,
      isTest,
    });
    if (isTest) {
      // Test mode: persist the sub-order without contacting the partner.
      return this.supplierOrderRepo.save(sub);
    }
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
```

- [ ] **Step 6: Wire SettingsModule into OrdersModule.** In `src/orders/orders.module.ts` add the import and module entry:
```ts
import { SettingsModule } from '../settings/settings.module';
```
Add `SettingsModule` to the `imports: [...]` array (after `CartModule`). (Verify `src/settings/settings.module.ts` `exports: [SettingsService]` — it already does, since SearchModule consumes it.)

- [ ] **Step 7: Run to verify all order tests pass**

Run: `npx jest src/orders/orders.service.spec.ts`
Expected: PASS (existing + new test-mode test).

- [ ] **Step 8: Build + full test**

Run: `npm run build && npm test`
Expected: build clean; 121 tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/orders/orders.service.ts src/orders/orders.module.ts src/orders/orders.service.spec.ts
git commit -m "feat(orders): skip partner placeOrder in test mode, mark isTest"
```

---

### Task 4: Admin UI toggle

**Files:**
- Modify: `test-frontend/admin/settings.html`

**Interfaces:**
- Consumes: `GET /api/settings` (`ORDER_MODE` field), `PUT /api/settings` (accepts `ORDER_MODE`).

- [ ] **Step 1: Read the current page** `test-frontend/admin/settings.html` to match its markup/JS conventions (how `DELIVERY_BUFFER_DAYS` is rendered, prefilled from the GET response, and included in the PUT body).

- [ ] **Step 2: Add an `ORDER_MODE` select.** Add a labelled `<select id="orderMode">` with options `test` and `prod` next to the existing fields:
```html
<label>Режим заказов
  <select id="orderMode">
    <option value="test">Тестовый (не отправлять партнёрам)</option>
    <option value="prod">Прод (отправлять партнёрам)</option>
  </select>
</label>
```

- [ ] **Step 3: Prefill it from GET.** Where the page populates fields from the `GET /api/settings` response (call it `data`), add:
```js
document.getElementById('orderMode').value = data.ORDER_MODE || 'test';
```

- [ ] **Step 4: Include it in the PUT body.** Where the save handler builds the `PUT /api/settings` body alongside `DEFAULT_MARKUP_PERCENT` / `FX_BUFFER_PERCENT` / `FX_RATES` / `DELIVERY_BUFFER_DAYS`, add:
```js
  ORDER_MODE: document.getElementById('orderMode').value,
```

- [ ] **Step 5: Verify the backend still compiles** (no src change here, sanity only)

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add test-frontend/admin/settings.html
git commit -m "feat(test-frontend): order mode toggle on settings page"
```

---

### Task 5: Integration verification (live)

**Files:** none (manual/live verification by the orchestrator).

- [ ] **Step 1:** Rebuild and restart the local stack (Postgres `optparts_smoke_db` + `node dist/main.js`); `synchronize` adds the `isTest` columns.
- [ ] **Step 2:** Register a user, promote to `admin`, log in.
- [ ] **Step 3:** Confirm default is test: `GET /api/settings` → `ORDER_MODE` is `'test'`.
- [ ] **Step 4:** Build a cart (search → add-to-cart → re-check) and `POST /api/orders`. Assert: order persisted, `isTest=true`, `status='NEW'`, every sub-order `status='NEW'` + `externalOrderId=null` + `isTest=true`; NO partner order was placed (Rossko has no live order API anyway — confirm `errorMessage` is null, not a placeOrder failure).
- [ ] **Step 5:** `PUT /api/settings { "ORDER_MODE": "prod" }`, then place another order. Assert prod path runs (sub-order goes through `placeSupplierOrder`; for Rossko expect `FAILED` "manual processing" — this proves the connector WAS called). Then set it back to `test`.
- [ ] **Step 6:** Report results; do not commit (no code change).

> Reminder: this is live verification, never asserts by calling a real partner `placeOrder` — Rossko has no order API, so the prod path naturally yields a manual-processing FAILED without sending anything.

---

## Self-Review

**Spec coverage:**
- §1 ORDER_MODE setting + getOrderMode → Task 1. ✅
- §1 create() test/prod branch, isTest, status NEW, analytics+clearCart both modes → Task 3. ✅
- §2 isTest columns + migration → Task 2. ✅
- §2 UpdateSettingsDto.ORDER_MODE + AppSettings → Task 1. ✅
- §2 isTest in order reads → present via entity columns (withLabel spreads the whole order; no extra work). ✅
- §3 admin settings toggle → Task 4. ✅
- §4 tests (getOrderMode defaults/reads/fallback; create test-mode no placeOrder; create prod still places) → Tasks 1 & 3. ✅

**Placeholder scan:** none — every code step shows full code.

**Type consistency:** `getOrderMode(): Promise<'test'|'prod'>` used identically in Task 1 (def) and Task 3 (consume). `isTest: boolean` columns (Task 2) match `order.isTest`/`sub.isTest` reads (Task 3). Constructor arg order: settings is the 6th param in both the service (Task 3 Step 4) and every `new OrdersService(...)` in the spec (Task 3 Step 1).
