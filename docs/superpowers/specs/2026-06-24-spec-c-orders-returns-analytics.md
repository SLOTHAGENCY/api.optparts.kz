# Spec C — Orders + supplier_order + Returns + partner_products

**Дата:** 2026-06-24
**Зависит от:** Spec 0 (Foundation); интеграционный контракт `CartService.getCheckoutItems()` из Spec B
**Параллельно с:** Spec A (Search), Spec B (Cart)
**Worktree:** `orders` — ветвится от ветки с влитым Spec 0.
**Umbrella-дизайн:** [2026-06-24-multi-supplier-aggregator-design.md](./2026-06-24-multi-supplier-aggregator-design.md)

## Цель

Оформление заказа агрегатора: финальная перепроверка, размещение позиций у нужных
партнёров через их API, частичный успех, статусы «по кнопке», ретрай, возвраты
(полуавтомат) и аналитический справочник `partner_products`.

## Зависимости из Spec 0 / Spec B

- `SuppliersRegistry.getByCode(code)` + `placeOrder/getOrderStatus/requestReturn`.
- Типы `PlaceOrderItem`, `SupplierOrderResult`, `SupplierOrderStatusValue`, `ReturnItem/Result`.
- `CartService.getCheckoutItems(userId)` (контракт из Spec B — см. ниже; до мёржа B
  можно кодить против локального мок-стаба этого контракта).

> **Контракт `getCheckoutItems()` (дублируется из Spec B):** возвращает позиции корзины
> со свежей перепроверкой: `{ supplierCode, article, brand, productName, costPrice,
> sellPrice, currentPrice, priceAtAdd, warehouseId, raw, quantity, available,
> priceChanged }`.

## Scope

### 1. Доработка `order_item` (аддитивная миграция)

`productId` → nullable. Добавить снапшот:
```
order_item (добавляемые/изменяемые поля):
  productId    uuid null
  supplierCode varchar
  article      varchar
  brand        varchar
  productName  varchar
  costPrice    decimal(12,2)
  sellPrice    decimal(12,2)
  warehouseId  varchar
  raw          jsonb
  quantity     int
  subtotal     decimal(12,2)
```
FK на `products` оставить nullable, не удалять.

### 2. Новая сущность `supplier_order` (+ миграция)

```
supplier_order:
  id              uuid pk
  orderId         uuid fk -> orders (onDelete CASCADE)
  supplierCode    varchar
  externalOrderId varchar null
  status          enum: NEW|PLACED|FAILED|CONFIRMED|SHIPPED|DELIVERED|CANCELLED
  errorMessage    text null
  returnStatus    enum null: REQUESTED|IN_PROGRESS|DONE|REJECTED
  externalReturnId varchar null
  createdAt / updatedAt
```
Один `Order` → N `supplier_order` (по числу задействованных партнёров).

### 3. Order статусы

Добавить в `OrderStatus` значение `PARTIALLY_PLACED`. `Order.status` агрегируется из
статусов под-заказов.

### 4. Поток оформления `POST /api/orders`

1. `items = cart.getCheckoutItems(userId)` — финальная live-перепроверка.
2. Если есть `!available` или `priceChanged` — `409 Conflict` со списком изменений,
   заказ не создаём (клиент должен подтвердить новую цену/убрать недоступное).
3. Создаём `Order` + `order_item`-снапшоты (цены зафиксированы из `currentPrice`).
4. Группируем позиции по `supplierCode`; на каждую группу — `supplier_order` +
   `connector.placeOrder(items)`.
5. Результат пишем в `supplier_order` (`externalOrderId` + `status=PLACED`, либо
   `status=FAILED` + `errorMessage`). Если коннектор бросает `NotImplementedException`
   (нет API заказа) — `status=FAILED` с пометкой «ручная обработка».
6. Итог: все PLACED → `Order.PLACED`; часть FAILED → `Order.PARTIALLY_PLACED`.
7. Upsert `partner_products` по каждой позиции (см. §6). Очистить корзину.

### 5. Управление заказом (роль MANAGER)

- `POST /api/orders/:id/suppliers/:sid/refresh-status` — `connector.getOrderStatus()`,
  обновить `supplier_order.status` (cron — отдельный поздний этап, здесь только кнопка).
- `POST /api/orders/:id/suppliers/:sid/retry` — повторить `placeOrder` для FAILED.
- `POST /api/orders/:id/suppliers/:sid/return` — возврат (полуавтомат): где есть API —
  `connector.requestReturn()`, иначе фиксируем `returnStatus=REQUESTED` для ручной
  обработки. Тело: список позиций/кол-во.
- Существующие: `GET /api/orders` (+ под-заказы), `GET /api/orders/:id`,
  `GET /api/orders/all`, отмена, комментарии менеджера — сохранить, расширить выдачей
  `supplier_order[]`.

### 6. Аналитика `partner_products` (+ миграция)

```
partner_products (unique: supplierCode + article + brand):
  id
  supplierCode
  article
  brand
  name
  firstSeenAt
  lastSeenAt
  lastKnownCostPrice
  lastKnownSellPrice
  timesOrdered
```
Upsert при оформлении заказа (§4.7): вставка или обновление `lastSeen*`,
`lastKnown*Price`, инкремент `timesOrdered`. **Не источник поиска/цены.**
Эндпоинт `GET /api/partner-products` (MANAGER/ADMIN, фильтры supplierCode/article,
пагинация).

### 7. История иммутабельна

Live-перепроверка применяется только к корзине. `order_item`/`supplier_order` после
создания не меняются перепроверкой; деактивация партнёра не каскадит на заказы (имя
партнёра — из снапшота).

## Swagger (обязательно)

- `@ApiTags('orders')` / `'analytics'`. Аннотировать `CreateOrderDto`, ответы заказа
  (с `supplier_order[]`), `409`-ответ перепроверки, эндпоинты управления и
  `partner-products`.

## Документация (обязательно)

- README/доки: жизненный цикл заказа и под-заказов, частичный успех, ретрай, модель
  возвратов, что такое `partner_products` и что он не источник цены.

## Тестирование

- Checkout с MockConnector: успех всех; частичный сбой (`PARTIALLY_PLACED`); ретрай
  FAILED → PLACED.
- `409` при `!available`/`priceChanged` на перепроверке.
- Снапшоты `order_item` не зависят от живых офферов (история не теряется).
- Upsert `partner_products`: вставка и инкремент `timesOrdered`.
- Возврат: с API (requestReturn) и без API (ручная заявка).

## Acceptance

- [ ] `order_item` расширен снапшотом; `productId` nullable.
- [ ] `supplier_order` создаётся по партнёрам; частичный успех → `PARTIALLY_PLACED`.
- [ ] `POST /orders` делает финальную перепроверку и размещает у партнёров.
- [ ] Refresh-status по кнопке, retry, returns (полуавтомат) работают.
- [ ] `partner_products` upsert из заказов; `GET /api/partner-products` для менеджера.
- [ ] История иммутабельна; деактивация партнёра не ломает старые заказы.
- [ ] Swagger покрывает orders/analytics; README обновлён.

## Заметки по worktree/мёржу

- Касание `app.module.ts`: добавить `SupplierOrder`, `PartnerProduct` в entities;
  модули заказов/аналитики.
- Шов с Spec B — только `CartService.getCheckoutItems()`. До мёржа B кодить против
  локального стаба контракта, при сборке заменить на реальный импорт.
