# WT-4 `oem-vin-catalog` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the parts-catalogs.com OEM vehicle catalog to the frontend under `/api/oem/*`: browse make → model → car config, look up a car by VIN/FRAME, drill the OEM node (узел) tree, and get parts on exploded diagrams with hotspot coordinates.

**Architecture:** A single `OemCatalogService` calls the existing `PartsCatalogsClient` (WT-1) through the DB cache (`CatalogCacheService`), normalizes provider payloads to clean DTOs (protocol-relative `//img…` → `https://…`, hotspot coords), and a public `OemController` maps them to REST endpoints. No new module — everything is added to the existing `CatalogModule` from WT-1.

**Tech Stack:** NestJS 10, TypeORM 0.3, axios (via `CatalogHttpClient`), Jest. Depends ONLY on WT-1 (`feat/catalog-core`): `PartsCatalogsClient`, `CatalogCacheService`, `CATALOG_TTL`, `resolveCatalogConfig`.

## Global Constraints

- parts-catalogs base `https://api.parts-catalogs.com/v1`; auth header `Authorization: <raw key>` (handled by `PartsCatalogsClient`).
- **Billing is per request** (1 request = parts lookup for one car, 24h) → cache everything. TTLs: `catalogs`, `models` → `CATALOG_TTL.REFERENCE_MS`; `cars2`, `cars-parameters`, `car/info`, `vin-validator`, `groups2`, `parts2`, `schemas` → `CATALOG_TTL.DYNAMIC_MS`.
- Vehicle identifiers (`carId`, `modelId`) are NOT stable — never persist them as permanent keys; treat every response as ephemeral.
- Images may be protocol-relative (`//img.parts-catalogs.com/...`) — normalize to `https://` in DTOs.
- `parts2.positions[].coordinates` is exactly `[X, Y, H, W]` (px from top-left; block height/width) — expose as `{ number, x, y, h, w }`.
- Public endpoints: annotate controller class with `@Public()` + `@UseGuards(OptionalJwtAuthGuard)` (mirror `src/catalog/controllers/parts.controller.ts`). Global prefix `api` → `@Controller('oem')` serves `/api/oem/*`.
- Test command: `npx jest src/catalog`. Full check: `npx jest && npx tsc --noEmit -p tsconfig.json`.
- Follow WT-2/WT-3 patterns exactly: service uses `this.cache.getOrFetch({ provider: 'partscatalogs', endpoint, params }, ttl, () => (await client.request(...)).data)`; DTOs are classes with Russian `@ApiProperty`; unit tests use `fakeClient(data)` + `fakeCache()` (getOrFetch passthrough).

## File Structure

- `src/catalog/dto/oem.dto.ts` — DTO classes (OemCatalogDto, OemModelDto, OemCarDto, OemCarParameterDto, VinCarDto, OemGroupDto, OemPartsDto + nested).
- `src/catalog/services/oem-catalog.service.ts` — `OemCatalogService`.
- `src/catalog/controllers/oem.controller.ts` — `OemController`.
- Modify: `src/catalog/catalog.module.ts` — register `OemCatalogService` (provider) + `OemController` (controller); export `OemCatalogService`.
- Tests: `src/catalog/services/oem-catalog.service.spec.ts`.

---

## Task 1: OEM DTOs

**Files:**
- Create: `src/catalog/dto/oem.dto.ts`

**Interfaces produced (exact shapes later tasks rely on):**
- `OemCatalogDto { id: string; name: string; modelsCount: number; actuality: string | null; hasVinCheck: boolean; hasFrameCheck: boolean }`
- `OemModelDto { id: string; name: string; img: string | null }`
- `OemCarParameterValueDto { idx: string; value: string }`
- `OemCarParameterDto { key: string; name: string; values: OemCarParameterValueDto[] }`
- `OemCarDto { id: string; catalogId: string; name: string; modelId: string | null; modelName: string | null; vin: string | null; frame: string | null; criteria: string | null; brand: string | null; groupsTreeAvailable: boolean; parameters: Array<{ key: string; name: string; value: string }> }`
- `VinCarDto { catalogId: string; carId: string | null; title: string; brand: string | null; modelId: string | null; modelName: string | null; criteria: string | null; vin: string | null; frame: string | null }`
- `OemGroupDto { id: string; parentId: string | null; name: string; img: string | null; hasSubgroups: boolean; hasParts: boolean }`
- `OemPartPositionDto { number: string; x: number; y: number; h: number; w: number }`
- `OemPartDto { id: string; name: string; number: string; positionNumber: string | null; notice: string | null; description: string | null }`
- `OemPartGroupDto { name: string | null; number: string | null; positionNumber: string | null; description: string | null; parts: OemPartDto[] }`
- `OemPartsDto { img: string | null; imgDescription: string | null; brand: string | null; positions: OemPartPositionDto[]; partGroups: OemPartGroupDto[] }`

