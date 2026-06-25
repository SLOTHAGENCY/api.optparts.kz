# Дизайн: ключи партнёров в админке, авто-скип, надбавка к срокам, чистка рутов, Swagger

**Дата:** 2026-06-25
**Статус:** утверждён к реализации
**Проект:** api.optparts.kz (NestJS 10 + TypeORM + PostgreSQL, test-frontend)

## Цель

1. Настраивать API-ключи/креды партнёров из админки (а не только из `.env`).
2. Ускорить поиск: ненастроенные партнёры не опрашиваются (сейчас один зависший
   партнёр держит каждый поиск 15с).
3. Настраиваемая надбавка к срокам доставки (партнёрская + глобальный дефолт).
4. Убрать мусорные руты (`/api/parts`, старый `docs`).
5. Качественная Swagger-документация всех эндпоинтов.

Всё доступно по REST API (Swagger); `test-frontend` — только потребитель.

## Корневая причина медленного поиска (диагностика)

Замер: каждый `GET /api/search` длится ~15с = `SEARCH_TIMEOUT_MS`. `SearchService`
опрашивает всех активных партнёров через `Promise.allSettled` и ждёт самого
медленного. Настроен реально только Rossko; SHATE-M (`api.shate-m.kz`, нужен VPN)
не устанавливает соединение и висит до 15с-таймаута, Tabys/Autotrade падают.
Итог: `max(Rossko, 15с) = 15с` на каждый запрос. Лечится авто-скипом ненастроенных
партнёров (§1) + снижением дефолт-таймаута.

## 1. Ключи партнёров в БД + env fallback + авто-скип

### 1.1. Хранение
Креды хранятся в существующей колонке **`suppliers.config`** (jsonb), редактируется
через `PATCH /api/suppliers/:code`. Имена ключей внутри `config` — как в env, но без
префикса партнёра:

| Партнёр | Ключи в config |
|---|---|
| rossko | `KEY1`, `KEY2`, `DELIVERY_ID`, `ADDRESS_ID` |
| tabys | `API_KEY`, `CONTRACT_ID`, `OUTLET_ID`, `DELIVERY_TYPE` |
| shatem | `API_KEY` (или `LOGIN`+`PASSWORD`), `AGREEMENT_CODE`, `DELIVERY_ADDRESS_CODE`, `DELIVERY_TYPE` |
| autotrade | `LOGIN`, `PASSWORD`, `CONTRACT_ID`, `PAYMENT_TYPE`, `RECEIPT_TYPE` |

### 1.2. Доступ из коннекторов
- В каждый коннектор внедряется `SuppliersService`.
- Хелпер `protected async cfg(key: string, envName: string): Promise<string>` —
  возвращает `supplier.config[key]` если задано непусто, иначе `process.env[envName]`
  (**env как fallback** — текущие Rossko-ключи в `.env` продолжают работать).
- Все места в коннекторах, где сейчас читается `process.env.ROSSKO_*` /
  `process.env.TABYS_*` / `SHATE_*` / `AUTOTRADE_*`, переводятся на `cfg(...)`.
- Чтобы не дёргать БД на каждое поле, коннектор читает свой `Supplier` один раз за
  вызов (через `suppliersService.findByCode(this.code)`), затем берёт поля из `config`
  с env-фоллбэком. (Допустимо короткое кэширование в `SuppliersService`.)

### 1.3. `isConfigured()` и авто-скип
- В интерфейс `SupplierConnector` добавляется `isConfigured(): Promise<boolean>` —
  true, если все ОБЯЗАТЕЛЬНЫЕ ключи партнёра присутствуют (в config или env). Набор
  обязательных ключей — у каждого коннектора свой:
  - rossko: KEY1, KEY2, DELIVERY_ID, ADDRESS_ID
  - tabys: API_KEY, CONTRACT_ID, OUTLET_ID
  - shatem: (API_KEY ИЛИ LOGIN+PASSWORD) и AGREEMENT_CODE
  - autotrade: LOGIN, PASSWORD
- `SuppliersRegistry.getActive()` теперь возвращает коннекторы где
  `supplier.isActive === true` **И** `await connector.isConfigured() === true`.
  Ненастроенный/без-VPN партнёр не опрашивается → нет зависаний.
- Дефолт `SEARCH_TIMEOUT_MS`: 15000 → **8000** (env-переопределяемо) как страховка.

## 2. Надбавка к срокам доставки

- Новая колонка **`suppliers.deliveryBufferDays`** (int, nullable). Новый ключ
  `app_settings` **`DELIVERY_BUFFER_DAYS`** (number, дефолт 0).
