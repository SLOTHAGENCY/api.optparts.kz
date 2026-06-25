# Дизайн: режим заказов test/prod

**Дата:** 2026-06-25
**Статус:** утверждён к реализации
**Проект:** api.optparts.kz (NestJS 10 + TypeORM + PostgreSQL, test-frontend)

## Цель

Глобальный переключатель режима оформления заказов. В **test**-режиме заказ
сохраняется в нашей системе как обычно, но **не отправляется партнёрам**
(`connector.placeOrder` не вызывается). В **prod**-режиме поведение текущее.
Переключается из админки; всё доступно по API.

## Принятые решения

1. Переключатель **глобальный**: ключ `ORDER_MODE` в `app_settings`, значения
   `'test'` | `'prod'`, **дефолт `'test'`** (безопасно — на свежем окружении заказы
   не уходят, пока явно не включат prod).
2. Тестовый заказ помечается флагом **`isTest`** на `orders` и `supplier_orders`;
   под-заказ получает `status='NEW'`, `externalOrderId=null`. (Не отдельный статус
   TEST — статус остаётся семантикой жизненного цикла.)

## 1. Настройка и поведение

- `app_settings` ключ `ORDER_MODE` (`'test'|'prod'`, дефолт `'test'`).
  `SettingsService`: добавить `ORDER_MODE` в `AppSettings`/`DEFAULTS`/`getAll()` и
  геттер `getOrderMode(): Promise<'test' | 'prod'>` (нормализует к одному из двух,
  иначе дефолт `'test'`).
- `OrdersService.create(userId, dto)`: один раз прочитать
  `const mode = await this.settings.getOrderMode();` и `const isTest = mode === 'test'`.
  - Создание `Order` + `order_item`-снапшоты — без изменений; дополнительно
    `order.isTest = isTest`.
  - Для каждой группы поставщика создаётся `supplier_order`:
    - **prod** (`isTest=false`): как сейчас — `connector.placeOrder(...)`, статус и
      `externalOrderId` из результата (см. текущий `placeSupplierOrder`).
    - **test** (`isTest=true`): `placeOrder` НЕ вызывается; под-заказ:
      `status='NEW'`, `externalOrderId=null`, `errorMessage=null`, `isTest=true`.
  - Статус заказа: в **prod** — `aggregateOrderStatus(...)` как сейчас; в **test** —
    `Order.status = OrderStatus.NEW` (агрегацию не запускаем, размещения не было).
  - Аналитика `partner_products.recordOrder(...)` и `cart.clearCart(...)` —
    выполняются в обоих режимах (заказ сохранён).
- Реализация: вынести «положить под-заказ у партнёра» так, чтобы test-ветка просто
  собирала запись `supplier_order` без сетевого вызова (например, параметр/ветка в
  `placeSupplierOrder`, либо отдельный путь в `create`).

## 2. Схема и API

- Миграция `1700000000016-AddOrderTestMode`: `ALTER TABLE "orders" ADD "isTest"
  boolean NOT NULL DEFAULT false`; `ALTER TABLE "supplier_orders" ADD "isTest"
  boolean NOT NULL DEFAULT false`. `down` — DROP обоих столбцов.
- Сущности: `Order.isTest: boolean` и `SupplierOrder.isTest: boolean` (`@Column({
  default: false })`, `@ApiProperty`).
- `UpdateSettingsDto`: поле `ORDER_MODE?: 'test' | 'prod'` (`@IsOptional()
  @IsIn(['test','prod'])`, `@ApiPropertyOptional`). `AppSettings.ORDER_MODE: 'test' |
  'prod'`.
- `isTest` присутствует в выдаче заказов (и пользователю, и менеджеру — не секрет;
  оба `withLabel`/`withLabelPublic` его сохраняют, поскольку это поле самого заказа).
- Менеджерские действия не требуют спец-обработки: refresh-status у тест-заказа
  отвалится (нет `externalOrderId`), retry неприменим (статус `NEW`, не `FAILED`).

## 3. Админ-UI (test-frontend)

- `admin/settings.html`: добавить переключатель «Режим заказов» (select `test`/`prod`)
  c биндингом из `GET /api/settings.ORDER_MODE` и отправкой в `PUT /api/settings`
  вместе с остальными полями.

## 4. Тестирование

- `SettingsService.getOrderMode()`: дефолт `'test'`; читает сохранённое `'prod'`;
  неизвестное значение → `'test'`.
- `OrdersService.create` в **test**: `connector.placeOrder` НЕ вызывается (мок-коннектор
  со счётчиком вызовов = 0); под-заказ `status='NEW'`, `externalOrderId=null`,
  `isTest=true`; `order.isTest=true`; заказ сохранён, корзина очищена.
- `OrdersService.create` в **prod**: `placeOrder` вызывается (как в текущих тестах),
  `isTest=false`.

## 5. Вне scope

- Per-supplier режим (только глобальный).
- Отдельный статус жизненного цикла TEST (используем флаг `isTest`).
- Конвертация существующих заказов / обратное «дослать в prod» тест-заказ (можно
  добавить позже как ручной retry, вне текущей задачи).
