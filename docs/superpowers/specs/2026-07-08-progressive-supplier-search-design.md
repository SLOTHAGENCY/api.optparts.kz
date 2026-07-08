# Progressive per-supplier search — design

**Date:** 2026-07-08
**Status:** Approved

## Problem

`GET /api/search?article=X` fans out to all active suppliers and blocks on
`Promise.all` until the **slowest** one finishes (bounded by `SEARCH_TIMEOUT_MS`,
currently 15000ms). For article `500530004` three suppliers return "no results"
in <3s but SHATE-M stalls the full 15s — so the whole page waits 15s for zero
extra value. One straggler sets the latency for every search.

## Goal

Render offers **as each supplier responds**: fast suppliers appear in <3s, the
slow one fills in later (or is silently dropped if it fails/times out). No search
ever blocks on the slowest partner.

## Approach (chosen)

Fan out **from the frontend**: one request per active supplier, rendered as it
resolves. Grouping/ranking (currently server-side across all suppliers) moves to
the client, which regroups the accumulating union on each arrival. Normalization
(markup pricing, delivery buffer) stays server-side.

Rejected alternative: SSE/chunked stream from a single endpoint — cleaner
server-side grouping, but more plumbing (React streaming; react-query doesn't
stream) for no extra user benefit here.

## Backend

Two new **public** endpoints (the existing `GET /api/search` is unchanged and
kept for back-compat; the aggregate is refactored to reuse the per-supplier
method so there is one source of truth).

### `GET /api/search/suppliers`
Returns active suppliers the client should fan out to:
```
[{ code: string, name: string }]
```
Active only, **no secrets/config**. (The existing `GET /suppliers` is admin-only
and returns full config, so it can't be reused.)

### `GET /api/search/supplier/:code?article=X&brand=Y`
Runs **one** supplier's search and returns its offers **flat** (not grouped):
```
{ supplierCode: string, ok: boolean, offers: NormalizedOfferDto[] }
```
- Reuses `toNormalizedOffer` (markup + delivery buffer), the rate limiter, and
  the per-supplier timeout (`withTimeout(..., SEARCH_TIMEOUT_MS)`).
- Each offer carries `{ article, brand, name, isAnalog, dto }` — same shape the
  aggregate already builds, just not grouped.
- Supplier failure/timeout → **HTTP 200** with `{ ok: false, offers: [] }` so the
  client drops it silently (no red error state). Unknown/inactive `:code` → 404.

### Refactor
Extract a `searchOneSupplier(connector, article, brand, …): { ok, offers }`
helper in `SearchService`; both the new endpoint and the aggregate `search()`
loop call it. The aggregate keeps grouping server-side as today.

## Frontend

### Client grouping (`src/lib/groupOffers.ts`)
Pure port of the server `groupAndRank`:
- group key `normalizeArticle(article) | normalizeArticle(brand)`
- within a group sort offers by `sellPrice → deliveryDays → count desc`
- order groups by their cheapest offer's `sellPrice`
- split `exact` (`!isAnalog`) vs `analogs`
Returns `{ exact: SearchGroup[], analogs: SearchGroup[] }` — the shape OffersList
already consumes. (`normalizeArticle` mirrors the server's normalization.)

### `useProgressiveOffers(article, brand)`
- `['search-suppliers']` query → active supplier list.
- For each supplier, `['offers', code, article, brand]` query hitting
  `/api/search/supplier/:code`.
- Accumulate offers from all resolved queries, run `groupOffers` (memoized).
- Return `{ exact, analogs, loadingCount, total, isInitialLoading }` where
  `loadingCount` = suppliers still fetching, `isInitialLoading` = list or all
  per-supplier queries pending with zero offers so far.

### OffersPage / OffersList
- Swap `useOffers` → `useProgressiveOffers`.
- `isInitialLoading` → existing skeleton.
- Any offers present → render list + a thin bar **"Загружаем ещё N
  поставщиков…"** while `loadingCount > 0`; hidden at 0.
- Failed suppliers contribute nothing (silent).
- Sorting/recommended unchanged — groups re-rank as offers arrive.

## Data flow

```
GET /search/suppliers ─▶ [autotrade, tabys, rossko, shatem]
        │ fan out (react-query, one per code)
        ├─ /search/supplier/autotrade ─▶ offers ─┐
        ├─ /search/supplier/tabys     ─▶ offers ─┤ accumulate → groupOffers →
        ├─ /search/supplier/rossko    ─▶ offers ─┤ { exact, analogs } → OffersList
        └─ /search/supplier/shatem  …15s / ok:false ┘   + "загружаем ещё N…" bar
```

## Error handling

| Case | Behaviour |
|---|---|
| One supplier fails/times out | `ok:false`, contributes nothing, no error UI |
| All done, zero offers | existing empty state «ничего не найдено» |
| `/search/suppliers` fails | fall back to the old aggregate `GET /api/search` |
| Unknown `:code` | 404 |

## Testing

- **Backend:** unit for `searchOneSupplier` (normalizes one supplier, rate-limited,
  failure → `ok:false, offers:[]`); unit/e2e for `/search/suppliers` (active only,
  no secrets). Existing aggregate tests stay green after refactor.
- **Frontend:** unit for `groupOffers` mirroring the server grouping (grouping,
  intra-group sort, group order, exact/analog split).

## Out of scope

Article-search filters (unused in the offers UI), changing `SEARCH_TIMEOUT_MS`,
VIN/catalog search, SSE streaming.
