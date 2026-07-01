# Интеграция каталогов запчастей: parts-catalogs.com (OEM) + PartsIndex

**Дата:** 2026-07-01
**Статус:** дизайн на согласовании
**Проект:** api.optparts.kz (NestJS backend) + front (React/Vite, каталог автозапчастей)

## 1. Цель

Дать порталу optparts.kz каталог запчастей и поиск, максимально близкие по UX к
референсу [kz.alta-karter.com](https://kz.alta-karter.com/), но **на реальных
данных двух внешних API** — без выдуманных категорий и имитации данных. Всё, что
показывается пользователю (категории, авто, узлы, аналоги, характеристики,
применяемость), должно приходить из API-провайдеров; текущие моковые категории
фронта (`ALL_CATEGORIES`, `CAR_BRANDS`, `TOYOTA_MODELS`, `products`) выбрасываются.

### Пользовательские сценарии
1. **Глобальный поиск** по артикулу / названию / VIN (одно поле).
2. **Категорийная витрина**: категория → марка → модель → поколение → товары (с фасетами).
3. **Каталог по авто с узлами и взрыв-схемами** (OEM), в т.ч. подбор по VIN.
4. **Аналоги/кроссы** по OE-номеру.
5. **Карточка детали**: фото, характеристики, кросс-коды, применяемость, цена/наличие.

## 2. Провайдеры (установленные факты)

Полные спецификации сохранены в `docs/superpowers/specs/references/`:
`parts-catalogs-openapi.yaml`, `partsindex-openapi.yml`, `partsindex-openapi.json`.

### 2.1 parts-catalogs.com — OEM-каталог по авто
- **База:** `https://api.parts-catalogs.com/v1`
- **Авторизация:** заголовок `Authorization: <ключ>` (сырое значение, **без** `Bearer`). Тест-ключ `OEM-API-72CB976C-8F5A-40EA-A137-D7EC300E92C5`. Проверено вживую: 200 с ключом, 401 без.
- **Формат:** JSON. Пагинация `page` + заголовок `X-Total-Count`.
- **Биллинг по запросам:** 1 запрос = подбор деталей по одному авто (действует 24 ч, до 200 деталей). Помесячные тарифы → **кэш обязателен**.
- **Ключевые методы:** `catalogs/` (марки), `catalogs/{id}/models/`, `catalogs/{id}/cars2/` (+ `cars-parameters/` фильтры), `cars/vin-validator`, `car/info?q=<vin|frame>` (VIN/FRAME → carId+criteria), `catalogs/{id}/groups2/` (дерево узлов, drill-down), `catalogs/{id}/parts2` (детали узла + изображение + `positions[].coordinates=[X,Y,H,W]` хот-споты), `groups-suggest`, `groups-tree`, `schemas`.
- **Нет:** кроссов/аналогов по артикулу, резолвера бренда по артикулу.
- **Нестабильные ID:** `carId`, `modelId` меняются при обновлении каталога — нельзя хранить как вечные ключи.

### 2.2 PartsIndex — артикульная база + категорийный каталог
- **База:** `https://api.parts-index.com/v1`
- **Авторизация:** заголовок `Authorization: <ключ>` (сырое значение, **без** `Bearer`). Тест-ключ `PI-73CF005B-DB2B-4C28-A3DD-102021B6A305`, действует до **2026-07-11**, лимит **1000 запросов**. Проверено вживую (200 + данные).
- **Формат:** JSON, `{ "list": [...] }`. Пагинация только у `catalogs/{id}/entities` (`LazyPagination`). Заголовок `X-Message` при пустом датасете.
- **Ошибки:** `{ code, message }`. `403` с подкодами: `1004 quota deny` (исчерпан лимит), `1006 no auth data`.
- **16 методов (7 групп):**
  - **Brands:** `brands/by-part-code?code=` (артикул → бренды), `brands/parse?q=` (нормализация бренда, синонимы, oem-флаг).
  - **Entities:** `entities?code=&brand=&lang=` (карточка: `name`, `originalName`, `barcodes`, `brand`, `groups`, `parameters` (группы параметров: вес/габариты/вольтаж и т.д.), `images` (URL), `links` (варианты)).
  - **Relations:** `relations?id=|(code&brand)&types=` (аналоги; типы: `all, analog, alternative, replacement, original_replacement, possible_analog, kit_of_parts, repair_kit_for_part, …` — 18 типов).
  - **Cars By Part:** `cars?code=&brand=&lang=` (применяемость: `brand, model, modif, dateFrom, dateTo, kw, hp, cc, body, engCode`).
  - **Cars (дерево авто):** `car/brands`, `.../models`, `.../generations`, `.../engines`.
  - **Catalogs (категорийный каталог):** `catalogs` (список реальных категорий), `catalogs/{id}/groups` (дерево), `catalogs/{id}/params` (фасеты: `select`/`range`), `catalogs/{id}/suggest`, `catalogs/{id}/entities` (пагинация, товары; сужение `car[generationId]`, `car[engineId]`, `params[<id>]`), `catalogs/{id}/entities/{id}` (карточка).
  - **Parts By VIN:** `parts-by-vin/cars?q=` (VIN/frame → авто), `parts-by-vin/cars/{carId}/results` (детали, асинхронно, статусы `pending/in_progress/success/failed`).
- **Реальные категории (`catalogId`):** `accessories, auto_chemistry, auto_products, bearings, brake_tubes, car_battery, drive_belts, engine_valves, exhaust_system, filter_air, fuses, lamps, oils, parts_plugs, parts_to, tools, tyres, wheels, wipers`. **Только эти категории используем в витрине.**

## 3. Роли провайдеров (решения приняты)

| Возможность | Провайдер |
|---|---|
| Категорийная витрина + фасеты + сужение по авто | **PartsIndex** (`catalogs/*`, `car/*`) |
| Поиск по артикулу (бренд, карточка) | **PartsIndex** (`brands/by-part-code`, `entities`) |
| Аналоги/кроссы | **PartsIndex** (`relations`) |
| Применяемость | **PartsIndex** (`cars`) |
| Цена / наличие / доставка | существующий **`SearchService`** (Rossko/Tabys/Shatem/Autotrade) |
| OEM-каталог по авто, узлы, взрыв-схемы | **parts-catalogs** (`catalogs→models→cars2→groups2→parts2`) |
| **Подбор по VIN (основной)** | **parts-catalogs** (`car/info` → OEM-дерево+схемы) |
| Глобальный поиск по артикулу | **расширяем существующий `/api/search`** (обогащение PartsIndex + офферы поставщиков) |

Пересечения провайдеров (у обоих есть VIN и дерево авто) разведены: PartsIndex —
для категорийной витрины/артикульного справочника; parts-catalogs — для OEM/VIN.

## 4. Архитектура бэкенда

Новый модуль `src/catalog/`, изолированный от `suppliers`. Переиспользуем
существующие механизмы: `RateLimiterRegistry`, паттерн `resolveConfig`/секреты,
`SettingsService`, `SearchService`.

```
src/catalog/
  clients/
    parts-index.client.ts       // Authorization: PI-..., base https://api.parts-index.com/v1
    parts-catalogs.client.ts    // Authorization: OEM-API-..., base https://api.parts-catalogs.com/v1
    catalog-http.util.ts        // общий axios-обёртка: заголовки, таймаут, маппинг ошибок 400/401/403/404/422
  cache/
    catalog-cache.entity.ts     // БД-кэш
    catalog-cache.service.ts    // get-or-fetch по (provider, endpoint, paramsHash), TTL по типу
  services/
    parts-index.service.ts      // методы PartsIndex + нормализация DTO
    parts-catalogs.service.ts   // методы parts-catalogs + нормализация (//img -> https, хот-споты)
    product-card.service.ts     // сборка карточки: entities+relations+cars + цены из SearchService
    global-search.service.ts    // расширение поиска: детект VIN/артикул/название, обогащение
  controllers/
    catalog.controller.ts       // /api/catalog/*  (категорийная витрина PartsIndex)
    parts.controller.ts         // /api/parts/*    (артикул, карточка, аналоги, применяемость)
    oem.controller.ts           // /api/oem/*      (parts-catalogs: VIN, авто, узлы, схемы)
  dto/                          // унифицированные DTO + Swagger (описания на русском, как в репо)
  catalog.module.ts
```

Конфиг/секреты (env, с переопределением через `Settings`):
`PARTSINDEX_API_KEY`, `PARTSINDEX_API_URL`, `PARTSCATALOGS_API_KEY`,
`PARTSCATALOGS_API_URL`, таймауты, TTL кэша.

### 4.1 Кэш в БД (защита квоты)
Сущность `catalog_cache`: `id`, `provider` (`partsindex`|`partscatalogs`),
`endpoint`, `paramsHash` (хэш нормализованных параметров + `lang`), `payload`
(jsonb/text), `createdAt`, `expiresAt`. Уникальный индекс `(provider, endpoint, paramsHash)`.
`CatalogCacheService.getOrFetch(key, ttl, fetchFn)`: при живой записи — из кэша;
иначе — запрос к API, запись, возврат. TTL:
- справочники (`catalogs`, `car/brands`, `models`) — 7 дней;
- авто/узлы/детали/аналоги/карточки — 24 ч.

### 4.2 Rate-limit и квота-гард
- `RateLimiterRegistry.gate('partsindex'|'partscatalogs', rpm, fn)`.
- PartsIndex `403` code `1004` (quota) → бросаем доменную ошибку `QuotaExceeded`,
  логируем, во флоу поиска — graceful degrade (показываем офферы поставщиков без
  обогащения). `1006` → ошибка конфигурации ключа.
- Заголовок `X-Message` (пустой датасет) → пустой список, не ошибка.

## 5. Контракт REST (что консюмит фронт)

### Глобальный поиск (расширение существующего `/api/search`)
- `GET /api/search?query=<строка>` — полиморфно:
  - **VIN** (валиден `cars/vin-validator`, ~17 симв.) → `{ mode: "vin", cars: [...] }` (из parts-catalogs `car/info`), фронт уходит в OEM-флоу.
  - **артикул** → `{ mode: "article", groups: {exact, analogs} }` — офферы поставщиков (как сейчас) + обогащение PartsIndex (бренд-дизамбигуация `brands/by-part-code`, фото/имя `entities`).
  - **название** → `{ mode: "category", suggestions: [...] }` — подсказки категорий/узлов (`catalogs/{id}/suggest`).
  - Существующий контракт `exact/analogs` сохраняем обратносовместимо (доп. поля — опциональны).

### Артикул / карточка / аналоги (PartsIndex) — `/api/parts/*`
- `GET /api/parts/brands?code=` → бренды по артикулу (дизамбигуация).
- `GET /api/parts/card?code=&brand=&lang=` → карточка: `entities` + `relations`(аналоги) + `cars`(применяемость) + цены из `SearchService`.
- `GET /api/parts/analogs?code=&brand=&types=all` → аналоги/кроссы.
- `GET /api/parts/applicability?code=&brand=` → применяемость (марка/модель/модиф/двигатель/годы).

### Категорийная витрина (PartsIndex) — `/api/catalog/*`
- `GET /api/catalog/categories` → реальные категории.
- `GET /api/catalog/categories/:catalogId/groups` → дерево групп.
- `GET /api/catalog/categories/:catalogId/params?groupId=&car[generationId]=&params[..]=` → фасеты.
- `GET /api/catalog/categories/:catalogId/suggest?groupId=&q=` → автодополнение.
- `GET /api/catalog/categories/:catalogId/products?groupId=&car[generationId]=&car[engineId]=&params[..]=&page=&limit=` → товары (пагинация).
- `GET /api/catalog/car/brands|models|generations|engines` → дерево авто для сужения.

### OEM-каталог + VIN (parts-catalogs) — `/api/oem/*`
- `GET /api/oem/catalogs` → марки (OEM).
- `GET /api/oem/catalogs/:id/models`
- `GET /api/oem/catalogs/:id/cars?modelId=&parameter=&page=` (+ `/car-parameters?modelId=`)
- `GET /api/oem/vin?q=<vin|frame>&catalogs=` → авто (carId+criteria+catalogId). `GET /api/oem/vin/validate?vin=`.
- `GET /api/oem/catalogs/:id/groups?carId=&groupId=&criteria=` → дерево узлов.
- `GET /api/oem/catalogs/:id/parts?carId=&groupId=&criteria=` → детали узла + изображение + хот-споты.
- `GET /api/oem/catalogs/:id/schemas?carId=&partName=` → иллюстрации/схемы.

### Стык к ценам
OEM-деталь и карточка PartsIndex имеют OE-`number`/`code` + бренд → передаются в
существующий `SearchService.search(article, brand)` для цены/наличия/доставки.
Отдельный тонкий хелпер не нужен — контроллеры `parts`/`oem` вызывают `SearchService` напрямую.

## 6. Маппинг экранов alta-karter → реальные эндпоинты

| Экран/поведение alta-karter | Реализация |
|---|---|
| Полиморфный `/search` (артикул→товар, название→категория) | `GET /api/search` (см. §5) |
| `/poisk?cross=` (аналоги с фасетами бренд+OE) | `GET /api/parts/analogs` + `brands/by-part-code` для фасета |
| Категория → марка → модель → поколение → товары | `/api/catalog/categories/*` + `/api/catalog/car/*` (сужение) |
| Фасеты категории (Материал/Производитель/Ось) | `catalogs/{id}/params` (`FilterParameter`) |
| Карточка: фото, характеристики, кросс-коды, применяемость, цена | `/api/parts/card` (agg PartsIndex + SearchService) |
| Подбор по VIN (у них — внешний iframe ACAT) | нативно: `/api/oem/vin` → OEM-дерево+схемы (лучше референса) |
| Узлы/взрыв-схемы (у них нет нативно) | `/api/oem/.../groups` + `.../parts` (хот-споты) |
| Список деталей по узлу | `/api/oem/.../parts?groupId=` |

Категории берём **только** из PartsIndex `catalogs` (реальные). Маркетинговые
категории alta-karter (защита картера, фаркопы, багажники) в API отсутствуют →
не воспроизводим.

## 7. Влияние на существующий код
- `SearchService`/`/api/search`: обратносовместимое расширение (новый режим + опц. поля обогащения). Существующие тесты не ломаем.
- `products`/`brands` (БД-модули): не трогаем в рамках этой интеграции (внешние данные не кэшируем в них; используем `catalog_cache`).
- Новая миграция для таблицы `catalog_cache`.
- Фронт: удаление моков (`ALL_CATEGORIES`, `CAR_BRANDS`, `TOYOTA_MODELS`, `products`) и переключение на новые эндпоинты — вне бэкенд-скоупа этой спеки (отдельный трек), но контракт §5 фиксируем под фронт.

## 8. Тестирование
- **Unit:** клиенты (моки axios: заголовки авторизации, маппинг ошибок 401/403-1004/404/422, `X-Message`), сервисы (нормализация DTO, сборка карточки), `CatalogCacheService` (hit/miss/expiry), детект VIN/артикул/название.
- **Контрактные фикстуры:** сохранённые реальные ответы (обрезанные) обоих API в `test` для стабильных unit-тестов без сети.
- **e2e (Nest):** контроллеры с замоканными сервисами — коды ответов, валидация query, Swagger.
- Живые смоук-тесты по тест-ключам — вручную/опционально (беречь квоту PartsIndex 1000).

## 9. Разбивка на воркти (worktrees)

- **WT-1 `catalog-core`** — оба клиента (`parts-index.client`, `parts-catalogs.client`, `catalog-http.util`), конфиг/секреты, БД-кэш (`catalog_cache` + миграция), rate-limit, маппинг ошибок, `catalog.module` (без бизнес-контроллеров). Unit-тесты на моках. *Базовый; остальные зависят от него.*
- **WT-2 `partsindex-reference`** — `parts-index.service` (brands/entities/relations/cars) + `parts.controller` (`/api/parts/*`) + `product-card.service` (стык к `SearchService`) + DTO. Зависит от WT-1.
- **WT-3 `partsindex-catalog`** — категорийная витрина: `catalogs/groups/params/suggest/entities` + дерево авто (`car/*`) + `catalog.controller` (`/api/catalog/*`) + DTO. Зависит от WT-1.
- **WT-4 `oem-vin-catalog`** — `parts-catalogs.service` + `oem.controller` (`/api/oem/*`): VIN, авто, дерево узлов, взрыв-схемы (хот-споты). Зависит от WT-1.
- **WT-5 `global-search`** — расширение `/api/search`: полиморфный роутинг VIN/артикул/название + обогащение PartsIndex, обратная совместимость. Зависит от WT-2, WT-3, WT-4.

Порядок: WT-1 → (WT-2, WT-3, WT-4 параллельно) → WT-5.

## 10. Открытые вопросы / риски
- **Квоты тест-ключей:** PartsIndex 1000 запросов и срок до 11.07.26; parts-catalogs — платно/запрос. Кэш и бережные смоук-тесты обязательны. Нужны боевые ключи для продакшена.
- **Нестабильные OEM-ID** (`carId`/`modelId`): в заказах/избранном храним OE-`number` + VIN/параметры авто, а `carId` получаем переподбором.
- **Асинхронный `parts-by-vin/results`** у PartsIndex (не используем как основной VIN, основной — parts-catalogs).
- **Соответствие OE-номеров** между OEM-каталогом и офферами поставщиков (нормализация артикула) — переиспользуем существующий `normalize-article.util`.
- **Витрина маркетинговых категорий** (нестандартных, вне PartsIndex) — сознательно вне скоупа: не выдумываем.
