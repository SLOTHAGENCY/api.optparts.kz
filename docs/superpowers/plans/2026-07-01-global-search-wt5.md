# WT-5 `global-search` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One polymorphic search entrypoint that routes a raw query to the right subsystem: VIN/FRAME → OEM car lookup; article/OE number → live supplier offers + PartsIndex brand disambiguation; free-text name → matching catalog categories.

**Architecture:** A `GlobalSearchService` (in `CatalogModule`) classifies the query and fans out to the services built in WT-2/WT-3/WT-4 (`PartsIndexService`, `PartsCatalogService`, `OemCatalogService`) and the existing `SearchService`. A `GlobalSearchController` exposes it. Every branch degrades gracefully so a single provider outage never blanks the whole response.

**Tech Stack:** NestJS 10, Jest. **Depends on WT-2, WT-3, WT-4** (all merged into `CatalogModule`) and the existing `SearchService` (already exported from `SearchModule` in WT-2).

## Dependency & path decision (READ FIRST)

The design (§5) says "extend the existing `/api/search`". Implementing this literally inside `SearchController` would make `SearchModule` depend on `CatalogModule`, while `CatalogModule` already depends on `SearchModule` (for prices) — a **circular module dependency**.

**Chosen approach:** own the polymorphic entrypoint in `CatalogModule` at **`GET /api/search/global`**, delegating article-price lookups to the already-imported `SearchService`. This keeps a single, clean dependency direction (`CatalogModule → SearchModule`) and leaves the existing `/api/search` (article-only) untouched and backward-compatible.

- If product later requires the exact same `/api/search?query=` path, resolve the cycle with `forwardRef(() => CatalogModule)` in `SearchModule` and move the router into `SearchController`. Not done here (YAGNI + avoids risk to the existing endpoint).

## Global Constraints

- Public endpoint: `@Public()` + `@UseGuards(OptionalJwtAuthGuard)`; `@Controller('search')` under global prefix → route method path `'global'` = `/api/search/global`.
- VIN regex: `/^[A-HJ-NPR-Z0-9]{17}$/i` (VIN excludes I, O, Q). FRAME numbers are handled by passing the raw query to `OemCatalogService.carsByVin` (its `/car/info` auto-detects VIN vs FRAME).
- Article heuristic: not a VIN, `length >= 3`, matches `/[0-9]/` and `/^[\w\-./]+$/` (alphanumerics + `- . /`), no spaces.
- Otherwise → name mode.
- Graceful degrade: wrap each provider call in try/catch (log + fallback), like `ProductCardService`.
- Test command: `npx jest src/catalog`; full: `npx jest && npx tsc --noEmit -p tsconfig.json`.

## File Structure

- `src/catalog/dto/global-search.dto.ts` — `GlobalSearchResultDto` (+ nested).
- `src/catalog/services/global-search.service.ts` — `GlobalSearchService` (+ exported `classifyQuery`).
- `src/catalog/controllers/global-search.controller.ts` — `GlobalSearchController`.
- Modify: `src/catalog/catalog.module.ts` — register service + controller.
- Tests: `src/catalog/services/global-search.service.spec.ts`.

---

## Task 1: Query classifier (pure function, TDD)

**Files:**
- Create: `src/catalog/services/global-search.service.ts` (start with just the exported classifier)
- Test: `src/catalog/services/global-search.service.spec.ts`

**Interfaces produced:**
- `type SearchMode = 'vin' | 'article' | 'name'`
- `function classifyQuery(raw: string): SearchMode`

- [ ] **Step 1: Write the failing test**

```ts
import { classifyQuery } from './global-search.service';

describe('classifyQuery', () => {
  it('detects a 17-char VIN', () => {
    expect(classifyQuery('WBAAV33403FD12345')).toBe('vin');
  });
  it('treats an OE/article number as article', () => {
    expect(classifyQuery('0451103316')).toBe('article');
    expect(classifyQuery('04465-33450')).toBe('article');
  });
  it('treats free text / cyrillic as name', () => {
    expect(classifyQuery('тормозные колодки')).toBe('name');
    expect(classifyQuery('oil filter')).toBe('name');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx jest src/catalog/services/global-search.service.spec.ts` → FAIL.

- [ ] **Step 3: Implement `classifyQuery`**

```ts
export type SearchMode = 'vin' | 'article' | 'name';

export function classifyQuery(raw: string): SearchMode {
  const q = raw.trim();
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(q)) return 'vin';
  if (q.length >= 3 && !/\s/.test(q) && /[0-9]/.test(q) && /^[\w\-./]+$/.test(q)) return 'article';
  return 'name';
}
```

