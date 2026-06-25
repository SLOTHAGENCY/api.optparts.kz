# Spec 0 — Foundation: Suppliers Core + Pricing + API-инфра

**Дата:** 2026-06-24
**Зависит от:** —
**Блокирует:** Spec A (Search), Spec B (Cart), Spec C (Orders)
**Worktree:** `foundation` — **мёржится первым**, остальные ветвятся от него.
**Umbrella-дизайн:** [2026-06-24-multi-supplier-aggregator-design.md](./2026-06-24-multi-supplier-aggregator-design.md)

## Цель

Заложить общий фундамент агрегатора: единый контракт коннектора поставщика, реестр
провайдеров, конфиг партнёров, сервис наценки, перенос Rossko на новый контракт и
инфраструктуру Swagger. Все остальные спеки кодят против интерфейсов из этой спеки.

## Scope

### 1. Модуль `suppliers/`

- `suppliers/types.ts` — общие нормализованные типы (экспортируются всем):
  ```ts
  interface SupplierOffer {
    supplierCode: string; article: string; brand: string; name: string;
    costPrice: number; count: number; deliveryDays: number; multiplicity: number;
    warehouseId: string; isAnalog: boolean; raw: Record<string, unknown>;
  }
  interface PlaceOrderItem { article: string; brand: string; warehouseId: string;
    quantity: number; raw: Record<string, unknown>; }
  interface SupplierOrderResult { externalOrderId: string | null;
    status: SupplierOrderStatusValue; errorMessage?: string; }
  type SupplierOrderStatusValue =
    'NEW'|'PLACED'|'FAILED'|'CONFIRMED'|'SHIPPED'|'DELIVERED'|'CANCELLED';
  interface ReturnItem { externalOrderId: string; article: string; quantity: number; }
  interface ReturnResult { returnStatus: 'REQUESTED'|'IN_PROGRESS'|'DONE'|'REJECTED';
    externalReturnId?: string; errorMessage?: string; }
  ```
- `suppliers/supplier-connector.interface.ts`:
  ```ts
  interface SupplierConnector {
    readonly code: string;
    readonly name: string;
    search(article: string, brand?: string): Promise<SupplierOffer[]>;
    placeOrder(items: PlaceOrderItem[]): Promise<SupplierOrderResult>;
    getOrderStatus(externalOrderId: string): Promise<SupplierOrderStatusValue>;
    requestReturn(externalOrderId: string, items: ReturnItem[]): Promise<ReturnResult>;
  }
  ```
- DI-токен `SUPPLIERS` (массив `SupplierConnector`).
- `SuppliersRegistry`:
  - `getActive(): SupplierConnector[]` — только включённые (по `suppliers.isActive`).
  - `getByCode(code): SupplierConnector` — бросает, если нет/выключен.
- `SuppliersService` — CRUD конфига партнёров (таблица `suppliers`): список, обновить
  `isActive`/`markupPercent`/`config`.
- Контроллер `/api/suppliers` (роль ADMIN): `GET /api/suppliers`,
  `PATCH /api/suppliers/:code` (isActive, markupPercent, config).

### 2. Сущность + миграция `suppliers`

```
suppliers:
  id            uuid pk
  code          varchar unique
  name          varchar
  isActive      boolean default true
  markupPercent decimal(6,2) null
  config        jsonb default '{}'
  createdAt / updatedAt
```
Сид-запись для Rossko (`code='rossko'`) — в миграции или отдельном сидере.

### 3. Модуль `pricing/`

- `PricingService.applyMarkup(costPrice: number, supplierCode: string): number`
  - markup = `suppliers.markupPercent` партнёра, иначе `DEFAULT_MARKUP_PERCENT` (`.env`).
  - `sellPrice = Math.round(costPrice * (1 + markup/100))` (до целого тенге).
  - Кэшировать конфиг партнёров в памяти на короткий TTL допустимо для скорости (не
    обязательно).
- Экспортируется для Search и Cart.

### 4. Rossko connector

