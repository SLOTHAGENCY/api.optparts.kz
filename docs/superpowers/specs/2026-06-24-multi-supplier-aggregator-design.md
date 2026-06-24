# Дизайн: мульти-поставщик агрегатор автозапчастей

**Дата:** 2026-06-24
**Статус:** утверждён к реализации
**Проект:** api.optparts.kz (NestJS 10 + TypeORM + PostgreSQL)

## 1. Цель

Превратить backend из «интернет-магазина со своим складом» в **агрегатор предложений
партнёров-поставщиков**: поиск по артикулу у нескольких партнёров, единая
ранжированная выдача, добавление в корзину, оформление и автоматическое размещение
заказа у нужного партнёра, управляемая наценка, аналитика.

## 2. Принятые решения (вводные)

1. **Размещение заказа партнёру:** автоматически через API партнёра. Возвраты —
   полуавтомат (инициирует менеджер, где есть API — отправляем, иначе заявка вручную).
2. **Наценка:** простая — процент на партнёра + глобальный дефолт. Закупочная цена
   (`costPrice`) клиенту никогда не отдаётся.
3. **Каталог:** чистый агрегатор. Свой каталог (`products`/`categories`/`brands`)
   **не удаляем** — оставляем в покое; изменения вносим аддитивно. Поиск всегда живой,
   без кэша/локального индекса товаров партнёров.
4. **Поиск:** по `article` + `brand`, с аналогами/кроссами (стиль Emex/Exist).
5. **Свежесть цены:** без кэша. `GET /cart` делает живой запрос к партнёрам и
   подсвечивает изменение цены/наличия. «Не удалось проверить» = «нет в наличии».
6. **Статусы заказов от партнёра:** на первом этапе обновление «по кнопке» менеджером;
   интерфейс закладываем сразу, cron-поллинг — отдельный поздний этап.
7. **Справочник `partner_products`:** наполняется только из заказов.
8. **Архитектура подключения партнёров:** connector-интерфейс + реестр провайдеров
   (вариант A). Новый партнёр = новый класс-коннектор + запись в конфиге, ядро не
   трогаем.

## 3. Архитектура

Новые модули: `suppliers/`, `search/`, `pricing/`. Доработка: `cart/`, `orders/`.
Без изменений (в покое): `auth/`, `users/`, `addresses/`, `docs/`, `products/`,
`categories/`, `brands/`.

```
suppliers/
  types.ts                 # SupplierOffer, PlaceOrderItem, SupplierOrderResult, ...
  supplier-connector.interface.ts
  suppliers.registry.ts    # отдаёт коннектор по code, список активных
  suppliers.service.ts     # CRUD конфига партнёров (таблица suppliers)
  entities/supplier.entity.ts
  connectors/
    rossko/rossko.connector.ts
search/
  search.service.ts        # параллельный опрос, нормализация, ранжирование
  search.controller.ts     # GET /api/search
  entities/search-log.entity.ts
pricing/
  pricing.service.ts       # applyMarkup(costPrice, supplierCode) -> sellPrice
```

### 3.1. Контракт коннектора

```ts
interface SupplierConnector {
  readonly code: string;            // 'rossko', 'emex', ...
  readonly name: string;

  search(article: string, brand?: string): Promise<SupplierOffer[]>;
  placeOrder(items: PlaceOrderItem[]): Promise<SupplierOrderResult>;
  getOrderStatus(externalOrderId: string): Promise<SupplierOrderStatus>;
  requestReturn(externalOrderId: string, items: ReturnItem[]): Promise<ReturnResult>;
}
```

- Все коннекторы регистрируются через DI-токен `SUPPLIERS` (массив провайдеров).
- `SuppliersRegistry` отдаёт коннектор по `code` и список активных.
- Коннектор инкапсулирует протокол партнёра (SOAP/REST/прайс) и наружу отдаёт только
  нормализованные типы.
- Конфиг партнёра — в таблице `suppliers`; секреты (ключи) — в `.env`.

`SupplierOffer` (результат поиска, до наценки):

