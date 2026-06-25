# Spec A — Search + search_log

**Дата:** 2026-06-24
**Зависит от:** Spec 0 (Foundation)
**Параллельно с:** Spec B (Cart), Spec C (Orders)
**Worktree:** `search` — ветвится от ветки с влитым Spec 0.
**Umbrella-дизайн:** [2026-06-24-multi-supplier-aggregator-design.md](./2026-06-24-multi-supplier-aggregator-design.md)

## Цель

Живой поиск по артикулу+бренду у всех активных партнёров, единая ранжированная выдача
(точные + аналоги), и логирование поиска для аналитики.

## Зависимости из Spec 0

- `SuppliersRegistry.getActive()`, `SupplierConnector.search()`, тип `SupplierOffer`.
- `PricingService.applyMarkup(costPrice, supplierCode)`.
- `MockConnector` — для тестов.

## Scope

### 1. Модуль `search/`

- `SearchService.search(article, brand?)`:
  1. `registry.getActive()` → опрос всех `connector.search(article, brand)`
     **параллельно** через `Promise.allSettled` с таймаутом на каждого (напр. 15s).
  2. Упавший/таймаут-партнёр исключается из выдачи, считается в `suppliersFailed`.
  3. Для каждого `SupplierOffer` посчитать `sellPrice = pricing.applyMarkup(costPrice,
     supplierCode)`. **`costPrice` в ответ клиенту не включать.**
  4. Группировка по `(article, brand)`; внутри — массив `offers` от разных партнёров.
  5. Ранжирование offers: `sellPrice` ↑, затем `deliveryDays` ↑, затем `count` ↓.
  6. Разделить на `exact` (isAnalog=false) и `analogs` (isAnalog=true).
  7. Асинхронно записать `search_log` (не блокируя ответ).

- `SearchController`:
  - `GET /api/search?article=&brand=` — публичный (`@Public()`).
  - `GET /api/search/history` — свой список для текущего пользователя; для
    MANAGER/ADMIN — все записи (с пагинацией).

### 2. `offerId`

Детерминированный, без серверного хранения:
`offerId = base64url("{supplierCode}|{article}|{brand}|{warehouseId}")`.
Фронт получает полный оффер (с `offerId`) и при добавлении в корзину присылает его
обратно (используется в Spec B).

### 3. Формат ответа `GET /api/search`

```jsonc
{
  "query":   { "article": "...", "brand": "..." },
  "exact":   [ { "article": "...", "brand": "...", "name": "...",
                 "offers": [ { "offerId": "...", "supplierCode": "rossko",
                               "supplierName": "Rossko", "sellPrice": 6240,
                               "deliveryDays": 3, "count": 10, "multiplicity": 1,
                               "warehouseId": "..." } ] } ],
  "analogs": [ /* та же структура */ ]
}
```
> `costPrice` отсутствует в ответе. `raw` оффера фронту нужен для корзины — передаём его
> в составе offer-объекта (или фронт хранит весь объект и возвращает целиком в Spec B).
> Зафиксировать в Swagger-DTO, что именно фронт обязан вернуть при add-to-cart.

### 4. Сущность + миграция `search_log`

```
search_log:
  id               uuid pk
  userId           uuid null
  article          varchar
  brand            varchar null
  totalResults     int
  suppliersQueried int
  suppliersFailed  int
  createdAt        timestamptz default now()
```
Индексы: `createdAt`, `article`, `userId`.

## Swagger (обязательно)

- `@ApiTags('search')`, `@ApiOperation`, `@ApiQuery` для article/brand.
- DTO ответа поиска (`SearchResponseDto`, `OfferDto`, `SearchGroupDto`) с
  `@ApiProperty` — чтобы фронт видел контракт оффера для корзины.
- DTO истории поиска.

## Документация (обязательно)

- README/доки: поведение поиска, правила ранжирования, что значит `isAnalog`,
  семантика `offerId` и что фронт обязан вернуть при добавлении в корзину.

## Тестирование

- Ранжирование: цена → срок → наличие; exact выше analogs.
- Частичный сбой: один `MockConnector` падает/таймаутит — выдача не падает,
  `suppliersFailed` увеличен.
- Наценка применена, `costPrice` отсутствует в ответе.
- `search_log` пишется и не влияет на ответ при ошибке записи.

## Acceptance

- [ ] `GET /api/search` отдаёт ранжированную выдачу exact+analogs по нескольким
      (мок-)партнёрам.
- [ ] Наценка применена; `costPrice` не утекает клиенту.
- [ ] Падение партнёра не роняет выдачу; учитывается в `suppliersFailed`.
- [ ] `search_log` пишется асинхронно; `GET /api/search/history` работает (свой/все).
- [ ] Swagger покрывает search + history; контракт оффера для корзины задокументирован.
- [ ] README обновлён.

## Заметки по worktree/мёржу

- Касание `app.module.ts`: добавить `SearchModule` + сущность `SearchLog` (аддитивно).
- Никаких изменений в cart/orders — швов с B/C нет, кроме контракта оффера, который
  задокументирован здесь и потребляется в Spec B.