- [ ] **Step 1: Write the DTO classes** with `@ApiProperty` (Russian descriptions) matching the shapes above. Reference `src/catalog/dto/catalog.dto.ts` for style.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/catalog/dto/oem.dto.ts
git commit -m "feat(catalog): OEM catalog DTOs"
```

---

## Task 2: OemCatalogService

**Files:**
- Create: `src/catalog/services/oem-catalog.service.ts`
- Test: `src/catalog/services/oem-catalog.service.spec.ts`

**Interfaces:**
- Consumes: `PartsCatalogsClient`, `CatalogCacheService`, `CATALOG_TTL`, DTOs from Task 1.
- Produces `OemCatalogService` with methods:
  - `listCatalogs(lang?): Promise<OemCatalogDto[]>` — GET `/catalogs/`
  - `listModels(catalogId, lang?): Promise<OemModelDto[]>` — GET `/catalogs/{catalogId}/models/`
  - `listCars(catalogId, modelId, parameter?, page?, lang?): Promise<{ items: OemCarDto[]; total: number | null }>` — GET `/catalogs/{catalogId}/cars2/` (read `X-Total-Count` from response headers)
  - `getCar(catalogId, carId, criteria?, lang?): Promise<OemCarDto | null>` — GET `/catalogs/{catalogId}/cars2/{carId}`
  - `carParameters(catalogId, modelId, parameter?, lang?): Promise<OemCarParameterDto[]>` — GET `/catalogs/{catalogId}/cars-parameters/`
  - `validateVin(vin, lang?): Promise<{ changed: string; original: string; errors: Array<{ errorCode: string; errorTranslate: string; details: string[] }> } | null>` — GET `/cars/vin-validator`
  - `carsByVin(q, catalogs?, lang?): Promise<VinCarDto[]>` — GET `/car/info` (auto-detects VIN vs FRAME; `catalogs` is a comma-joined id list)
  - `groups(catalogId, carId, groupId?, criteria?, lang?): Promise<OemGroupDto[]>` — GET `/catalogs/{catalogId}/groups2/`
  - `parts(catalogId, carId, groupId, criteria?, lang?): Promise<OemPartsDto>` — GET `/catalogs/{catalogId}/parts2`
- Behavior: every method goes through `getOrFetch({ provider: 'partscatalogs', endpoint, params }, ttl, fetchFn)`; images normalized via a private `img(url)` helper (`url?.startsWith('//') ? 'https:' + url : url ?? null`). `listCars`/`carParameters` need the response headers → the fetchFn should return `{ data, headers }` and the method reads `X-Total-Count`; note `getOrFetch` caches whatever the fetchFn returns, so for header-bearing calls cache the object `{ items, total }` produced AFTER normalization (call `client.request` inside fetchFn, normalize, return the final DTO object).

- [ ] **Step 1: Write the failing test** (`oem-catalog.service.spec.ts`) covering: `listCatalogs` maps + coerces booleans; `carsByVin` joins `catalogs` array into a comma string and maps `CarInfo→VinCarDto`; `groups` maps `hasParts/hasSubgroups` + normalizes protocol-relative `img`; `parts` maps `positions[].coordinates=[X,Y,H,W]` → `{x,y,h,w}` and nested `partGroups[].parts[]`; `listCars` returns `total` from the `x-total-count` header. Use `fakeClient`/`fakeCache` helpers exactly as in `parts-catalog.service.spec.ts`. Representative assertion for parts:

```ts
it('parts maps hotspot coordinates and nested part groups', async () => {
  const client = fakeClient({
    img: '//img/x.png', imgDescription: 'd', brand: 'BMW',
    positions: [{ number: '1', coordinates: [10, 20, 30, 40] }],
    partGroups: [{ name: 'G', number: 'N', positionNumber: '1', description: '', parts: [{ id: 'p1', name: 'Bolt', number: 'B1', positionNumber: '1', notice: '', description: '' }] }],
  });
  const svc = new OemCatalogService(client, fakeCache());
  const out = await svc.parts('bmw', 'car1', 'grp1');
  expect(out.img).toBe('https://img/x.png');
  expect(out.positions[0]).toEqual({ number: '1', x: 10, y: 20, h: 30, w: 40 });
  expect(out.partGroups[0].parts[0]).toMatchObject({ id: 'p1', number: 'B1' });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx jest src/catalog/services/oem-catalog.service.spec.ts` → FAIL (module missing).

- [ ] **Step 3: Write the implementation** following the WT-3 `PartsCatalogService` structure. For header-bearing methods, inside the fetchFn do `const res = await this.client.request(...); return { items: res.data.map(normalize), total: toNum(res.headers['x-total-count']) };`.

- [ ] **Step 4: Run test to verify it passes** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/catalog/services/oem-catalog.service.ts src/catalog/services/oem-catalog.service.spec.ts
git commit -m "feat(catalog): OemCatalogService over parts-catalogs (VIN, cars, nodes, parts)"
```

---

## Task 3: OemController + module wiring

**Files:**
- Create: `src/catalog/controllers/oem.controller.ts`
- Modify: `src/catalog/catalog.module.ts`

**Interfaces:**
- `OemController` (`@Controller('oem')`, `@Public()`, `@UseGuards(OptionalJwtAuthGuard)`), routes:
  - `GET /api/oem/catalogs` → `listCatalogs`
  - `GET /api/oem/catalogs/:catalogId/models` → `listModels`
  - `GET /api/oem/catalogs/:catalogId/cars?modelId=&parameter=&page=` → `listCars` (require `modelId`)
  - `GET /api/oem/catalogs/:catalogId/car-parameters?modelId=` → `carParameters` (require `modelId`)
  - `GET /api/oem/catalogs/:catalogId/cars/:carId?criteria=` → `getCar`
  - `GET /api/oem/vin/validate?vin=` → `validateVin` (require `vin`)
  - `GET /api/oem/vin?q=&catalogs=` → `carsByVin` (require `q`; `catalogs` optional comma list)
  - `GET /api/oem/catalogs/:catalogId/groups?carId=&groupId=&criteria=` → `groups` (require `carId`)
  - `GET /api/oem/catalogs/:catalogId/parts?carId=&groupId=&criteria=` → `parts` (require `carId` + `groupId`)
  - Use the same `required(value, name)` helper pattern as `PartsController`; annotate with `@ApiTags('oem')`, `@ApiOperation`, `@ApiOkResponse`.

- [ ] **Step 1: Write the controller** (validation for required query params via a private `required()` helper).

- [ ] **Step 2: Register in `catalog.module.ts`** — add `OemCatalogService` to `providers`, `OemController` to `controllers`, and `OemCatalogService` to `exports`.

- [ ] **Step 3: Run the full suite + type-check + build**

Run: `npx jest` → all pass.
Run: `npx tsc --noEmit -p tsconfig.json` → no errors.
Run: `npx nest build` (or `npm run build`) → succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/catalog/controllers/oem.controller.ts src/catalog/catalog.module.ts
git commit -m "feat(catalog): OEM controller /api/oem/* + module wiring"
```

---

## Self-Review Notes

- **Spec coverage:** VIN (`vin/validate`, `vin`) → design §5 OEM block; make/model/car browse (`catalogs/models/cars/car-parameters`); node tree (`groups`); parts on diagrams with hotspots (`parts`). Matches design §6 rows "Подбор по VIN", "Узлы/взрыв-схемы", "Список деталей по узлу".
- **Deferred (YAGNI):** `groups-suggest`, `groups-tree`, `schemas` endpoints — add later if the frontend needs node-name autocomplete / illustration pages; not required for the core VIN+catalog flow.
- **Risk:** parts-catalogs per-request billing — the 24h DB cache is mandatory; do not add uncached debug endpoints.
- **Type consistency:** DTO names in Task 1 are used verbatim by Tasks 2–3.
