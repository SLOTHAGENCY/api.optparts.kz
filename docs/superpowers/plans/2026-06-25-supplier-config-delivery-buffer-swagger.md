# Supplier Config + Auto-Skip + Delivery Buffer + Swagger Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make partner API keys editable from the admin UI (stored in `suppliers.config`, env as fallback), auto-skip unconfigured partners so search isn't blocked by a hung partner, add a configurable per-supplier+global delivery-day buffer, remove junk routes (`/api/parts`, old `docs`), and add quality Swagger docs.

**Architecture:** A `connector-config` util resolves each partner's credentials from `suppliers.config` with env fallback. Each connector gains `isConfigured()`; `SuppliersRegistry.getActive()` skips active-but-unconfigured partners (fixing the 15s search hang). A delivery buffer (`suppliers.deliveryBufferDays` + global `DELIVERY_BUFFER_DAYS`) is added to each offer's `deliveryDays` in search. Dead `rossko`/`docs` modules are deleted. All controllers/DTOs get Swagger annotations.

**Tech Stack:** NestJS 10, TypeORM 0.3 (PostgreSQL), Jest, @nestjs/swagger, vanilla test-frontend.

## Global Constraints

- Credentials live in `suppliers.config` (jsonb); a value present and non-empty there wins, otherwise fall back to the matching `process.env` var. Config key names are env names WITHOUT the partner prefix (e.g. `KEY1` ↔ `ROSSKO_KEY1`).
- `SuppliersRegistry.getActive()` returns a connector only if `supplier.isActive === true` AND `await connector.isConfigured() === true`.
- Default `SEARCH_TIMEOUT_MS` is 8000 (was 15000); still overridable by env.
- Effective delivery buffer = `supplier.deliveryBufferDays ?? settings.DELIVERY_BUFFER_DAYS ?? 0`; applied as `deliveryDays = partnerDeliveryDays + buffer`.
- Credentials/`config` are only ever returned by ADMIN-gated endpoints; never leak to clients.
- Run `npm run build` and `npm test` before every commit; both must pass.
- Do NOT call any connector `placeOrder` in tests.

---

## Task 1: connector-config resolver util

**Files:**
- Create: `src/suppliers/connector-config.util.ts`
- Create: `src/suppliers/connector-config.util.spec.ts`

**Interfaces:**
- Produces:
  - `resolveConfig(suppliersService: { findByCode(code: string): Promise<{ config?: Record<string, unknown> | null } | null> }, code: string, envMap: Record<string, string>): Promise<Record<string, string>>` — for each `{configKey: ENV_NAME}` in envMap, returns config value if present & non-empty else `process.env[ENV_NAME] ?? ''`.
  - `hasKeys(resolved: Record<string, string>, required: string[]): boolean` — true iff every required key is present and non-empty.

- [ ] **Step 1: Write the failing test**

```ts
// src/suppliers/connector-config.util.spec.ts
import { resolveConfig, hasKeys } from './connector-config.util';

function svc(config: Record<string, unknown> | null) {
  return { findByCode: async () => (config === null ? null : { config }) };
}

describe('resolveConfig', () => {
  const envMap = { KEY1: 'ROSSKO_KEY1', KEY2: 'ROSSKO_KEY2' };

  afterEach(() => { delete process.env.ROSSKO_KEY1; delete process.env.ROSSKO_KEY2; });

  it('prefers config over env', async () => {
    process.env.ROSSKO_KEY1 = 'envk1';
    const r = await resolveConfig(svc({ KEY1: 'cfgk1' }) as any, 'rossko', envMap);
    expect(r.KEY1).toBe('cfgk1');
  });

  it('falls back to env when config missing/empty', async () => {
    process.env.ROSSKO_KEY2 = 'envk2';
    const r = await resolveConfig(svc({ KEY1: 'cfgk1', KEY2: '  ' }) as any, 'rossko', envMap);
    expect(r.KEY1).toBe('cfgk1');
    expect(r.KEY2).toBe('envk2');
  });

  it('empty when neither config nor env', async () => {
    const r = await resolveConfig(svc(null) as any, 'rossko', envMap);
    expect(r.KEY1).toBe('');
  });
});

describe('hasKeys', () => {
  it('true only when all required present & non-empty', () => {
    expect(hasKeys({ A: 'x', B: 'y' }, ['A', 'B'])).toBe(true);
    expect(hasKeys({ A: 'x', B: '' }, ['A', 'B'])).toBe(false);
    expect(hasKeys({ A: 'x' }, ['A', 'B'])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx jest src/suppliers/connector-config.util.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the util**

```ts
// src/suppliers/connector-config.util.ts
interface HasConfig {
  findByCode(code: string): Promise<{ config?: Record<string, unknown> | null } | null>;
}