```ts
{
  supplierCode: string;
  article: string;
  brand: string;
  name: string;
  costPrice: number;     // закупочная цена партнёра (внутреннее)
  count: number;         // наличие
  deliveryDays: number;  // срок поставки
  multiplicity: number;  // кратность
  warehouseId: string;   // склад/предложение у партнёра
  isAnalog: boolean;     // точное совпадение или аналог/кросс
  raw: object;           // сырой идентификатор оффера для placeOrder
}
```

### 3.2. Таблица `suppliers`

```
suppliers:
  id
  code            varchar unique   -- 'rossko'
  name            varchar
  isActive        boolean          -- вкл/выкл без передеплоя
  markupPercent   decimal null     -- % наценки; null => глобальный дефолт
  config          jsonb            -- нечувствительная конфигурация (URL и т.п.)
  createdAt / updatedAt
```

Деактивация партнёра — флагом `isActive`, запись из БД не удаляется (история ссылается
на `supplierCode` снапшотом, но имя партнёра берётся из снапшота, не из live-таблицы).

## 4. Поиск и агрегация

Эндпоинт: `GET /api/search?article=...&brand=...` (публичный).

Поток:
1. `SearchService` берёт активные коннекторы и опрашивает их **параллельно**
   (`Promise.allSettled`) с таймаутом на каждого. Упавший партнёр не роняет выдачу —
   логируем факт сбоя.
2. Каждый коннектор вернул `SupplierOffer[]` (точные + аналоги).
3. `PricingService` превращает `costPrice` → `sellPrice`. **`costPrice` наружу не
   отдаётся.**
4. Группировка по `(article, brand)`; внутри группы — предложения разных партнёров.
5. Ранжирование: по `sellPrice` ↑, при равенстве — `deliveryDays` ↑, затем `count` ↓.
   Точные совпадения — блоком выше аналогов.

Структура ответа:

```jsonc
{
  "query":   { "article": "...", "brand": "..." },
  "exact":   [ { "article": "...", "brand": "...", "name": "...",
                 "offers": [ { "offerId": "...", "supplierCode": "rossko",
                               "sellPrice": 6240, "deliveryDays": 3, "count": 10,
                               "warehouseId": "..." } ] } ],
  "analogs": [ { "...": "...", "offers": [ ] } ]
}
```

`offerId` — детерминированный идентификатор оффера (`supplierCode|article|brand|warehouseId`),
**без серверного хранения**. Фронт получает полный оффер; при добавлении в корзину
присылает его обратно.

### 4.1. `search_log` (аналитика, наполняется при каждом поиске)

```
search_log:
  id
  userId            null   -- гость = null (поиск публичный)
  article
  brand             null
  totalResults
  suppliersQueried
  suppliersFailed
  createdAt
```

Пишется асинхронно после отдачи ответа (на скорость выдачи не влияет).
Эндпоинты: `GET /api/search/history` (свой — пользователю; весь — менеджеру/админу).

## 5. Наценка (pricing)

- `PricingService.applyMarkup(costPrice, supplierCode)`:
  - markup = `suppliers.markupPercent` партнёра, иначе глобальный
    `DEFAULT_MARKUP_PERCENT` (из `.env`, напр. 20).
  - `sellPrice = round(costPrice * (1 + markup/100))`, округление до целого тенге.
- Применяется в одной точке — нормализация офферов в `SearchService` и при
  перепроверке корзины.
- `costPrice` в клиентских ответах скрыт всегда; менеджеру/админу отдаём
  (costPrice + sellPrice + маржа). Хранится в снапшотах `cart_item`/`order_item`.
- Изменение % партнёра влияет только на новые выдачи/перепроверки; оформленные заказы
  держат зафиксированную цену в `order_item`.

## 6. Корзина

`cart_item` дорабатывается аддитивно: `productId` (FK на `products`) становится
**nullable**; добавляются поля снапшота оффера.

```
cart_item (добавляемые поля):
  productId      uuid null     -- для своих товаров (на будущее); агрегатор = null
  supplierCode   varchar
  article        varchar
  brand          varchar
  productName    varchar
  priceAtAdd     decimal       -- sellPrice на момент добавления
  costPrice      decimal
  warehouseId    varchar
  raw            jsonb         -- сырой идентификатор оффера для placeOrder
  quantity       int
```

**`POST /api/cart/items`** — сохраняет снапшот выбранного оффера + `priceAtAdd`.

