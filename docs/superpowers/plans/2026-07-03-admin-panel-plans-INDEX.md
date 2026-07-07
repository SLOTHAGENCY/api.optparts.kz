# Подключение админки — индекс планов (8 worktree)

Спек: [`../specs/2026-07-03-admin-panel-integration-design.md`](../specs/2026-07-03-admin-panel-integration-design.md)

Цель: открыть `/admin` только админам/менеджерам (кнопка в шапке + защита роута + реальный вход)
и подключить все 7 вкладок к реальному backend. Работа нарезана на изолированные worktree.

## Порядок исполнения

1. **WT-0 выполняется и мержится ПЕРВЫМ.** Он создаёт общие файлы (`src/lib/api/*`,
   `AdminLayout`, `tabs/*Tab.tsx`, доступ), которые остальные ветки правят изолированно.
2. После merge WT-0 — **WT-1…7 в отдельных worktree параллельно**. Между собой во фронте
   не пересекаются (каждая владеет своими 1–2 файлами).
3. Backend-ветки WT-5/6/7 имеют единственную общую точку — `src/app.module.ts` (и WT-5 ещё
   `src/config/data-source.ts`): добавление строк в массивы `imports`/`entities`. Мержить
   последовательно, конфликт тривиальный.

## Планы

| WT | Область | Тип | Задач | Файл |
|----|---------|-----|-------|------|
| 0 | Фундамент + доступ (кнопка/гард/вход, разрез монолитов, каркас api) | front | 6 | [wt0](2026-07-03-wt0-admin-foundation-access.md) |
| 1 | Поставщики | front | 4 | [wt1](2026-07-03-wt1-suppliers.md) |
| 2 | Наценки (brand-markups) | front | 2 | [wt2](2026-07-03-wt2-markup.md) |
| 3 | Алгоритм выбора / Settings | front | 7 | [wt3](2026-07-03-wt3-settings-rules.md) |
| 4 | Заказы | front | 5 | [wt4](2026-07-03-wt4-orders.md) |
| 5 | Новости | backend+front | 11 | [wt5](2026-07-03-wt5-news.md) |
| 6 | Дашборд | backend+front | 6 | [wt6](2026-07-03-wt6-dashboard.md) |
| 7 | Логи/Мониторинг | backend+front | 6 | [wt7](2026-07-03-wt7-monitoring.md) |

## Матрица владения файлами (гарантия отсутствия конфликтов)

Общие файлы трогает ТОЛЬКО WT-0. После него:

| WT | Front API-клиент | Front-компоненты | Backend |
|----|------------------|------------------|---------|
| 1 | `src/lib/api/suppliersApi.ts` | `tabs/SuppliersTab.tsx` | — |
| 2 | `src/lib/api/pricingApi.ts` | `tabs/MarkupTab.tsx` | — |
| 3 | `src/lib/api/settingsApi.ts` | `tabs/RulesTab.tsx` | — |
| 4 | `src/lib/api/ordersAdminApi.ts` | `tabs/OrdersTab.tsx` | — |
| 5 | `src/lib/api/newsApi.ts` | `tabs/NewsTab.tsx`, `pages/NewsList.tsx`, `pages/NewsArticle.tsx`, чистка `store.ts` | новый `src/news/*` + миграция + `app.module.ts`, `config/data-source.ts` |
| 6 | `src/lib/api/dashboardApi.ts` | `tabs/DashboardTab.tsx` | новый `src/admin-stats/*` (или `src/dashboard/*`) + `app.module.ts` |
| 7 | `src/lib/api/monitoringApi.ts` | `tabs/MonitoringTab.tsx` | новый `src/monitoring/*` + `app.module.ts` |

`src/lib/api/index.ts` (barrel) заполняется реэкспортами в WT-0 заранее — параллельные ветки его НЕ трогают.

## Канонические правила (сверка после параллельной генерации)

Планы писались параллельно, поэтому зафиксировано единообразно здесь — при исполнении иметь приоритет:

1. **Путь импорта HTTP-примитивов:** `apiRequest` реэкспортится из `src/lib/api/http.ts`
   (WT-0 создаёт этот файл; он реэкспортит из `src/api.ts`). Клиенты `src/lib/api/*Api.ts`
   импортируют `import { apiRequest } from './http';`. Файла `src/lib/http.ts` НЕТ.
   → В планах WT-1…7 встречается формулировка `../http` — читать как `./http`.
2. **Тест-раннера во фронте нет** (`front/package.json`: `lint = tsc --noEmit`). «Красная/зелёная»
   фаза во фронт-планах = `npx tsc --noEmit` + ручной прогон `npm run dev`. Тест-фреймворк НЕ добавляем.
3. **Backend-тесты** — jest `*.spec.ts` по существующему паттерну (мок-репозиторий, без `TestingModule`).
4. **decimal-поля из TypeORM приходят строками** там, где нет `decimalTransformer`
   (`orders.totalAmount`, `priceAtOrder`, `subtotal`) — приводить через `Number()`/хелпер.
   Где transformer есть (`costPrice`, `sellPrice`, `brandMarkup.markupPercent`) — уже числа.

## Реальность данных backend (важно для приёмки)

- **Реально подключается** (есть эндпоинт/таблица): поставщики, наценки, settings, заказы (все действия),
  новости (новый модуль), дашборд (агрегаты по `orders`/`users` + логи `search_log`/`supplier_orders`),
  мониторинг (состояние коннекторов `suppliers` + `connector.isConfigured()` + успешность из `search_log`).
- **Без источника, честные заглушки/empty-state** (не выдумывать таблицы):
  - Дашборд: «статус очереди» → `'unknown'` (job-queue в проекте нет).
  - Мониторинг: таблица «упавших задач с конкретным поставщиком + кнопка Перезапустить» — persистентных
    логов ошибок по поставщику нет (`search_log.suppliersFailed` — только счётчик; ошибки лишь `logger.warn`).
    Показываем состояние коннекторов + агрегатную успешность, историю — empty-state. Рекомендация на будущее
    (вне scope): сущность `SupplierRequestLog`.
- Мок-блоки без backend, помеченные «остаётся статикой» до появления API: часть блоков вкладки «Наценки»
  (глобальные правила, сумма заказа), фейковые радио/склады в старом «Алгоритме выбора» — удалены/не подключаются.

## Что дальше

Исполнять по одному worktree через `superpowers:subagent-driven-development` (свежий субагент на задачу
+ ревью между задачами) или `superpowers:executing-plans`. Старт — с WT-0.