export async function resolveConfig(
  suppliersService: HasConfig,
  code: string,
  envMap: Record<string, string>,
): Promise<Record<string, string>> {
  const supplier = await suppliersService.findByCode(code);
  const config = (supplier?.config ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [key, envName] of Object.entries(envMap)) {
    const fromCfg = config[key];
    const cfgStr = fromCfg == null ? '' : String(fromCfg).trim();
    out[key] = cfgStr !== '' ? cfgStr : process.env[envName] ?? '';
  }
  return out;
}

export function hasKeys(resolved: Record<string, string>, required: string[]): boolean {
  return required.every((k) => (resolved[k] ?? '').trim() !== '');
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx jest src/suppliers/connector-config.util.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/suppliers/connector-config.util.ts src/suppliers/connector-config.util.spec.ts
git commit -m "feat(suppliers): connector config resolver (config over env)"
```

---

## Task 2: `isConfigured()` on all connectors + registry auto-skip + timeout

**Files:**
- Modify: `src/suppliers/supplier-connector.interface.ts` (add method to interface)
- Modify: `src/suppliers/connectors/mock/mock.connector.ts`
- Modify: `src/suppliers/connectors/rossko/rossko.connector.ts`, `.../tabys/tabys.connector.ts`, `.../shatem/shatem.connector.ts`, `.../autotrade/autotrade.connector.ts`
- Modify: `src/suppliers/suppliers.registry.ts`
- Modify: `src/search/search.service.ts` (timeout default)
- Test: `src/suppliers/suppliers.registry.spec.ts` (extend)

**Interfaces:**
- Consumes: `resolveConfig`, `hasKeys` (Task 1); `SuppliersService.findByCode`.
- Produces: `SupplierConnector.isConfigured(): Promise<boolean>` on every connector; `SuppliersRegistry.getActive()` filters by `isActive && isConfigured()`.

> Adding `isConfigured` to the interface forces ALL implementors to define it in this task, or the build breaks. Each real connector injects `SuppliersService` (already provided in `SuppliersModule`) and uses `resolveConfig` + `hasKeys`. The connectors' existing methods keep reading `process.env` for now — Task 3 switches them to config.

- [ ] **Step 1: Add the method to the interface**

In `src/suppliers/supplier-connector.interface.ts`, add to `interface SupplierConnector`:
```ts
  /** True when all required credentials are present (config or env). */
  isConfigured(): Promise<boolean>;
```

- [ ] **Step 2: Extend the registry test (failing)**

In `src/suppliers/suppliers.registry.spec.ts`, add a test that an active-but-unconfigured connector is skipped. Use the existing test's construction style; a connector stub needs `code`, `name`, and `isConfigured`:
```ts
it('getActive skips active-but-unconfigured connectors', async () => {
  const configured = { code: 'a', name: 'A', isConfigured: async () => true } as any;
  const unconfigured = { code: 'b', name: 'B', isConfigured: async () => false } as any;
  const suppliersService = {
    findAll: async () => [
      { code: 'a', isActive: true },
      { code: 'b', isActive: true },
    ],
  };
  const registry = new SuppliersRegistry([configured, unconfigured] as any, suppliersService as any);
  const active = await registry.getActive();
  expect(active.map((c: any) => c.code)).toEqual(['a']);
});
```

- [ ] **Step 3: Run it — fails** (getActive doesn't check isConfigured yet).

Run: `npx jest src/suppliers/suppliers.registry.spec.ts -t "unconfigured"`
Expected: FAIL — returns ['a','b'].

- [ ] **Step 4: Update `getActive`**

In `src/suppliers/suppliers.registry.ts` replace `getActive`:
```ts
  async getActive(): Promise<SupplierConnector[]> {
    const rows = await this.suppliersService.findAll();
    const activeCodes = new Set(rows.filter((r) => r.isActive).map((r) => r.code));
    const candidates = this.connectors.filter((c) => activeCodes.has(c.code));
    const checked = await Promise.all(
      candidates.map(async (c) => ((await c.isConfigured()) ? c : null)),
    );
    return checked.filter((c): c is SupplierConnector => c !== null);
  }
```

- [ ] **Step 5: Implement `isConfigured` on each connector**

MockConnector — add (always configured for tests):
```ts
  async isConfigured(): Promise<boolean> { return true; }
```

Rossko — inject `SuppliersService` (add to constructor: `constructor(private readonly suppliers: SuppliersService) {}`; import it), and add:
```ts
  private readonly envMap = {
    KEY1: 'ROSSKO_KEY1', KEY2: 'ROSSKO_KEY2',
    DELIVERY_ID: 'ROSSKO_DELIVERY_ID', ADDRESS_ID: 'ROSSKO_ADDRESS_ID',
  };
  async isConfigured(): Promise<boolean> {
    return hasKeys(await resolveConfig(this.suppliers, this.code, this.envMap),
      ['KEY1', 'KEY2', 'DELIVERY_ID', 'ADDRESS_ID']);
  }
```
(import `resolveConfig, hasKeys` from `'../../connector-config.util'`.)

Tabys — inject `SuppliersService`; add:
```ts
  private readonly envMap = {
    API_KEY: 'TABYS_API_KEY', CONTRACT_ID: 'TABYS_CONTRACT_ID',
    OUTLET_ID: 'TABYS_OUTLET_ID', DELIVERY_TYPE: 'TABYS_DELIVERY_TYPE',
  };
  async isConfigured(): Promise<boolean> {
    return hasKeys(await resolveConfig(this.suppliers, this.code, this.envMap),
      ['API_KEY', 'CONTRACT_ID', 'OUTLET_ID']);
  }
```

SHATE-M — inject `SuppliersService`; add (API key OR login+password, plus agreement):
```ts
  private readonly envMap = {
    API_KEY: 'SHATE_API_KEY', LOGIN: 'SHATE_LOGIN', PASSWORD: 'SHATE_PASSWORD',
    AGREEMENT_CODE: 'SHATE_AGREEMENT_CODE', DELIVERY_ADDRESS_CODE: 'SHATE_DELIVERY_ADDRESS_CODE',
    DELIVERY_TYPE: 'SHATE_DELIVERY_TYPE',
  };
  async isConfigured(): Promise<boolean> {
    const c = await resolveConfig(this.suppliers, this.code, this.envMap);
    const auth = hasKeys(c, ['API_KEY']) || hasKeys(c, ['LOGIN', 'PASSWORD']);
    return auth && hasKeys(c, ['AGREEMENT_CODE']);
  }
```

Autotrade — inject `SuppliersService`; add:
```ts
  private readonly envMap = {
    LOGIN: 'AUTOTRADE_LOGIN', PASSWORD: 'AUTOTRADE_PASSWORD',
    CONTRACT_ID: 'AUTOTRADE_CONTRACT_ID', PAYMENT_TYPE: 'AUTOTRADE_PAYMENT_TYPE',
    RECEIPT_TYPE: 'AUTOTRADE_RECEIPT_TYPE',
  };
  async isConfigured(): Promise<boolean> {
    return hasKeys(await resolveConfig(this.suppliers, this.code, this.envMap),
      ['LOGIN', 'PASSWORD']);
  }
```

> `SuppliersModule` already provides `SuppliersService` and the connectors in the same module, so injecting it into connectors needs no import wiring beyond the `import { SuppliersService } from '../../suppliers.service';`.

- [ ] **Step 6: Lower the default search timeout**

In `src/search/search.service.ts` change `const DEFAULT_SEARCH_TIMEOUT_MS = 15000;` to `= 8000;`.

- [ ] **Step 7: Build + full test**

Run: `npm run build && npm test`
Expected: build OK; all pass (registry skip test green). Fix any connector that fails to compile because `isConfigured` is missing.

- [ ] **Step 8: Commit**

```bash
git add src/suppliers src/search/search.service.ts
git commit -m "feat(suppliers): isConfigured + registry auto-skip + 8s search timeout"
```

---

## Task 3: connectors read credentials from config (env fallback)

**Files:**
- Modify: `src/suppliers/connectors/rossko/rossko.connector.ts`, `.../tabys/...`, `.../shatem/...`, `.../autotrade/...`
- Tests: connector spec files already cover `mapOffers`/parsing (unchanged); add no network tests.

**Interfaces:**
- Consumes: `resolveConfig` (Task 1), the connector `envMap` (Task 2).

> Replace every `process.env.<PARTNER>_<KEY>` read inside connector METHODS with the resolved-config value. Resolve once per method call: `const c = await resolveConfig(this.suppliers, this.code, this.envMap);` then use `c.KEY1`, `c.API_KEY`, etc. Behaviour is identical when only env is set (fallback), but now admin-set config wins.

- [ ] **Step 1: Rossko** — in `search()`/`buildSoapEnvelope()`/`getOrderStatus()`/`buildCheckoutEnvelope()`/`placeOrder()`/`getOrderStatus()` resolve config and use it. Concretely: at the top of `search`, `placeOrder`, `getOrderStatus`, do `const c = await resolveConfig(this.suppliers, this.code, this.envMap);` and replace:
  - `process.env.ROSSKO_API_URL` → keep from env (URL is non-secret; OR add to envMap as `API_URL: 'ROSSKO_API_URL'`). Add `API_URL: 'ROSSKO_API_URL'` to envMap and use `c.API_URL || 'https://api.rossko.ru'`.
  - `process.env.ROSSKO_KEY1/KEY2/DELIVERY_ID/ADDRESS_ID` → `c.KEY1/c.KEY2/c.DELIVERY_ID/c.ADDRESS_ID`.
  Pass `c` into `buildSoapEnvelope`/`buildCheckoutEnvelope` (add a param) instead of reading env inside them.

- [ ] **Step 2: Tabys** — in `http()` the API key/base URL come from env; change `http()` to accept resolved values, or resolve in `search`/`placeOrder`/`getOrderStatus` and build the axios instance there. Add `API_URL: 'TABYS_API_URL'` to envMap; use `c.API_URL || 'https://api.tabys.parts'`, `c.API_KEY`, `c.CONTRACT_ID`, `c.OUTLET_ID`, `c.DELIVERY_TYPE`.

- [ ] **Step 3: SHATE-M** — in `getToken()`/`client()`/`search()`/`placeOrder()` use resolved config: `c.API_URL` (add `API_URL: 'SHATE_API_URL'`), `c.API_KEY` or `c.LOGIN`+`c.PASSWORD`, `c.AGREEMENT_CODE`, `c.DELIVERY_ADDRESS_CODE`, `c.DELIVERY_TYPE`.

- [ ] **Step 4: Autotrade** — in `authKey()`/`call()`/`placeOrder()` use resolved config: add `API_URL: 'AUTOTRADE_API_URL'`; use `c.LOGIN`, `c.PASSWORD`, `c.API_URL || 'https://api2.autotrade.su/'`, `c.CONTRACT_ID`, `c.PAYMENT_TYPE`, `c.RECEIPT_TYPE`. `authKey()` becomes async (resolves config) — update its callers (`call()`), which are already async.

- [ ] **Step 5: Build + full test**

Run: `npm run build && npm test`
Expected: build OK, all pass (mapOffers tests unaffected; env-only behaviour preserved).

- [ ] **Step 6: Commit**

```bash
git add src/suppliers/connectors
git commit -m "feat(suppliers): connectors read credentials from config with env fallback"
```

---

## Task 4: delivery buffer (per-supplier + global)

**Files:**
- Modify: `src/suppliers/entities/supplier.entity.ts` (column)
- Create: `src/migrations/1700000000015-AddSupplierDeliveryBuffer.ts`
- Modify: `src/settings/settings.service.ts` (`DELIVERY_BUFFER_DAYS` in AppSettings + getter), `src/settings/dto/update-settings.dto.ts`
- Modify: `src/settings/settings.service.spec.ts`
- Modify: `src/suppliers/dto/update-supplier.dto.ts`, `src/suppliers/suppliers.service.ts`
- Modify: `src/search/search.service.ts` (apply buffer), `src/search/search.service.spec.ts`

**Interfaces:**
- Produces: `Supplier.deliveryBufferDays: number | null`; `SettingsService.getDeliveryBufferDays(): Promise<number>`; search offers’ `deliveryDays` include the buffer.

> NOTE: cart (`GET /api/cart`) does not surface a `deliveryDays` field, so the buffer is applied in search only (the user-visible place). No cart change needed; documented deviation from spec §2.

- [ ] **Step 1: Supplier column + migration**

`src/suppliers/entities/supplier.entity.ts` — add after `currency`:
```ts
  @ApiProperty({ example: 2, nullable: true, description: 'Extra delivery days added to this partner offers' })
  @Column({ type: 'int', nullable: true })
  deliveryBufferDays: number | null;
```
```ts
// src/migrations/1700000000015-AddSupplierDeliveryBuffer.ts
import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSupplierDeliveryBuffer1700000000015 implements MigrationInterface {
  name = 'AddSupplierDeliveryBuffer1700000000015';
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "suppliers" ADD "deliveryBufferDays" integer`);
  }
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "suppliers" DROP COLUMN "deliveryBufferDays"`);
  }
}
```

- [ ] **Step 2: Settings — DELIVERY_BUFFER_DAYS (failing test first)**

In `src/settings/settings.service.spec.ts` add:
```ts
it('getDeliveryBufferDays defaults to 0 and reads stored value', async () => {
  const { service } = makeService();
  expect(await service.getDeliveryBufferDays()).toBe(0);
  const { service: s2 } = makeService({ DELIVERY_BUFFER_DAYS: 3 });
  expect(await s2.getDeliveryBufferDays()).toBe(3);
});
```
Run `npx jest src/settings/settings.service.spec.ts` → FAIL.

In `src/settings/settings.service.ts`: add `DELIVERY_BUFFER_DAYS: number;` to `AppSettings`; add `DELIVERY_BUFFER_DAYS: 0` to `DEFAULTS`; in `getAll()` add `DELIVERY_BUFFER_DAYS: num('DELIVERY_BUFFER_DAYS', DEFAULTS.DELIVERY_BUFFER_DAYS),`; add:
```ts
  async getDeliveryBufferDays(): Promise<number> {
    return (await this.getAll()).DELIVERY_BUFFER_DAYS;
  }