**`GET /api/cart`** — на каждую позицию делает **живой запрос** к API партнёра по
`article+brand`, находит тот же оффер, берёт текущую цену/наличие:

```jsonc
{
  "items": [
    { "id": "...", "supplierCode": "rossko", "article": "...", "brand": "...",
      "priceAtAdd": 5200, "currentPrice": 5450, "priceChanged": true,
      "available": true, "quantity": 2, "subtotal": 10900 }
  ],
  "totalAmount": 10900,
  "hasChanges": true
}
```

Правила:
- Запросы к партнёрам — параллельно (`Promise.allSettled`) с таймаутом.
- **Не удалось проверить** (партнёр недоступен/таймаут) ИЛИ **оффер пропал** =>
  `available: false`; позицию нельзя заказать, предлагаем удалить.
- `subtotal`/итог считаются по **свежей** `currentPrice`; `priceChanged` подсвечивает
  разницу с `priceAtAdd`.

## 7. Заказы

### 7.1. Модель данных

- `Order` — заказ клиента (как сейчас: userId, addressId, статус, totalAmount,
  комментарии менеджера).
- `OrderItem` — **иммутабельный снапшот** позиции; `productId` становится nullable,
  добавляются поля снапшота:

```
order_item (добавляемые/изменяемые поля):
  productId      uuid null
  supplierCode   varchar
  article        varchar
  brand          varchar
  productName    varchar
  costPrice      decimal      -- для маржи/отчётов
  sellPrice      decimal
  warehouseId    varchar
  raw            jsonb
  quantity       int
  subtotal       decimal
```

- `SupplierOrder` — под-заказ к конкретному партнёру (один `Order` → N `SupplierOrder`):

```
supplier_order:
  id
  orderId         uuid
  supplierCode    varchar
  externalOrderId varchar null   -- id у партнёра после размещения
  status          enum           -- NEW / PLACED / FAILED / CONFIRMED / SHIPPED /
                                  --   DELIVERED / CANCELLED
  errorMessage    text null
  returnStatus    enum null      -- NONE / REQUESTED / IN_PROGRESS / DONE / REJECTED
  createdAt / updatedAt
```

### 7.2. Поток оформления (`POST /api/orders`)

1. **Финальная live-перепроверка** цены/наличия всех позиций корзины (как §6).
   Если что-то изменилось/недоступно — `409 Conflict` со списком изменений, заказ не
   создаём.
2. Создаём `Order` + `OrderItem`-снапшоты (цены зафиксированы).
3. Группируем позиции по `supplierCode`; на каждую группу создаём `SupplierOrder` и
   вызываем `connector.placeOrder(items)`.
4. Результат каждого партнёра пишем в `SupplierOrder` (`externalOrderId` + статус, либо
   `FAILED` + `errorMessage`).
5. **Частичный успех:** часть партнёров приняла, часть упала. `Order.status =
   PARTIALLY_PLACED`; упавшие `SupplierOrder` доступны для ретрая менеджером.

### 7.3. Статусы

- `connector.getOrderStatus(externalOrderId)` — обновление **по кнопке** менеджером
  (этап 1). Маппинг статусов партнёра → внутренние делает коннектор.
- `Order.status` агрегируется из статусов под-заказов.
- Cron-поллинг — отдельный поздний этап (интерфейс уже заложен).

### 7.4. Возвраты (полуавтомат)

- Менеджер инициирует возврат по позиции `supplier_order`.
- Где у партнёра есть API — `connector.requestReturn(...)`, иначе фиксируем заявку для
  ручной обработки. Статус — в `supplier_order.returnStatus`.

### 7.5. История заказов

- `OrderItem` / `SupplierOrder` — иммутабельные снапшоты. История **ничего не теряет**,
  даже если оффер у партнёра исчез, подорожал или партнёр отключён.
- Live-перепроверка применяется **только к корзине**, к истории — никогда.
- Деактивация партнёра не каскадит на заказы (имя партнёра — из снапшота).

## 8. Аналитика

Три источника:
1. **История заказов** (`order_item` + `supplier_order`) — кто что заказывал, у каких
   партнёров, по каким ценам, маржа. Нужные индексы: `supplierCode`, `article`,
   `createdAt`, `userId`.
