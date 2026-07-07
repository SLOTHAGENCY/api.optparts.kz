# Подключение админ-панели — дизайн

Дата: 2026-07-03
Репозитории: `api.optparts.kz` (backend, NestJS) + `front` (React/Vite, отдельный git-репозиторий на уровень выше)

## Цель

Превратить макет админки (`front/src/pages/Admin.tsx`, ~831 строка, почти полностью на моках)
в рабочую панель, подключённую к реальному backend, и открыть к ней доступ только
пользователям с ролью `admin`/`manager`:

- В шапке сайта у админа появляется кнопка «Админка» → переход в панель.
- Роут `/admin` защищён (не-админов редиректит).
- Вход в панель — через реальную авторизацию, а не фейковый сабмит.
- Все семь вкладок подключены к реальным данным.

## Что уже есть (проверено)

**Backend (RBAC полностью готов):**
- `UserRole` = `user | manager | admin` (`src/users/entities/user.entity.ts`).
- `@Roles(...)` декоратор + `RolesGuard` (`src/auth/`).
- `AuthUser` во фронте уже содержит `roles: string[]` (`front/src/api.ts`).

**Backend-эндпоинты по вкладкам:**

| Вкладка (фронт) | Эндпоинты | Гард |
|---|---|---|
| Поставщики и API | `GET /suppliers`, `PATCH /suppliers/:code` | `@Roles(ADMIN)` |
| Правила наценок | `GET/PUT /pricing/brand-markups`, `DELETE /pricing/brand-markups/:brand` | `@Roles(ADMIN)` |
| Алгоритм выбора | `GET/PUT /settings` (`DEFAULT_MARKUP_PERCENT`, `FX_RATES`, `FX_BUFFER_PERCENT`, `DELIVERY_BUFFER_DAYS`, `ORDER_MODE`) | `@Roles(ADMIN)` |
| Заказы | `GET /orders/all`, `GET /orders/:id`, `PATCH /orders/:id/status`, комменты (`PUT/DELETE /orders/:id/comment`), `POST /orders/:id/suppliers/:sid/{refresh-status,retry,return}` | `@Roles(ADMIN, MANAGER)` |
| Новости | — нет | нужен новый модуль |
| Дашборд | — нет | нужен новый эндпоинт |
| Логи и Мониторинг | — нет | нужен новый эндпоинт |

**Фронт (`front/src/api.ts`):** есть `authApi`, `searchApi`, `partsApi`, `catalogApi`,
`oemApi`, `cartApi`, `ordersApi` (только `create/list/get`), `addressesApi`.
Админских клиентов нет вообще.

## Решения по «пробелам» (утверждено пользователем)

Новости, Дашборд и Мониторинг подключаются **по-настоящему** — с новыми backend-эндпоинтами.
Никаких моков в финале не остаётся.

## Стратегия параллельного выполнения (git worktree)

Два монолита создают конфликты при параллельном merge:
- `front/src/pages/Admin.tsx` — все вкладки в одном файле.
- `front/src/api.ts` — все API-клиенты в одном файле.

Поэтому: **сначала одна фундаментная ветка разрезает монолиты и мержится первой**, затем
широкий параллельный фан-аут, где каждая ветка владеет своим файлом вкладки + своим файлом
API-клиента и не трогает общих файлов.

```
WT-0 (foundation) ──merge──> [ WT-1 WT-2 WT-3 WT-4 WT-5 WT-6 WT-7 ] параллельно
```

### Правило владения файлами (чтобы не было конфликтов)
- Общие файлы (`App.tsx`, `Header.tsx`, `api.ts`, `AdminLayout.tsx`, `lib/api/index.ts`)
  трогает **только WT-0**.
- После WT-0 каждая вкладка = отдельный файл `tabs/XxxTab.tsx` + отдельный клиент
  `lib/api/xxxApi.ts`. Импорты подключаются через уже созданные в WT-0 barrel-файлы
  (`lib/api/index.ts` реэкспортит всё — но каждая ветка добавляет строку в свой клиент,
  а не в index; index заполняется реэкспортами в WT-0 заранее под все имена).

> Примечание: чтобы даже `lib/api/index.ts` не стал точкой конфликта, WT-0 сразу прописывает
> в нём реэкспорты всех будущих клиентов (`export * from './suppliersApi'` и т.д.), а пустые
> файлы-клиенты создаёт с заглушкой. Тогда параллельные ветки правят только тело своего файла.

---

## WT-0 — Фундамент и доступ (выполняется первым, мержится до остальных)

**Репозиторий:** `front` (+ ничего в backend).

**Задачи:**
1. **Хелпер ролей.** `front/src/authStore.ts` (или новый `front/src/lib/roles.ts`):
   `isAdmin(user)` → `user?.roles?.some(r => r === 'admin' || r === 'manager')`.
2. **Кнопка «Админка» в шапке.** `front/src/components/Header.tsx`: в блоке Actions и в
   мобильном меню добавить `Link to="/admin"` с иконкой (`LayoutDashboard` из lucide),
   рендерить только при `isAdmin(authUser)`.
3. **Реальный вход.** `front/src/pages/AdminAuth.tsx`: заменить `navigate('/admin')` на
   `useAuthStore().login()`, при успехе и `isAdmin` → `/admin`, иначе показать ошибку
   «Недостаточно прав».
4. **Защита роута.** `front/src/App.tsx`: компонент `RequireAdmin` (проверяет
   `isAuthInitialized` → `isAdmin`), обёртка вокруг `/admin`. Не-админ → редирект на
   `/admin/login`. Учесть `fetchCurrentUser()` на старте, чтобы не мигал редирект.