```
In `src/settings/dto/update-settings.dto.ts` add:
```ts
  @ApiPropertyOptional({ example: 2 })
  @IsOptional() @IsNumber() @Min(0)
  DELIVERY_BUFFER_DAYS?: number;
```
Run the settings test → PASS.

- [ ] **Step 3: Persist deliveryBufferDays on suppliers**

`src/suppliers/dto/update-supplier.dto.ts` — add:
```ts
  @ApiPropertyOptional({ example: 2, nullable: true, description: 'Extra delivery days for this partner' })
  @IsOptional() @IsNumber() @Min(0)
  deliveryBufferDays?: number | null;
```
`src/suppliers/suppliers.service.ts` `update()` — add: `if (dto.deliveryBufferDays !== undefined) supplier.deliveryBufferDays = dto.deliveryBufferDays;`

- [ ] **Step 4: Apply buffer in search (failing test)**

In `src/search/search.service.spec.ts` add a test that the buffer is added. Construct the service with stub settings + suppliers; the simplest unit hook is a new helper. Add this test:
```ts
it('adds delivery buffer (supplier over global) to offer deliveryDays', () => {
  const svc: any = new SearchService({} as any, {} as any, {} as any, {} as any, {} as any);
  // bufferByCode: rossko=+2; global=+1
  const offer = { deliveryDays: 3 };
  expect(svc.withBuffer(3, 'rossko', new Map([['rossko', 2]]), 1)).toBe(5);
  expect(svc.withBuffer(3, 'tabys', new Map([['rossko', 2]]), 1)).toBe(4); // global
  expect(svc.withBuffer(3, 'tabys', new Map([['tabys', null]]), 1)).toBe(4); // null => global
});
```
Run → FAIL.

- [ ] **Step 5: Implement buffer in search**

`src/search/search.service.ts`:
- Inject `SettingsService` and `SuppliersService` into the constructor (add params; import both). Update `SearchModule` to import `SettingsModule` and `SuppliersModule` if not already (they are via SUPPLIERS/registry — verify `SuppliersService` is exported from `SuppliersModule`; it is).
- Add the pure helper:
```ts
  /** deliveryDays + (supplier buffer ?? global buffer ?? 0). */
  withBuffer(
    days: number,
    supplierCode: string,
    bufferByCode: Map<string, number | null>,
    globalBuffer: number,
  ): number {
    const sup = bufferByCode.get(supplierCode);
    const buffer = sup != null ? sup : globalBuffer ?? 0;
    return days + buffer;
  }