- [ ] **Step 4: Run test to verify it passes** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/catalog/services/global-search.service.ts src/catalog/services/global-search.service.spec.ts
git commit -m "feat(catalog): global search query classifier"
```

---

## Task 2: GlobalSearchResultDto

**Files:**
- Create: `src/catalog/dto/global-search.dto.ts`

**Interfaces produced:**
- `class GlobalSearchArticleDto { brands: PartBrandDto[]; search: SearchResponseDto }`
- `class GlobalSearchNameDto { categories: CategoryDto[] }`
- `class GlobalSearchResultDto { mode: SearchMode; query: string; vin: VinCarDto[]; article: GlobalSearchArticleDto | null; name: GlobalSearchNameDto | null }`
  - Reuse `PartBrandDto` (WT-2), `SearchResponseDto` (`src/search/dto/search-response.dto`), `CategoryDto` (WT-3), `VinCarDto` (WT-4). `@ApiProperty` Russian descriptions.

- [ ] **Step 1: Write the DTOs.**
- [ ] **Step 2: `npx tsc --noEmit -p tsconfig.json`** → no errors.
- [ ] **Step 3: Commit** `git commit -m "feat(catalog): global search result DTO"`

---

## Task 3: GlobalSearchService (routing + fan-out)

**Files:**
- Modify: `src/catalog/services/global-search.service.ts` (add the injectable service)
- Test: extend `src/catalog/services/global-search.service.spec.ts`

**Interfaces:**
- Consumes: `OemCatalogService` (WT-4), `SearchService` (existing), `PartsIndexService` (WT-2), `PartsCatalogService` (WT-3).
- Produces `@Injectable() class GlobalSearchService { search(query: string, opts?: { catalogs?: string; lang?: string; userId?: string }): Promise<GlobalSearchResultDto> }`.
- Behavior by mode:
  - `vin` → `{ mode, query, vin: await oem.carsByVin(query, opts.catalogs, opts.lang) (catch → []), article: null, name: null }`
  - `article` → run in parallel `search.search(query, undefined, opts.userId)` and `parts.brandsByCode(query)` (each catch → empty); return `{ mode, query, vin: [], article: { brands, search }, name: null }`
  - `name` → `categories = (await catalog.listCategories(opts.lang)).filter(c => c.name.toLowerCase().includes(query.toLowerCase()))` (catch → []); `{ mode, query, vin: [], article: null, name: { categories } }`

- [ ] **Step 1: Write failing tests** for each mode using fake services (`{ carsByVin: jest.fn() }`, `{ search: jest.fn() }`, `{ brandsByCode: jest.fn() }`, `{ listCategories: jest.fn() }`). Assert routing (only the relevant provider called) and graceful fallback when a provider throws. Example:

```ts
it('routes article queries to SearchService + PartsIndex brands', async () => {
  const oem = { carsByVin: jest.fn() } as any;
  const search = { search: jest.fn(async () => ({ query: {}, exact: [], analogs: [] })) } as any;
  const parts = { brandsByCode: jest.fn(async () => [{ id: '1', name: 'Bosch' }]) } as any;
  const catalog = { listCategories: jest.fn() } as any;
  const svc = new GlobalSearchService(oem, search, parts, catalog);
  const res = await svc.search('0451103316');
  expect(res.mode).toBe('article');
  expect(oem.carsByVin).not.toHaveBeenCalled();
  expect(res.article?.brands).toEqual([{ id: '1', name: 'Bosch' }]);
});
```

- [ ] **Step 2: Run to verify fail → implement → run to verify pass.**

- [ ] **Step 3: Commit** `git commit -m "feat(catalog): GlobalSearchService polymorphic routing"`

---

## Task 4: Controller + module wiring

**Files:**
- Create: `src/catalog/controllers/global-search.controller.ts`
- Modify: `src/catalog/catalog.module.ts`

**Interfaces:**
- `GlobalSearchController` (`@Controller('search')`, `@Public()`, `@UseGuards(OptionalJwtAuthGuard)`):
  - `GET /api/search/global?query=&catalogs=&lang=` → validates non-empty `query`, calls `service.search(query, { catalogs, lang, userId: user?.id })` (inject `@CurrentUser()` like `SearchController`). `@ApiTags('search')`, `@ApiOperation`, `@ApiOkResponse({ type: GlobalSearchResultDto })`.

- [ ] **Step 1: Write the controller** (mirror `PartsController` validation + `SearchController` `@CurrentUser()` usage).
- [ ] **Step 2: Register** `GlobalSearchService` in `providers` and `GlobalSearchController` in `controllers` of `catalog.module.ts`.
- [ ] **Step 3: Full check** — `npx jest` (all pass), `npx tsc --noEmit -p tsconfig.json` (clean), `npx nest build` (succeeds).
- [ ] **Step 4: Commit** `git commit -m "feat(catalog): /api/search/global polymorphic endpoint + wiring"`

---

## Self-Review Notes

- **Spec coverage:** design §5 "Глобальный поиск" (VIN/article/name routing) and §6 row "Полиморфный /search". Article mode reuses existing `SearchService` for prices (design decision "extend existing search") while adding PartsIndex brand disambiguation.
- **Deviation (documented):** endpoint path is `/api/search/global` (new, in `CatalogModule`) instead of overloading `/api/search`, to avoid a circular module dependency. Existing `/api/search` stays backward-compatible. Alternative (`forwardRef`) noted if the exact path is required.
- **Name mode** returns real catalog categories filtered by substring (no invented data) — honest given PartsIndex has no global free-text part search (its `suggest` needs catalogId+groupId).
- **Type consistency:** `SearchMode`, `classifyQuery`, `GlobalSearchService.search`, `GlobalSearchResultDto` used verbatim across tasks; reuses `PartBrandDto`/`CategoryDto`/`VinCarDto`/`SearchResponseDto` from WT-2/3/4 + existing search.
