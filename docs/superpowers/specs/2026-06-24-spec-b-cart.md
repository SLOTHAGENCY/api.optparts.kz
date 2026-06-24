# Spec B — Cart rework (снапшот оффера + живая перепроверка)

**Дата:** 2026-06-24
**Зависит от:** Spec 0 (Foundation)
**Параллельно с:** Spec A (Search), Spec C (Orders)
**Worktree:** `cart` — ветвится от ветки с влитым Spec 0.
**Umbrella-дизайн:** [2026-06-24-multi-supplier-aggregator-design.md](./2026-06-24-multi-supplier-aggregator-design.md)

## Цель

Переделать корзину под офферы агрегатора: добавление кладёт снапшот оффера, получение
корзины делает живой запрос к партнёру и подсвечивает изменение цены/наличия.

## Зависимости из Spec 0

- `SuppliersRegistry.getByCode(code).search(article, brand)` — для перепроверки.
- `PricingService.applyMarkup(costPrice, supplierCode)`.
- `MockConnector` — для тестов.

## Scope

### 1. Доработка сущности `cart_item` (аддитивная миграция)

`productId` (FK на `products`) → **nullable**. Добавить поля снапшота:

```
cart_item (добавляемые поля):
  productId      uuid null     -- остаётся для будущих своих товаров
  supplierCode   varchar
  article        varchar
  brand          varchar
  productName    varchar
  priceAtAdd     decimal(12,2) -- sellPrice на момент добавления
  costPrice      decimal(12,2)
  warehouseId    varchar
  raw            jsonb         -- сырой идентификатор оффера (из поиска) для placeOrder
  quantity       int
```
Существующий FK на `products` не удалять — делаем `nullable`.

### 2. `POST /api/cart/items`

DTO принимает **снапшот выбранного оффера** (то, что фронт получил из `GET /api/search`):
`supplierCode, article, brand, productName, sellPrice, costPrice, warehouseId, raw,
quantity`.
- Сохраняем как `cart_item` с `priceAtAdd = sellPrice`, `productId = null`.
- Дедуп: если такой `(supplierCode, article, brand, warehouseId)` уже в корзине —
  суммируем количество.

### 3. `GET /api/cart` — живая перепроверка

Для каждой позиции:
1. `registry.getByCode(supplierCode).search(article, brand)` — найти тот же оффер
   (по `warehouseId`). Запросы по позициям — **параллельно** (`Promise.allSettled`),
   с таймаутом.
2. Если оффер найден: `currentPrice = pricing.applyMarkup(offer.costPrice,
   supplierCode)`, `available = offer.count >= quantity`.
3. **Если партнёр недоступен/таймаут ИЛИ оффер пропал** ⇒ `available = false`
   (единая трактовка «нет в наличии»); `currentPrice` показываем `= priceAtAdd`.
4. `subtotal = currentPrice * quantity` (по свежей цене); `priceChanged =
   currentPrice !== priceAtAdd`.

Ответ:
```jsonc
{
  "items": [
    { "id": "...", "supplierCode": "rossko", "supplierName": "Rossko",
      "article": "...", "brand": "...", "productName": "...",
      "priceAtAdd": 5200, "currentPrice": 5450, "priceChanged": true,
      "available": true, "quantity": 2, "subtotal": 10900 }
  ],
  "totalAmount": 10900,
  "hasChanges": true
}
```
> `costPrice` в клиентский ответ не включаем.

### 4. Прочие эндпоинты

- `PUT /api/cart/items/:id` — изменить количество.
- `DELETE /api/cart/items/:id` — удалить позицию.
- `DELETE /api/cart` — очистить.

### 5. Интеграционный контракт для Spec C (Orders)

Экспортировать из `CartService` метод для checkout (потребляется заказами):

```ts
// Возвращает позиции корзины СО СВЕЖЕЙ перепроверкой (как GET /cart),
// включая costPrice/sellPrice/raw/warehouseId/available — всё, что нужно заказу.
getCheckoutItems(userId: string): Promise<CheckoutItem[]>;

interface CheckoutItem {
  supplierCode: string; article: string; brand: string; productName: string;
  costPrice: number; sellPrice: number; currentPrice: number; priceAtAdd: number;
  warehouseId: string; raw: Record<string, unknown>; quantity: number;
  available: boolean; priceChanged: boolean;
}
```
> Этот контракт зафиксирован одинаково в Spec B и Spec C. `CartModule` экспортирует
> `CartService`.

## Swagger (обязательно)

- `@ApiTags('cart')`, аннотировать `AddToCartDto`, `UpdateCartItemDto`, DTO ответа
  корзины (`CartResponseDto`, `CartItemDto`) с `@ApiProperty`.

## Документация (обязательно)

- README/доки: модель свежести корзины (priceAtAdd vs currentPrice, priceChanged,
  «не проверили = нет в наличии»), что отправлять в `POST /cart/items`.

## Тестирование

- Добавление кладёт снапшот + `priceAtAdd`; дедуп по offer-ключу.
- `GET /cart`: цена выросла → `priceChanged=true`, subtotal по свежей.
- Партнёр недоступен / оффер пропал → `available=false`.
- Параллельная перепроверка нескольких позиций (MockConnector).
- `getCheckoutItems()` возвращает контрактную форму.

## Acceptance

- [ ] `cart_item` расширен снапшотом; `productId` nullable; миграция аддитивная.
- [ ] `POST /cart/items` принимает оффер из поиска, дедуп работает.
- [ ] `GET /cart` делает живую перепроверку, считает `priceChanged`/`available`/свежий
      `subtotal`; `costPrice` не утекает.
- [ ] «Не удалось проверить» трактуется как «нет в наличии».
- [ ] `CartService.getCheckoutItems()` экспортирован по контракту для Spec C.
- [ ] Swagger покрывает cart; README обновлён.

## Заметки по worktree/мёржу

- Касание `app.module.ts`: миграция cart (entities array уже содержит CartItem —
  меняем только сущность). Конфликтов с A минимально.
- Шов с C — только через `getCheckoutItems()` (контракт продублирован в обеих спеках).
