# Фронтенд: полное подключение к каталогам (parts-catalogs + PartsIndex + поставщики)

**Дата:** 2026-07-01
**Статус:** дизайн на согласовании
**Проект фронта:** `/home/mans/projects/Dana/front` (React 19 + Vite 6 + React Router 7 (HashRouter) + Zustand + Tailwind 4)
**Бэкенд:** `api.optparts.kz`, база `https://api.optparts.kz`, префикс `/api`

## 1. Цель и объём

Заменить **все моки** фронта на реальные данные бэкенда и довести UX до референса
[kz.alta-karter.com](https://kz.alta-karter.com/): единый умный поиск, категорийная
витрина, подбор по VIN с деревом узлов и взрыв-схемами, карточка детали с
аналогами/применяемостью/ценами, рабочая корзина и оформление заказа.

**Принцип:** ничего не выдумываем — все категории/авто/узлы/аналоги приходят из API.
Удаляются `ALL_CATEGORIES`, `CAR_BRANDS`, `TOYOTA_MODELS`, `products`, дефолтное
избранное и мок-корзина.

**Решения (приняты):** данные — **@tanstack/react-query**; роутинг — **читаемые пути**
(как у alta-karter).

## 2. Бэкенд-контракт (что уже готово)

Публичные (без авторизации), кроме корзины/заказов (нужен JWT):

| Эндпоинт | Назначение |
|---|---|
| `GET /api/search/global?query=&catalogs=&lang=` | Умный поиск: `mode` = `vin`\|`article`\|`name` |
| `GET /api/search?article=&brand=&…фильтры` | Живые офферы поставщиков (существующий) |
| `GET /api/parts/brands?code=` | Бренды по артикулу |
| `GET /api/parts/card?code=&brand=&lang=` | Карточка: имя/фото/параметры/аналоги/применяемость/офферы |
| `GET /api/parts/analogs?code=&brand=&types=all` (или `id=`) | Аналоги/кроссы |
| `GET /api/parts/applicability?code=&brand=` | Применяемость |
| `GET /api/catalog/categories` | Реальные категории |
| `GET /api/catalog/categories/:catalogId/groups` | Дерево узлов категории |
| `GET /api/catalog/categories/:catalogId/params?groupId=&generationId=&engineId=&filters=&q=` | Фасеты |
| `GET /api/catalog/categories/:catalogId/suggest?groupId=&q=` | Автодополнение |
| `GET /api/catalog/categories/:catalogId/products?groupId=&generationId=&engineId=&filters=&q=&page=&limit=` | Товары (пагинация) |
| `GET /api/catalog/car/brands?q=` · `.../:brandId/models` · `.../models/:modelId/generations` · `.../generations/:generationId/engines` | Дерево авто |
| `GET /api/oem/catalogs` · `.../:id/models` · `.../:id/cars?modelId=&parameter=&page=` · `.../:id/car-parameters?modelId=` | OEM: марки/модели/авто/фильтры |
| `GET /api/oem/vin?q=&catalogs=` · `GET /api/oem/vin/validate?vin=` | Подбор по VIN/FRAME |
| `GET /api/oem/catalogs/:id/groups?carId=&groupId=&criteria=` | Дерево узлов авто |
| `GET /api/oem/catalogs/:id/parts?carId=&groupId=&criteria=` | Детали узла + схема + хот-споты `{x,y,h,w}` |
| `POST /api/cart/items` (auth) | Добавить оффер в корзину (снимок) |
| `GET /api/cart` · `PUT /api/cart/items/:id` · `DELETE /api/cart/items/:id` · `DELETE /api/cart` (auth) | Корзина |
| `POST /api/orders` (auth) `{deliveryType, addressId?}` | Оформить заказ (позиции из корзины) |

**Ключевой контракт «оффер → корзина»:** оффер из `search` содержит
`{ offerId, supplierCode, sellPrice, deliveryDays, count, multiplicity, warehouseId, raw }`,
группа — `{ article, brand, name }`. Для добавления в корзину фронт **echo-ит** оффер в
`POST /api/cart/items`:
```
{ supplierCode, article, brand, productName: group.name, sellPrice, warehouseId, raw, quantity }
```
`raw` возвращается без изменений — сервер по нему оформляет заказ.

## 3. Архитектура фронта

### 3.1 Слой данных
- Добавить `@tanstack/react-query`; обернуть приложение в `QueryClientProvider` (в `App.tsx`).
- Расширить `src/api.ts` типизированными модулями клиентов (используют существующий `apiRequest`):
  `searchApi`, `partsApi`, `catalogApi`, `oemApi`, `cartApi`, `ordersApi`.
- Каждой группе — хуки в `src/hooks/` (`useGlobalSearch`, `useCategories`, `useCatalogGroups`,
  `useCatalogProducts`, `useCarTree`, `useVinLookup`, `useOemGroups`, `useOemParts`,
  `useProductCard`, `useAnalogs`, `useCart`, `useCreateOrder`).
- Кэш React Query: `staleTime` 5 мин для справочников (категории/дерево авто), 1 мин для
  товаров/карточек; это дополнительно **бережёт квоту провайдеров** (бэкенд тоже кэширует 24 ч).

### 3.2 Типы
`src/types/catalog.ts` — TS-типы, зеркалящие DTO бэкенда (Category, GroupNode, Facet,
CatalogProduct/Products, CarBrand/Model/Generation/Engine, PartBrand, ProductCard, PartAnalog,
PartApplicability, OemCatalog/Model/Car/Group/Parts/Position, VinCar, GlobalSearchResult,
SearchResponse/Offer, Cart). Источник истины — Swagger (`/api/docs`).

### 3.3 Роутинг (читаемые пути, HashRouter)
| Экран | Путь |
|---|---|
| Главная | `/` |
| Результаты поиска (article/name) | `/search?query=` |
| Категория (витрина) | `/catalog` (список категорий) |
| Категория → узел/товары | `/catalog/:catalogId` (+ query `groupId,generationId,engineId,filters,page`) |
| Сужение по авто | те же query-параметры (`brandId/modelId/generationId/engineId`) |
| Карточка детали | `/parts/:brand/:code` |
| Аналоги | `/parts/:brand/:code/analogs` |
| Подбор по VIN | `/vin` (форма) → `/vin/:q` (результаты) |
| OEM: авто → узлы | `/oem/:catalogId/car/:carId` (+ `groupId,criteria`) |
| OEM: детали узла (схема) | тот же экран, панель деталей по `groupId` |
| Корзина / оформление / успех | `/cart` · `/checkout` · `/success` |

`react-router-dom` v7: перевести спорные места на вложенные роуты; сохранить HashRouter.

## 4. API-клиенты (сигнатуры в `src/api.ts`)

```ts
export const searchApi = {
  global: (query: string, opts?: { catalogs?: string; lang?: string }) =>
    apiRequest<GlobalSearchResult>(`/api/search/global?query=${encodeURIComponent(query)}${opts?.catalogs ? `&catalogs=${opts.catalogs}` : ''}`),
  offers: (article: string, brand?: string, filters?: SearchFilters) =>
    apiRequest<SearchResponse>(`/api/search?article=${encodeURIComponent(article)}${brand ? `&brand=${encodeURIComponent(brand)}` : ''}${buildFilterQuery(filters)}`),
};
export const partsApi = {
  brands: (code: string) => apiRequest<PartBrand[]>(`/api/parts/brands?code=${encodeURIComponent(code)}`),
  card: (code: string, brand?: string, lang?: string) => apiRequest<ProductCard>(`/api/parts/card?code=${encodeURIComponent(code)}${brand ? `&brand=${encodeURIComponent(brand)}` : ''}${lang ? `&lang=${lang}` : ''}`),
  analogs: (p: { code?: string; brand?: string; id?: string; types?: string }) => apiRequest<PartAnalog[]>(`/api/parts/analogs?${qs(p)}`),
  applicability: (code: string, brand: string, lang?: string) => apiRequest<PartApplicability[]>(`/api/parts/applicability?code=${encodeURIComponent(code)}&brand=${encodeURIComponent(brand)}${lang ? `&lang=${lang}` : ''}`),
};
export const catalogApi = {
  categories: (lang?: string) => apiRequest<Category[]>(`/api/catalog/categories${lang ? `?lang=${lang}` : ''}`),
  groups: (catalogId: string, lang?: string) => apiRequest<GroupNode[]>(`/api/catalog/categories/${catalogId}/groups${lang ? `?lang=${lang}` : ''}`),
  params: (catalogId: string, q: CatalogScopeQuery) => apiRequest<Facet[]>(`/api/catalog/categories/${catalogId}/params?${qs(q)}`),
  suggest: (catalogId: string, groupId: string, q: string) => apiRequest<string[]>(`/api/catalog/categories/${catalogId}/suggest?groupId=${groupId}&q=${encodeURIComponent(q)}`),
  products: (catalogId: string, q: CatalogScopeQuery & { page?: number; limit?: number }) => apiRequest<CatalogProducts>(`/api/catalog/categories/${catalogId}/products?${qs(q)}`),
  carBrands: (q?: string) => apiRequest<CarBrand[]>(`/api/catalog/car/brands${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  carModels: (brandId: string) => apiRequest<CarModel[]>(`/api/catalog/car/brands/${brandId}/models`),
  carGenerations: (brandId: string, modelId: string) => apiRequest<CarGeneration[]>(`/api/catalog/car/brands/${brandId}/models/${modelId}/generations`),
  carEngines: (brandId: string, modelId: string, generationId: string) => apiRequest<CarEngine[]>(`/api/catalog/car/brands/${brandId}/models/${modelId}/generations/${generationId}/engines`),
};
export const oemApi = {
  catalogs: (lang?: string) => apiRequest<OemCatalog[]>(`/api/oem/catalogs${lang ? `?lang=${lang}` : ''}`),
  models: (catalogId: string) => apiRequest<OemModel[]>(`/api/oem/catalogs/${catalogId}/models`),
  cars: (catalogId: string, modelId: string, page?: number, parameter?: string) => apiRequest<{ items: OemCar[]; total: number | null }>(`/api/oem/catalogs/${catalogId}/cars?modelId=${modelId}${page ? `&page=${page}` : ''}${parameter ? `&parameter=${parameter}` : ''}`),
  carParameters: (catalogId: string, modelId: string) => apiRequest<OemCarParameter[]>(`/api/oem/catalogs/${catalogId}/car-parameters?modelId=${modelId}`),
  vin: (q: string, catalogs?: string) => apiRequest<VinCar[]>(`/api/oem/vin?q=${encodeURIComponent(q)}${catalogs ? `&catalogs=${catalogs}` : ''}`),
  vinValidate: (vin: string) => apiRequest<VinValidation | null>(`/api/oem/vin/validate?vin=${encodeURIComponent(vin)}`),
  groups: (catalogId: string, carId: string, groupId?: string, criteria?: string) => apiRequest<OemGroup[]>(`/api/oem/catalogs/${catalogId}/groups?carId=${carId}${groupId ? `&groupId=${groupId}` : ''}${criteria ? `&criteria=${encodeURIComponent(criteria)}` : ''}`),
  parts: (catalogId: string, carId: string, groupId: string, criteria?: string) => apiRequest<OemParts>(`/api/oem/catalogs/${catalogId}/parts?carId=${carId}&groupId=${groupId}${criteria ? `&criteria=${encodeURIComponent(criteria)}` : ''}`),
};
export const cartApi = {
  get: (token: string) => apiRequest<Cart>('/api/cart', { token }),
  addItem: (token: string, item: AddToCartBody) => apiRequest<Cart>('/api/cart/items', { method: 'POST', token, body: item }),
  updateItem: (token: string, itemId: string, quantity: number) => apiRequest<Cart>(`/api/cart/items/${itemId}`, { method: 'PUT', token, body: { quantity } }),
  removeItem: (token: string, itemId: string) => apiRequest<Cart>(`/api/cart/items/${itemId}`, { method: 'DELETE', token }),
  clear: (token: string) => apiRequest<Cart>('/api/cart', { method: 'DELETE', token }),
};
export const ordersApi = {
  create: (token: string, body: { deliveryType: 'delivery' | 'pickup'; addressId?: string }) => apiRequest<Order>('/api/orders', { method: 'POST', token, body }),
  list: (token: string) => apiRequest<Order[]>('/api/orders', { token }),
  get: (token: string, id: string) => apiRequest<Order>(`/api/orders/${id}`, { token }),
};
```
`qs()` — хелпер сериализации query (пропуская undefined; `filters` — JSON.stringify объекта `{paramId: value}`).

## 5. Экраны (постранично)

### 5.1 Header — единый поиск
- `handleSearch` → `navigate('/search?query=' + q)` (сейчас ведёт в `/catalog?search=`).
- На `/search` вызывается `searchApi.global(q)`; по `mode`:
  - `vin` → `redirect` на `/vin/:q` (или сразу рендер найденных авто);
  - `article` → секции «Товары» (офферы) + «Бренды» (чипы для уточнения) + ссылки на карточки;
  - `name` → секция «Категории» (чипы/карточки категорий → `/catalog/:catalogId`).
- Плейсхолдер оставить: «по названию, артикулу, OEM-номеру или VIN».

### 5.2 Home
- Удалить импорт `ALL_CATEGORIES`, `products`. Левый сайдбар и блок «Каталог» — из `catalogApi.categories()`.
- Hero-поиск шлёт в `/search`. Блок «Лента новостей» — оставить как есть (моки новостей вне скоупа этой интеграции; помечено в §9).

### 5.3 Search results (новый экран `/search`)
- `useGlobalSearch(query)`; рендер по `mode` (см. 5.1). Для `article`: карточки офферов
  (бренд, артикул, `name`, цена `sellPrice`, срок, наличие `count`, «в корзину»); фасет «бренд»
  из `article.brands`. Пустой результат — понятный empty-state.

### 5.4 Каталог (категория → авто → узел → товары) `/catalog`, `/catalog/:catalogId`
- `/catalog`: сетка реальных категорий (`catalogApi.categories`).
- `/catalog/:catalogId`: дерево узлов (`catalogApi.groups`) + фасеты (`catalogApi.params`) +
  сетка товаров (`catalogApi.products`, пагинация). Сужение по авто — цепочка селекторов
  из `catalogApi.carBrands/carModels/carGenerations/carEngines`, значения кладутся в query
  (`generationId`,`engineId`) и передаются в `params`/`products`.
- Фильтры-фасеты (`Facet.type=select|range`) → чекбоксы/диапазон; выбранное сериализуется в
  `filters` (JSON) и уходит в `products`/`params`.
- Товар в сетке ведёт на `/parts/:brand/:code`.

### 5.5 Подбор по VIN / OEM `/vin`, `/oem/:catalogId/car/:carId`
- `/vin`: поле VIN. По submit — `oemApi.vinValidate` (показать нормализацию/ошибки), затем
  `oemApi.vin(q)` → список найденных авто (`VinCar`); выбор → `/oem/:catalogId/car/:carId?criteria=`.
- Экран авто: **дерево узлов** (`oemApi.groups`, drill по `groupId` пока `hasParts=false`),
  при `hasParts=true` — панель `oemApi.parts`: изображение узла + **хот-споты**
  (`positions[].{x,y,h,w}` → кликабельные абсолютные оверлеи, синхронизированы со списком
  деталей). Клик по OEM-детали (`number`) → карточка `/parts/:oemBrand/:number` (бренд из авто/детали).
- Также «каталог по авто без VIN»: `oemApi.catalogs → models → cars` (сужение через `car-parameters`).

### 5.6 Карточка детали `/parts/:brand/:code` (замена `ProductDetails`)
- `useProductCard(code, brand)` → `partsApi.card`. Показать: фото (`images`, через
  `resolveApiAssetUrl`), название/бренд, характеристики (`parameters[].items`), описание,
  штрихкоды, **аналоги** (`analogs` → ссылки `/parts/:brand/:code`), **применяемость**
  (`applicability`, сгруппировать по марке), и блок покупки из `offers` (цена/наличие/срок,
  выбор поставщика, «в корзину»).
- Роут `/product/:id` удаляется; `ProductCard` ведёт на `/parts/:brand/:code`.

### 5.7 Аналоги `/parts/:brand/:code/analogs`
- `partsApi.analogs({code, brand, types:'all'})` — список с брендами; фасет «бренд».
  (Соответствует `/poisk` alta-karter.)

### 5.8 Корзина / Checkout / Success (реальный бэкенд)
- `Cart.tsx`: убрать мок; `useCart()` → `cartApi.get` (требует auth — если не залогинен,
  предложить вход). Изменение/удаление — `cartApi.updateItem/removeItem`. Добавление из
  офферов (search/card) — `cartApi.addItem` с телом-снимком (см. §2).
- `Checkout.tsx`: выбор `deliveryType` (`delivery|pickup`) и `addressId` (из `addressesApi` —
  уже есть в бэкенде `/api/addresses`); `ordersApi.create`. Позиции берутся сервером из корзины.
- `Success`/`OrderDetails`: `ordersApi.get`.
- **Гость vs авторизация:** каталог/поиск/карточка — публичные; корзина/заказ — только для
  залогиненных (иначе редирект на `/auth`). Локальную корзину-гостя не делаем (YAGNI).

### 5.9 Избранное
- Оставить как есть (локальный Zustand `favorites`), но убрать дефолтный мок-товар
  (`favorites: [products[0]]` → `[]`) и хранить `{brand, code, name, image}` вместо `Product`.

## 6. Что удаляем (моки)
- `src/data/categories.ts` (`ALL_CATEGORIES`, `CAR_BRANDS`, `TOYOTA_MODELS`, `TOYOTA_YEARS`).
- `src/data/products.ts` (`products`, тип `Product` заменяется реальными типами).
- Мок-корзина в `Cart.tsx`; дефолтное избранное в `store.ts`.
- Ссылки вида `/catalog?category=Тормоза` (маркетинговые категории) — заменяются реальными `catalogId`.
- `ProductCard`/`ProductDetails` переводятся на реальные типы (бренд+код вместо `id`).

## 7. Кросс-срезы
- **Изображения:** провайдерские URL абсолютны (в т.ч. `//img…` бэкенд уже нормализует в `https`);
  `resolveApiAssetUrl` — только для относительных путей своего API.
- **Loading/empty/error:** каждый экран — скелет/спиннер, понятный empty-state (в т.ч. когда
  офферы пусты или PartsIndex недоступен — карточка всё равно рендерится с тем, что есть).
- **Деградация:** карточка/поиск не падают, если один источник вернул пусто (бэкенд уже
  деградирует независимо).
- **i18n:** параметр `lang` (`ru` по умолчанию) прокидывать в каталожные запросы.

## 8. Env фронта
- `.env` фронта: `VITE_API_BASE_URL=https://api.optparts.kz` (уже дефолт в `api.ts`).
- Для локальной разработки против локального бэкенда: `VITE_API_BASE_URL=http://localhost:3000`.

## 9. Тестирование
- На фронте сейчас нет тестового раннера. Минимально: добавить Vitest + React Testing Library
  для хуков API-клиентов (мок `fetch`) и рендера ключевых экранов (search router, product card).
  Полноценное покрытие — вне скоупа; приоритет — smoke по каждому экрану вручную против бэкенда.
- Проверка сборки: `npm run lint` (tsc --noEmit) и `npm run build`.

## 10. Разбивка на воркти (фронт)
- **FE-1 `fe-core`**: React Query provider, `src/api.ts` модули, `src/types/catalog.ts`, `qs()`,
  каркас роутов. Зависимостей нет.
- **FE-2 `fe-search`**: Header → `/search`, экран результатов (article/name/vin routing). Зависит от FE-1.
- **FE-3 `fe-catalog`**: `/catalog`, `/catalog/:catalogId` (дерево/фасеты/товары/сужение по авто). FE-1.
- **FE-4 `fe-oem-vin`**: `/vin`, экран авто с деревом узлов и взрыв-схемой (хот-споты). FE-1.
- **FE-5 `fe-product`**: карточка `/parts/:brand/:code` + аналоги. FE-1.
- **FE-6 `fe-cart-order`**: корзина/checkout/orders на реальном бэкенде + добавление офферов. FE-1 (+ контракт из FE-2/5).
Порядок: FE-1 → (FE-2…FE-5 параллельно) → FE-6.

## 11. Открытые вопросы / риски
- **Квоты тест-ключей** (PartsIndex 1000 до 11.07): при разработке фронта беречь запросы —
  React Query staleTime + бэкенд-кэш; не делать поллинг фасетов на каждый тик.
- **Нестабильные OEM `carId`** — не сохранять в закладки/URL как вечные; при переоткрытии
  переподбирать по VIN. VIN/номер — можно хранить.
- **Категорийная витрина ≠ маркетинговые категории alta-karter**: показываем реальные
  категории PartsIndex; «защита картера/фаркопы» отсутствуют — не имитируем.
- **HashRouter + читаемые пути**: пути живут после `#` (`/#/catalog/oils`) — для SEO это
  ограничение текущего роутера; смена на BrowserRouter — отдельное решение (вне скоупа).
- **Новости/`Admin`** — остаются на текущей реализации; их бэкенд-подключение вне этой спеки.