5. **Разрезать `Admin.tsx`:**
   - `front/src/pages/admin/AdminLayout.tsx` — сайдбар, шапка панели, переключение вкладок,
     общий state (`activeTab`).
   - `front/src/pages/admin/tabs/{Dashboard,Orders,News,Suppliers,Markup,Rules,Monitoring}Tab.tsx`
     — переносятся **как есть, с текущими моками**. Проект компилируется и работает.
   - `front/src/pages/Admin.tsx` становится тонкой обёрткой над `AdminLayout` (или App
     импортирует `AdminLayout` напрямую).
6. **Каркас API:** `front/src/lib/api/` с `http.ts` (реэкспорт `apiRequest`/типов из `api.ts`),
   пустыми клиентами (`suppliersApi.ts`, `pricingApi.ts`, `settingsApi.ts`, `ordersAdminApi.ts`,
   `newsApi.ts`, `dashboardApi.ts`, `monitoringApi.ts` — каждый со скелетом-объектом) и
   `index.ts` с реэкспортами всех.

**Критерий готовности:** сборка зелёная, кнопка видна только админу, `/admin` защищён,
все вкладки открываются (пока на моках).

---

## Параллельный фан-аут (после merge WT-0)

Каждая ветка: подключить свой API-клиент и переписать свою вкладку на реальные данные
(React Query через существующий `queryClient`). Токен берётся из `useAuthStore`.

### WT-1 — Поставщики (front)
- `lib/api/suppliersApi.ts`: `list()` → `GET /suppliers`; `update(code, dto)` → `PATCH /suppliers/:code`.
- `tabs/SuppliersTab.tsx`: список из API, форма редактирования → PATCH, инвалидация кэша.

### WT-2 — Наценки (front)
- `lib/api/pricingApi.ts`: `list/upsert/remove` для `/pricing/brand-markups`.
- `tabs/MarkupTab.tsx`: таблица наценок по брендам, добавление/изменение/удаление.

### WT-3 — Алгоритм выбора / Settings (front)
- `lib/api/settingsApi.ts`: `get()` / `update(patch)` для `/settings`.
- `tabs/RulesTab.tsx`: форма — `DEFAULT_MARKUP_PERCENT`, `FX_RATES`, `FX_BUFFER_PERCENT`,
  `DELIVERY_BUFFER_DAYS`, `ORDER_MODE`.

### WT-4 — Заказы (front)
- `lib/api/ordersAdminApi.ts`: `listAll()` → `GET /orders/all`; `get`, `setStatus`,
  `comment`/`deleteComment`, `refreshSupplier`/`retrySupplier`/`returnSupplier`.
- `tabs/OrdersTab.tsx`: список всех заказов, детальный просмотр, смена статуса, действия
  по поставщикам.

### WT-5 — Новости (backend + front)
- **backend:** новый модуль `news` — entity (`id, title, body, coverImage?, publishedAt,
  createdAt, updatedAt`), контроллер: `GET /news` (публичный, для витрины),
  `GET /news/:id`, `POST/PUT/DELETE /news` под `@Roles(ADMIN, MANAGER)`; миграция таблицы.
- **front:** `lib/api/newsApi.ts` + `tabs/NewsTab.tsx` — заменить `useStore` (localStorage)
  на API. Публичные страницы `NewsList.tsx`/`NewsArticle.tsx` тоже перевести на `newsApi`
  (в рамках этой же ветки, т.к. они логически связаны с моделью новостей).

### WT-6 — Дашборд (backend + front)
- **backend:** `GET /admin/stats` (или `/dashboard`) под `@Roles(ADMIN, MANAGER)` —
  агрегаты: заказы за сегодня и сумма, кол-во ошибок интеграций, общая успешность запросов,
  топ-метрики. Источник — таблицы orders + логи поставщиков.
- **front:** `lib/api/dashboardApi.ts` + `tabs/DashboardTab.tsx` — заменить захардкоженные
  цифры на данные эндпоинта.

### WT-7 — Логи и Мониторинг (backend + front)
- **backend:** `GET /admin/logs` (или `/monitoring`) под `@Roles(ADMIN, MANAGER)` —
  статус коннекторов поставщиков, последние ошибки интеграций, аптайм/успешность.
  Определить источник (существующие логи запросов к поставщикам).
- **front:** `tabs/MonitoringTab.tsx` — подключить к эндпоинту (клиент `monitoringApi.ts`).

---

## Зависимости и порядок

1. **WT-0 обязателен первым** и мержится до старта остальных (создаёт файлы, которые
   параллельные ветки правят изолированно).
2. WT-1..7 — независимы между собой, выполняются в отдельных worktree параллельно.
3. WT-5/6/7 добавляют backend-код в `api.optparts.kz`; между собой они трогают разные модули
   (`news`, stats-эндпоинт, logs-эндпоинт) — конфликтов нет, кроме, возможно, `app.module.ts`
   (регистрация модулей) — разрешается тривиально при merge.

## Тестирование

- Backend: unit-тесты новых сервисов (news CRUD, stats-агрегация) в стиле существующих
  `*.service.spec.ts`; контроллеры покрыть проверкой ролей (как `search.service.history.spec.ts`).
- Front: ручная проверка каждой вкладки на реальном API; проверить, что не-админ не видит
  кнопку и получает редирект с `/admin`.
- Регрессия доступа: пользователь с ролью `user` → нет кнопки, `/admin` недоступен;
  `manager`/`admin` → доступ есть.

## Открытые вопросы (уточнить при реализации)

- Точный источник данных для stats/logs (WT-6/WT-7) — какие таблицы/логи коннекторов
  доступны для агрегации.
- Нужны ли новостям изображения/загрузка файлов (переиспользовать механизм `uploadProfileImage`?).