- Эффективная надбавка партнёра = `supplier.deliveryBufferDays ?? settings.DELIVERY_BUFFER_DAYS ?? 0`.
- Применяется при сборке оффера в `SearchService`:
  `deliveryDays = offerDeliveryDays + buffer`. И в живой перепроверке корзины
  (`CartService.recheckItem`), чтобы сроки были консистентны.
- Реализация: добавить в `SettingsService` `getDeliveryBufferDays()`; функцию
  применения надбавки держать в одной точке (helper, потребляемый search и cart).

## 3. Удаление мусорных рутов

- **Удалить `src/rossko/`** целиком (`rossko.controller.ts`, `rossko.service.ts`,
  `rossko.module.ts`) и убрать `RosskoModule` из `app.module.ts` imports. Это старый
  `/api/parts/search` — дубль `/api/search`; рабочая логика Rossko живёт в
  `src/suppliers/connectors/rossko/`.
- **Удалить `src/docs/`** целиком (`docs.controller.ts`, `docs.module.ts`,
  `openapi.yaml`) и убрать `DocsModule` из imports. Заменён генерируемым Swagger на
  `/api/docs` (настроен в `main.ts`).
- Каталог `products`/`categories`/`brands` — **ОСТАЁТСЯ** (как просил пользователь).
- После удаления: `grep` на отсутствие ссылок, `npm run build` + `npm test` зелёные.

## 4. Качественный Swagger + админ-UI

### 4.1. Swagger
Пройтись по всем оставшимся контроллерам и DTO:
- `@ApiTags(<группа>)` на каждом контроллере. Группы: `auth`, `search`, `cart`,
  `orders`, `suppliers`, `settings`, `analytics` (partner-products), `addresses`,
  `catalog` (products/categories/brands).
- `@ApiOperation({ summary })` на каждом методе; `@ApiBearerAuth()` на защищённых
  контроллерах; `@ApiResponse`/`@ApiOkResponse`/`@ApiResponse({status})` для значимых
  кодов (200/201/400/401/403/404/409).
- `@ApiProperty`/`@ApiPropertyOptional` на всех полях входных и выходных DTO
  (где их ещё нет). Публичные руты — `@ApiOperation` с пометкой «public»; роль-гейты
  отражать в summary/description.
- `DocumentBuilder` в `main.ts`: добавить title/description/version и bearer-схему
  (если ещё не полная).

### 4.2. Админ-UI (test-frontend)
- `PATCH /api/suppliers/:code` DTO расширяется: `config?: Record<string, unknown>`
  (уже есть) и `deliveryBufferDays?: number` (новое). `SuppliersService.update`
  персистит оба.
- `PUT /api/settings`: добавить `DELIVERY_BUFFER_DAYS`.
- `admin/suppliers.html`: на строку партнёра добавить редактирование `config`
  (textarea с JSON) и поле `deliveryBufferDays` («+дней»). Сохранение — существующий
  PATCH.
- `admin/settings.html`: добавить поле `DELIVERY_BUFFER_DAYS`.
- Безопасность: config с секретами отдаётся только ADMIN-эндпоинтом `GET /api/suppliers`
  (он уже `@Roles(ADMIN)`); клиентам ключи нигде не утекают.

## 5. Тестирование

- `isConfigured()` каждого коннектора: true при наличии обязательных ключей (config или
  env), false без них (юнит-тест с подменой config/env).
- `SuppliersRegistry.getActive()`: исключает активного, но ненастроенного партнёра.
- `cfg()`-фоллбэк: config приоритетнее env; env при пустом config.
- Надбавка к сроку: `deliveryDays = partner + buffer`, приоритет supplier над глобальным,
  0 при отсутствии (юнит-тест на helper, в search и cart).
- Settings: `getDeliveryBufferDays()` дефолт 0; PATCH suppliers персистит config +
  deliveryBufferDays.
- После удаления rossko/docs: build + полный прогон зелёные, нет битых импортов.

## 6. Вне scope

- Шифрование секретов в БД (хранятся как jsonb-текст, как и сейчас в .env). Отдельная
  задача при необходимости.
- Удаление каталога products/categories/brands (оставлен намеренно).
- Авто-курс валют, cron-поллинг статусов (как и раньше — вне scope).

## 7. Этапы (укрупнённо)

1. Connector config + `cfg()` + `isConfigured()` + registry авто-скип + таймаут 8с.
2. Delivery buffer: колонка + setting + helper, применение в search и cart.
3. Suppliers/Settings DTO + service (config, deliveryBufferDays, DELIVERY_BUFFER_DAYS).
4. Удаление `src/rossko/` и `src/docs/` + чистка app.module.
5. Swagger-аннотации по всем контроллерам/DTO.
6. Админ-UI: config + deliveryBufferDays на suppliers, DELIVERY_BUFFER_DAYS на settings.