- Перенести логику текущего `src/rossko/rossko.service.ts` в
  `suppliers/connectors/rossko/rossko.connector.ts`, реализующий `SupplierConnector`.
- `search()` — существующий SOAP-вызов + парсинг, маппинг в `SupplierOffer[]`
  (точные + аналоги через `crosses`, проставить `isAnalog`).
- `placeOrder()` / `getOrderStatus()` / `requestReturn()` — реализовать по API Rossko;
  если какой-то метод недоступен — бросать `NotImplementedException` с понятным
  сообщением (заказ тогда уходит в ручную обработку — детально в Spec C).
- Ключи (`ROSSKO_KEY1/2`, `ROSSKO_DELIVERY_ID`, `ROSSKO_ADDRESS_ID`, `ROSSKO_API_URL`)
  остаются в `.env`.
- Старый `src/rossko/*` пометить deprecated; удаление — отдельной задачей, не здесь
  (чтобы не ломать текущие ссылки до завершения всех спек).

### 5. `MockConnector` (для тестов всех спек)

- `suppliers/connectors/mock/mock.connector.ts` — управляемый коннектор: задаём, какие
  офферы вернуть, эмулируем таймаут/ошибку/частичный сбой. Экспортировать для
  переиспользования в тестах Search/Cart/Orders.

### 6. API-инфра: Swagger

- Добавить зависимость `@nestjs/swagger`.
- В `main.ts` поднять `SwaggerModule` (`DocumentBuilder`: title, version, bearer-auth).
- Согласовать с текущим `src/docs/` модулем: генерируемый OpenAPI отдаём по `/api/docs`
  (заменяя/дополняя руками написанный `openapi.yaml`). Зафиксировать единый путь.
- Аннотировать контроллер `/api/suppliers` и его DTO (`@ApiTags`, `@ApiOperation`,
  `@ApiProperty`) как образец для остальных спек.

## Регистрация

- `SuppliersModule` экспортирует `SuppliersRegistry`, `SuppliersService`, токен
  `SUPPLIERS`. `PricingModule` экспортирует `PricingService`.
- Зарегистрировать оба модуля и сущность `Supplier` в `app.module.ts` (entities array
  + imports).

## Документация (обязательно в этой спеке)

- README: новый раздел «Поставщики (агрегатор)» — что такое коннектор, как добавить
  нового партнёра (создать класс, реализовать `SupplierConnector`, добавить в провайдеры
  `SUPPLIERS`, завести запись в `suppliers`).
- Док переменных `.env`: `DEFAULT_MARKUP_PERCENT` + Rossko-ключи.
- Swagger покрывает эндпоинты `/api/suppliers`.

## Тестирование

- `PricingService`: наценка партнёра, фоллбэк на дефолт, округление.
- `SuppliersRegistry`: getActive фильтрует по isActive; getByCode бросает на выключенном.
- Rossko connector: парсинг офферов и аналогов на фикстуре XML (взять из текущего
  поведения).
- `MockConnector`: контрактный тест на соответствие интерфейсу.

## Acceptance

- [ ] `SupplierConnector`, типы, реестр, токен `SUPPLIERS` экспортируются.
- [ ] Таблица `suppliers` + миграция + сид Rossko.
- [ ] `PricingService.applyMarkup` работает и покрыт тестами.
- [ ] Rossko доступен как коннектор через реестр; старый модуль не удалён, но не мешает.
- [ ] `MockConnector` доступен для других спек.
- [ ] `/api/suppliers` (ADMIN) — список и редактирование isActive/markupPercent.
- [ ] Swagger поднят, `/api/docs` отдаёт генерируемый спек, `/api/suppliers` аннотирован.
- [ ] README обновлён («как добавить партнёра»), `.env` задокументирован.

## Заметки по worktree/мёржу

- Мёржится **первым** в интеграционную ветку. A/B/C ветвятся уже от неё.
- Точки общего касания с другими спеками: `app.module.ts`, `package.json`
  (`@nestjs/swagger`), `main.ts` (Swagger). Эти изменения здесь — каноничные, остальные
  спеки только дописывают свои модули.