```
- In `search()`, before normalizing offers, build the buffer context:
```ts
    const supplierRows = await this.suppliersService.findAll();
    const bufferByCode = new Map(
      supplierRows.map((s) => [s.code, s.deliveryBufferDays]),
    );
    const globalBuffer = await this.settings.getDeliveryBufferDays();
```
- Pass these into `toNormalizedOffer` and set
  `deliveryDays: this.withBuffer(offer.deliveryDays, offer.supplierCode, bufferByCode, globalBuffer),`
  in the produced `dto`.

- [ ] **Step 6: Build + full test**

Run: `npm run build && npm test`
Expected: build OK, all pass.

- [ ] **Step 7: Commit**

```bash
git add src/suppliers src/settings src/search src/migrations/1700000000015-AddSupplierDeliveryBuffer.ts
git commit -m "feat: configurable per-supplier + global delivery buffer"
```

---

## Task 5: remove junk routes (rossko, docs)

**Files:**
- Delete: `src/rossko/rossko.controller.ts`, `src/rossko/rossko.service.ts`, `src/rossko/rossko.module.ts`
- Delete: `src/docs/docs.controller.ts`, `src/docs/docs.module.ts`, `src/docs/openapi.yaml`
- Modify: `src/app.module.ts` (drop `RosskoModule`, `DocsModule` imports + their import lines)

- [ ] **Step 1: Confirm nothing else references them**

Run: `grep -rn "RosskoModule\|RosskoController\|RosskoService\|DocsModule\|/api/parts\|docs.controller" src --include=*.ts | grep -v "connectors/rossko"`
Expected: only `src/app.module.ts` and the files being deleted. (The working Rossko code is `src/suppliers/connectors/rossko/` — DO NOT touch it.)

- [ ] **Step 2: Delete the dead modules**

```bash
git rm src/rossko/rossko.controller.ts src/rossko/rossko.service.ts src/rossko/rossko.module.ts
git rm src/docs/docs.controller.ts src/docs/docs.module.ts src/docs/openapi.yaml
```

- [ ] **Step 3: Remove imports from app.module.ts**

In `src/app.module.ts` remove the `import { RosskoModule } ...`, `import { DocsModule } ...` lines and remove `RosskoModule` and `DocsModule` from the `imports: [...]` array.

- [ ] **Step 4: Build + full test**

Run: `npm run build && npm test`
Expected: build OK (no dangling references), all pass.

- [ ] **Step 5: Verify routes gone at boot** (optional, if a DB is available): start the app and confirm no `/api/parts` and no old `/docs` controller routes are mapped; `/api/docs` (Swagger) still serves. Otherwise rely on the grep + build.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove dead /api/parts (rossko) and old docs modules"
```