2. **`partner_products`** — накопительный справочник уникальных товаров, наполняется
   **только из заказов** (upsert при оформлении):

```
partner_products (unique: supplierCode + article + brand):
  supplierCode
  article
  brand
  name
  firstSeenAt
  lastSeenAt
  lastKnownCostPrice   -- справочно «последняя виденная»
  lastKnownSellPrice
  timesOrdered
```

   Не источник поиска и не источник цены (живой поиск остаётся источником истины).
3. **`search_log`** — история поиска (§4.1): спрос, нулевые выдачи, здоровье партнёров.

## 9. Эндпоинты (сводка)

| Метод/путь | Доступ | Назначение |
|---|---|---|
| `GET /api/search` | public | Поиск по артикулу+бренду, единая выдача |
| `GET /api/search/history` | user/manager | История поиска |
| `GET /api/cart` | user | Корзина с живой перепроверкой цены |
| `POST /api/cart/items` | user | Добавить оффер в корзину |
| `PUT /api/cart/items/:id` | user | Изменить количество |
| `DELETE /api/cart/items/:id` | user | Удалить позицию |
| `POST /api/orders` | user | Оформить (перепроверка + размещение партнёрам) |
| `GET /api/orders` / `:id` | user | Свои заказы (с под-заказами) |
| `GET /api/orders/all` | manager | Все заказы |
| `POST /api/orders/:id/suppliers/:sid/refresh-status` | manager | Обновить статус по кнопке |
| `POST /api/orders/:id/suppliers/:sid/retry` | manager | Ретрай размещения |
| `POST /api/orders/:id/suppliers/:sid/return` | manager | Инициировать возврат |
| `GET/POST/PUT /api/suppliers` | admin | Конфиг партнёров (вкл/выкл, % наценки) |

## 10. Обработка ошибок

- Партнёр недоступен при поиске — исключается из выдачи, факт логируется в `search_log`.
- Партнёр недоступен при перепроверке корзины — позиция `available: false`.
- Частичный сбой размещения — `Order.PARTIALLY_PLACED`, ретрай менеджером.
- Все вызовы к партнёрам — с таймаутом; коннектор маппит свои ошибки в общий формат.

## 11. Тестирование

- Юнит: `PricingService` (наценка/округление), ранжирование в `SearchService`,
  агрегация частичных сбоев, маппинг статусов в коннекторе.
- Контракт коннектора: мок-коннектор, реализующий интерфейс, для тестов search/cart/
  order без реальных партнёров.
- Интеграция: поток поиск → корзина → перепроверка → оформление → размещение на
  мок-партнёрах (успех, частичный успех, недоступность).

## 12. Будущие расширения (вне scope текущего этапа)

- **Свой каталог как коннектор `self`:** когда добавятся собственные товары — обернуть
  склад в `SupplierConnector`, который ищет по локальной таблице `products`. Попадёт в
  ту же единую выдачу и ранжирование. `cart_item`/`order_item` уже держат `productId`
  для этого случая.
- **Cron-поллинг статусов** заказов от партнёров.
- **Аналоги/кроссы:** включены с первого этапа; при необходимости — расширение
  источников кросс-номеров.
- **Чистка «спящего» каталога** (`products`/`categories`/`brands`), если агрегатор всё
  закроет и свой каталог не понадобится.
- **Наполнение `partner_products`/`search_log` из поисков** (сейчас справочник — только
  из заказов).
- **Ретеншн-политика** для `search_log`.

## 13. Этапы реализации (укрупнённо)

1. **Suppliers core:** контракт, реестр, таблица `suppliers`, перенос Rossko в коннектор.
2. **Search + pricing:** `GET /api/search`, агрегация/ранжирование, `PricingService`,
   `search_log`.
3. **Cart rework:** аддитивные поля снапшота, `GET /cart` с живой перепроверкой.
4. **Orders + supplier_order:** оформление с перепроверкой, размещение партнёрам,
   частичный успех, статусы по кнопке, ретрай.
5. **Returns:** полуавтомат через `requestReturn` / заявка вручную.
6. **Analytics:** `partner_products` (из заказов), эндпоинты истории поиска/заказов.
7. **(позже)** cron-поллинг статусов; второй реальный партнёр для проверки абстракции.