---

## Task 6: quality Swagger annotations sweep

**Files:**
- Modify: `src/main.ts` (DocumentBuilder metadata)
- Modify each controller missing annotations: `src/auth/auth.controller.ts`, `src/cart/cart.controller.ts`, `src/orders/orders.controller.ts`, `src/addresses/addresses.controller.ts`, `src/products/products.controller.ts`, `src/categories/categories.controller.ts`, `src/brands/brands.controller.ts`, `src/search/search.controller.ts`, `src/partner-products/partner-products.controller.ts`, `src/suppliers/suppliers.controller.ts`, `src/settings/settings.controller.ts`
- Modify DTOs lacking `@ApiProperty`/`@ApiPropertyOptional`.

> This is mechanical decoration; no behaviour change, no unit tests. Verify by reading `/api/docs-json` (or building) that tags/operations render.

- [ ] **Step 1: DocumentBuilder metadata** — in `src/main.ts`, ensure the builder has `.setTitle('OptParts Aggregator API').setDescription('Multi-supplier auto-parts aggregator: search, cart, orders, admin.').setVersion('1.0').addBearerAuth()`.

- [ ] **Step 2: Per-controller annotations** — for EACH controller above, add at class level `@ApiTags('<group>')` and (if its routes require auth) `@ApiBearerAuth()`. Groups: auth→`auth`, cart→`cart`, orders→`orders`, addresses→`addresses`, products/categories/brands→`catalog`, search→`search`, partner-products→`analytics`, suppliers→`suppliers`, settings→`settings`. On each handler add `@ApiOperation({ summary: '<short verb phrase>' })`. On handlers with notable non-200 outcomes add `@ApiResponse({ status, description })` (e.g. orders create: `@ApiResponse({ status: 409, description: 'Cart changed — confirm new prices' })`; admin routes: `@ApiResponse({ status: 403, description: 'Admin only' })`). For public routes (search), keep `@Public()` and note "public" in the summary.

- [ ] **Step 3: DTO properties** — for any input/response DTO field without one, add `@ApiProperty`/`@ApiPropertyOptional` with a short description and example. Cover at least: `RegisterDto`, `LoginDto`, `AddToCartDto`, `UpdateCartItemDto`, `CreateOrderDto`, `RequestReturnDto`, `UpdateSupplierDto`, `UpdateSettingsDto`, `SearchResponseDto`/`OfferDto` (already annotated — verify).

- [ ] **Step 4: Build + full test**

Run: `npm run build && npm test`
Expected: build OK, all pass (annotations don't change runtime behaviour).

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "docs(swagger): tags, operations, responses, DTO properties across controllers"
```

---

## Task 7: admin UI — keys/config + delivery buffer

**Files:**
- Modify: `test-frontend/admin/suppliers.html`, `test-frontend/admin/settings.html`

> Static vanilla frontend; no unit tests. Run `npm run build` (must pass; you don't touch src). Verify by reading the HTML/JS.

- [ ] **Step 1: suppliers.html — config + buffer editing**

For each supplier row add: (a) a `deliveryBufferDays` number input (label "+дней"); (b) a `config` editor — a `<textarea>` pre-filled with `JSON.stringify(supplier.config ?? {}, null, 2)`. On Save, parse the textarea as JSON (show an error via `showMsg` on parse failure) and include `config` and `deliveryBufferDays` (number or null when empty) in the `PATCH /api/suppliers/:code` body alongside the existing `isActive`/`markupPercent`/`currency`.

- [ ] **Step 2: settings.html — global delivery buffer**

Add a `DELIVERY_BUFFER_DAYS` number input bound to `GET /api/settings`; include it in the `PUT /api/settings` body alongside `DEFAULT_MARKUP_PERCENT`, `FX_BUFFER_PERCENT`, `FX_RATES`.

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add test-frontend
git commit -m "feat(test-frontend): edit partner config/keys + delivery buffer in admin"
```

---

## Task 8: integration verification (local stack)

**Files:** none (verification only).

- [ ] **Step 1:** With Postgres up + `NODE_ENV=development` (synchronize creates the new `deliveryBufferDays` column), start the app. Seed only `rossko` active with valid env keys; leave `tabys/shatem/autotrade` active but unconfigured (no config/env keys).

- [ ] **Step 2: Auto-skip + speed** — `time curl '/api/search?article=0451103316&brand=BOSCH'`. Expect it returns in ~1–3s (NOT ~8s): the unconfigured partners are skipped. Confirm `search_log.suppliersQueried` reflects only configured partners.

- [ ] **Step 3: Config-driven keys** — as ADMIN, `PATCH /api/suppliers/rossko` with `{ "config": { "KEY1": "<real>", "KEY2": "<real>", "DELIVERY_ID": "000000002", "ADDRESS_ID": "74708" } }`; then unset the `ROSSKO_*` envs is not required — just confirm search still returns Rossko offers (config now drives it).

- [ ] **Step 4: Delivery buffer** — `PATCH /api/suppliers/rossko` `{ "deliveryBufferDays": 5 }`; search again and confirm each Rossko offer's `deliveryDays` increased by 5 vs before. Then set global `DELIVERY_BUFFER_DAYS=3` via `PUT /api/settings` and confirm a partner without its own buffer uses 3.

- [ ] **Step 5: Junk gone** — `curl -o /dev/null -w '%{http_code}' /api/parts/search` → 404; `/api/docs` (Swagger UI) → 200 and shows grouped tags.

- [ ] **Step 6: Final build + test + commit**

```bash
npm run build && npm test
git add -A
git commit -m "chore: verify supplier-config + delivery buffer + cleanup locally"
```

---

## Self-review notes

- Spec §1 (keys in config + fallback + auto-skip + timeout) → Tasks 1–3. §2 (delivery buffer) → Task 4. §3 (junk removal) → Task 5. §4 Swagger → Task 6, admin UI → Task 7. Verification → Task 8.
- `isConfigured()` added to the interface in Task 2 forces all connectors (+ Mock) to implement it in that task — build stays green.
- Delivery buffer is applied in search only (cart exposes no deliveryDays); noted in Task 4.
- Credentials never reach clients: only `GET /api/suppliers` (ADMIN) returns `config`; search/cart responses carry neither config nor costPrice/currency.
