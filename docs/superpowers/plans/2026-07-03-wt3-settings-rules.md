# WT-3 — Вкладка «Алгоритм выбора» (Правила/Settings) → backend `/settings`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task in the current session. Each `### Task N` is one bite-sized red→green→commit cycle. Do NOT batch tasks. Do NOT write implementation code before its failing check exists. After every task run the verification command and paste its real output before claiming success (superpowers:verification-before-completion).

## Goal

Подключить админ-вкладку «Алгоритм выбора» (в мок-версии — `renderRules`, после WT-0 — компонент `RulesTab`) к реальному backend `/settings`. Форма должна читать `GET /api/settings`, показывать все 5 глобальных настроек в редактируемых полях (включая `FX_RATES` как редактируемый список «валюта → курс»), и сохранять частичный патч через `PUT /api/settings`. Мок-поля, которых нет в backend (радио «приоритет цены/времени», drag&drop складов, чекбоксы отсева), **удаляются** — у backend их нет, оставлять фейковый UI нельзя.

## Architecture

- **Владение ветки (менять только это):**
  - `front/src/lib/api/settingsApi.ts` — в WT-0 это заглушка `export const settingsApi = {}`. WT-3 наполняет её: тип `AppSettings`, тип патча `UpdateSettingsInput`, методы `get`/`update`.
  - `front/src/pages/admin/tabs/RulesTab.tsx` — в WT-0 это перенесённый из `Admin.tsx` мок. WT-3 переписывает содержимое на реальную форму.
- **Не трогать:** `front/src/lib/api/index.ts` (уже реэкспортит `settingsApi`), `front/src/lib/http.ts` (создан в WT-0, экспортит `apiRequest`), `front/src/authStore.ts`, `front/src/api.ts`.
- **Поток данных:** `@tanstack/react-query`. `useQuery` тянет настройки, `useMutation` шлёт патч и инвалидирует кэш. Токен — `useAuthStore(s => s.accessToken)`, передаётся в `settingsApi.get(token)` / `settingsApi.update(token, patch)`.
- **HTTP:** только через `apiRequest<T>(path, { token, body, method })`. Импорт внутри `settingsApi.ts`: `import { apiRequest } from '../http';`. RulesTab HTTP напрямую не делает — только через `settingsApi`.

### Backend-контракт (из реального кода, не переопределять)

Из `api.optparts.kz/src/settings/settings.service.ts` (`interface AppSettings`) и `dto/update-settings.dto.ts`:

```ts
// GET /api/settings → AppSettings (все поля присутствуют, backend подставляет DEFAULTS)
interface AppSettings {
  DEFAULT_MARKUP_PERCENT: number;        // >= 0, дефолт 20
  FX_RATES: Record<string, number>;      // валюта → тенге за 1 ед., дефолт { KZT: 1 }
  FX_BUFFER_PERCENT: number;             // >= 0, дефолт 0
  DELIVERY_BUFFER_DAYS: number;          // >= 0, дефолт 0
  ORDER_MODE: 'test' | 'prod';           // дефолт 'test'
}
```

`PUT /api/settings` принимает **частичный** патч (`UpdateSettingsDto`, все поля `@IsOptional`), любое подмножество тех же ключей, и возвращает обновлённый полный `AppSettings`. Валидация backend: `DEFAULT_MARKUP_PERCENT` / `FX_BUFFER_PERCENT` / `DELIVERY_BUFFER_DAYS` — `@IsNumber @Min(0)`; `FX_RATES` — `@IsObject`; `ORDER_MODE` — `@IsIn(['test','prod'])`. Только `@Roles(ADMIN)` — нужен Bearer-токен админа.

## Tech Stack

React 19, TypeScript ~5.8, Vite 6, @tanstack/react-query ^5.101, zustand ^5, lucide-react, Tailwind v4. **Тест-раннер отсутствует** (в `front/package.json` нет jest/vitest/@testing-library; единственный скрипт-проверка — `"lint": "tsc --noEmit"`). **Фреймворк тестирования НЕ добавляем** (вне scope ветки и репозитория). Вместо runtime-тестов «красная фаза» = провальная компиляция `npx tsc --noEmit`, «зелёная» = чистый `tsc` + ручная проверка в `npm run dev`.

## Global Constraints

- Фронт: `/home/mans/projects/Dana/front`. Префикс `/api`, base `https://api.optparts.kz`.
- HTTP только через `apiRequest<T>(path, { token, body, method })`, импорт `import { apiRequest } from '../http';`.
- Ветка владеет: `src/lib/api/settingsApi.ts` (в WT-0 `export const settingsApi = {}`) и `src/pages/admin/tabs/RulesTab.tsx`. `index.ts` уже реэкспортит `settingsApi` — не трогать.
- Данные через @tanstack/react-query. Токен: `useAuthStore(s => s.accessToken)`.
- Эндпоинты: `GET /api/settings` → `AppSettings`; `PUT /api/settings` (тело — частичный патч `UpdateSettingsDto`) → обновлённые `AppSettings`.

## Verification commands (нет тест-раннера)

- Компиляция: `cd /home/mans/projects/Dana/front && npx tsc --noEmit` (эквивалент `npm run lint`).
- Ручной прогон: `cd /home/mans/projects/Dana/front && npm run dev` → открыть админку, вкладку «Алгоритм выбора», проверить загрузку/редактирование/сохранение против прод-бэка.
- Каждую «красную» фазу подтверждаем реальным выводом `tsc` с ошибкой; каждую «зелёную» — реальным выводом `tsc` без ошибок.

---

### Task 1 — Тип `AppSettings` + `UpdateSettingsInput` в `settingsApi.ts` (контракт данных)

**Files:** `front/src/lib/api/settingsApi.ts`

**Interfaces (точно из backend):**
```ts
export interface AppSettings {
  DEFAULT_MARKUP_PERCENT: number;
  FX_RATES: Record<string, number>;
  FX_BUFFER_PERCENT: number;
  DELIVERY_BUFFER_DAYS: number;
  ORDER_MODE: 'test' | 'prod';
}
export type UpdateSettingsInput = Partial<AppSettings>;
```

Шаги (TDD, адаптировано под `tsc`):
- [ ] Красная фаза: в конце `settingsApi.ts` временно добавить строку-проверку контракта, ссылающуюся на ещё не объявленные типы:
      `const __assertShape: AppSettings = { DEFAULT_MARKUP_PERCENT: 0, FX_RATES: {}, FX_BUFFER_PERCENT: 0, DELIVERY_BUFFER_DAYS: 0, ORDER_MODE: 'test' };`
      (типов `AppSettings`/`UpdateSettingsInput` пока нет).
- [ ] Прогнать `npx tsc --noEmit` — убедиться, что падает с `Cannot find name 'AppSettings'`. Вставить реальный вывод ошибки.
- [ ] Реализация: объявить `export interface AppSettings { ... }` (ровно 5 полей выше) и `export type UpdateSettingsInput = Partial<AppSettings>;`. Оставить заглушку `export const settingsApi = {};` пока без методов.
- [ ] Прогнать `npx tsc --noEmit` — зелёно. Вставить вывод. Затем удалить временную строку `__assertShape` (она свою роль сыграла) и снова прогнать `tsc` — зелёно.
- [ ] Commit: `feat(front/settings): add AppSettings + UpdateSettingsInput types`.

---

### Task 2 — `settingsApi.get` / `settingsApi.update` (HTTP-клиент)

**Files:** `front/src/lib/api/settingsApi.ts`

**Interfaces (точные сигнатуры):**
```ts
export const settingsApi = {
  get: (token: string) =>
    apiRequest<AppSettings>('/api/settings', { token }),
  update: (token: string, patch: UpdateSettingsInput) =>
    apiRequest<AppSettings>('/api/settings', { method: 'PUT', token, body: patch }),
};
```
(GET использует дефолтный метод `apiRequest` — как `cartApi.get` в `front/src/api.ts`; PUT шлёт частичный патч телом.)

Шаги:
- [ ] Красная фаза: добавить в начало файла `import { apiRequest } from '../http';`, а в конец — временную проверку сигнатур, которая опирается на ещё-не-реализованные методы:
      `const _g: Promise<AppSettings> = settingsApi.get('t'); const _u: Promise<AppSettings> = settingsApi.update('t', { ORDER_MODE: 'prod' });`
      При заглушке `settingsApi = {}` это не компилируется.
- [ ] `npx tsc --noEmit` — падает (`Property 'get' does not exist on type '{}'`). Вставить вывод.
- [ ] Реализация: заменить `export const settingsApi = {};` на объект с методами `get`/`update` по сигнатурам выше.
- [ ] `npx tsc --noEmit` — зелёно. Вставить вывод. Удалить временные `_g`/`_u`, снова `tsc` — зелёно.
- [ ] Проверить, что `import { settingsApi } from '../lib/api'` (через реэкспорт `index.ts`) резолвится: временно добавить такую строку в любой уже существующий admin-модуль? — нет, `index.ts` не трогаем и лишние файлы не создаём; вместо этого убедиться командой `cd /home/mans/projects/Dana/front && node -e "0"` не нужно. Достаточно, что `index.ts` уже реэкспортит `settingsApi`; глобальный `tsc` покроет реэкспорт.
- [ ] Commit: `feat(front/settings): settingsApi.get/update via apiRequest`.

---

### Task 3 — Каркас `RulesTab`: загрузка через react-query + состояния

**Files:** `front/src/pages/admin/tabs/RulesTab.tsx`

**Interfaces:**
```ts
export const RulesTab: React.FC = () => { ... }
```
Внутри:
```ts
const token = useAuthStore((s) => s.accessToken);
const { data, isLoading, isError, error } = useQuery({
  queryKey: ['settings'],
  queryFn: () => settingsApi.get(token as string),
  enabled: Boolean(token),
});
```
Импорты: `import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';`, `import { settingsApi, type AppSettings, type UpdateSettingsInput } from '../../../lib/api';`, `import { useAuthStore } from '../../../authStore';` (путь от `src/pages/admin/tabs/` до `src/authStore.ts` — три уровня вверх), `import { Save, Plus, Trash2 } from 'lucide-react';`.

Шаги:
- [ ] Красная фаза: заменить старый мок-JSX (радио/drag&drop/чекбоксы) на минимальный каркас, который рендерит `isLoading` → «Загрузка…», `isError` → текст ошибки (`getApiErrorMessage(error)` из `../../../api` — он экспортится там; либо `(error as Error).message`), иначе `<pre>{JSON.stringify(data)}</pre>` как временную заглушку тела. Убедиться, что импорты `settingsApi`/типы подхватываются.
- [ ] `npx tsc --noEmit` — если путь импорта/типы кривые, падает; исправить до зелёного. Вставить вывод (сначала красный, если был, потом зелёный).
- [ ] Ручной прогон `npm run dev`: открыть вкладку «Алгоритм выбора» под админом → увидеть JSON текущих настроек (или экран загрузки/ошибки при отсутствии токена). Отметить результат.
- [ ] Commit: `feat(front/settings): RulesTab loads settings via react-query`.

---

### Task 4 — Форма 4 скалярных полей + `ORDER_MODE`, локальный стейт от загруженных данных

**Files:** `front/src/pages/admin/tabs/RulesTab.tsx`

Заменить `<pre>`-заглушку на форму. Локальная модель формы (инициализируется из `data`, синхронизируется при загрузке через `useEffect`/`useState`):
```ts
const [form, setForm] = useState<AppSettings | null>(null);
useEffect(() => { if (data) setForm(data); }, [data]);
```
Поля формы (все 5 настроек; `FX_RATES` — в Task 5):
- **DEFAULT_MARKUP_PERCENT** — `<input type="number" min={0}>`, подпись «Наценка по умолчанию, %».
- **FX_BUFFER_PERCENT** — `<input type="number" min={0}>`, подпись «Буфер к курсу валют, %».
- **DELIVERY_BUFFER_DAYS** — `<input type="number" min={0}>`, подпись «Буфер к сроку доставки, дней».
- **ORDER_MODE** — `<select>` c опциями `test` («Тестовый — заказы не уходят поставщикам») / `prod` («Боевой»).

Числовые onChange: `Number(e.target.value)`; пустую строку трактовать как `0` (чтобы поле не давало `NaN`). Значения `< 0` не допускать (`min={0}` + клэмп в onChange `Math.max(0, ...)`), т.к. backend `@Min(0)`.

Шаги:
- [ ] Красная фаза: добавить `form`-стейт и разметку 4 полей, привязать `value`/`onChange`. Если ссылаешься на `form.DEFAULT_MARKUP_PERCENT` без null-guard — `tsc` под `strict` укажет на возможный `null`; это ожидаемая ошибка. Вставить вывод.
- [ ] Реализация: отрендерить блок только при `form` != null (`if (!form) return <Загрузка/>` после хуков), убрать null-ошибки.
- [ ] `npx tsc --noEmit` — зелёно. Вставить вывод.
- [ ] `npm run dev`: значения полей совпадают с backend; правка числовых/селекта меняет локальный стейт (проверить, что нельзя ввести отрицательное). Отметить.
- [ ] Commit: `feat(front/settings): scalar + ORDER_MODE fields bound to form state`.

---

### Task 5 — Редактируемый список `FX_RATES` (валюта → курс)

**Files:** `front/src/pages/admin/tabs/RulesTab.tsx`

Представление: `FX_RATES` (`Record<string, number>`) в UI — массив строк `{ code: string; rate: number }`. Конвертация из `form.FX_RATES` при инициализации и обратно в `Record` при сохранении.
Возможности блока «Курсы валют»:
- Список строк: `<input>` код валюты (uppercase, напр. `USD`) + `<input type="number" min={0}>` курс + кнопка удаления строки (`Trash2`).
- Кнопка «Добавить валюту» (`Plus`) — добавляет пустую строку `{ code: '', rate: 0 }`.
- Изменение code/rate обновляет соответствующую строку локального массива.

Сериализация обратно в патч: `Object.fromEntries(rows.filter(r => r.code.trim()).map(r => [r.code.trim().toUpperCase(), Number(r.rate) || 0]))`. Пустые коды отбрасываются; дубликаты кодов схлопываются (последний выигрывает — приемлемо).

Хранение строк: отдельный стейт `const [fxRows, setFxRows] = useState<{ code: string; rate: number }[]>([])`, синхронизируемый из `data` тем же `useEffect`, что и `form` (`Object.entries(data.FX_RATES).map(([code, rate]) => ({ code, rate }))`).

Шаги:
- [ ] Красная фаза: добавить `fxRows`-стейт, синхронизацию из `data`, и разметку списка с add/remove/edit. Любую типовую нестыковку (например, `rate` как строка) `tsc` поймает. Вставить вывод.
- [ ] Реализация: довести типы до `{ code: string; rate: number }`, обработчики `addRow`/`removeRow(i)`/`updateRow(i, patch)`.
- [ ] `npx tsc --noEmit` — зелёно. Вставить вывод.
- [ ] `npm run dev`: строки FX_RATES отображаются из backend (минимум `KZT: 1`), можно добавить/удалить/изменить. Отметить.
- [ ] Commit: `feat(front/settings): editable FX_RATES currency→rate list`.

---

### Task 6 — Сохранение через `useMutation` (`PUT`), инвалидация, статусы

**Files:** `front/src/pages/admin/tabs/RulesTab.tsx`

**Interfaces:**
```ts
const qc = useQueryClient();
const mutation = useMutation({
  mutationFn: (patch: UpdateSettingsInput) => settingsApi.update(token as string, patch),
  onSuccess: (updated) => {
    qc.setQueryData(['settings'], updated); // сервер вернул полный AppSettings
  },
});
```
Сборка патча из формы при сабмите (шлём **полный** набор ключей — backend принимает и полный объект как частный случай патча):
```ts
const patch: UpdateSettingsInput = {
  DEFAULT_MARKUP_PERCENT: form.DEFAULT_MARKUP_PERCENT,
  FX_BUFFER_PERCENT: form.FX_BUFFER_PERCENT,
  DELIVERY_BUFFER_DAYS: form.DELIVERY_BUFFER_DAYS,
  ORDER_MODE: form.ORDER_MODE,
  FX_RATES: serializeFxRows(fxRows),
};
mutation.mutate(patch);
```
UI: кнопка «Сохранить правила» (`Save`) — `disabled={mutation.isPending || !form}`; текст «Сохранение…» при `isPending`; сообщение об успехе (`mutation.isSuccess`) и об ошибке (`mutation.isError` → `getApiErrorMessage(mutation.error)`).

Шаги:
- [ ] Красная фаза: подключить `useMutation`/`useQueryClient`, обработчик сабмита формы, кнопку с состояниями. Ошибки типов (`token` возможно `null`, тип патча) `tsc` подсветит. Вставить вывод.
- [ ] Реализация: `serializeFxRows` (из Task 5), guard `if (!token || !form) return;` в submit, привязка disabled/статусов.
- [ ] `npx tsc --noEmit` — зелёно. Вставить вывод.
- [ ] `npm run dev`: изменить наценку/режим/добавить валюту → «Сохранить» → успех, значения перечитаны (`setQueryData`), при повторном открытии вкладки видны сохранённые данные. Проверить, что ошибка бэка (например, без токена/403) показывается текстом. Отметить.
- [ ] Commit: `feat(front/settings): save settings patch via PUT + statuses`.

---

### Task 7 — Полировка: заголовки/подписи, удаление остатков мока, финальная проверка

**Files:** `front/src/pages/admin/tabs/RulesTab.tsx`

- [ ] Убедиться, что не осталось ни одного мок-элемента (радио «приоритет», drag&drop складов, чекбоксы отсева) — их backend не поддерживает, они удалены.
- [ ] Заголовок секции сохранить в стиле мока (`<h2 class="text-[18px] font-bold ... border-l-4 border-orange-500 pl-3">Алгоритм выбора</h2>`), поля в карточке `bg-white border border-slate-200 rounded-lg p-6 max-w-3xl` (визуальная согласованность с остальной админкой).
- [ ] Каждое поле снабдить понятной русской подписью и краткой подсказкой смысла (наценка/буфер курса/буфер срока/режим заказов/курсы валют) — на основе описаний из `UpdateSettingsDto`.
- [ ] Финальный прогон: `cd /home/mans/projects/Dana/front && npx tsc --noEmit` — зелёно (вставить вывод), затем `npm run dev` — полный сценарий load→edit→save→reload. Отметить результат.
- [ ] Commit: `feat(front/settings): finalize Rules/Settings tab wiring`.

---

## Self-Review

- [ ] **Ownership соблюдён:** менялись только `front/src/lib/api/settingsApi.ts` и `front/src/pages/admin/tabs/RulesTab.tsx`. `index.ts`, `lib/http.ts`, `authStore.ts`, `api.ts` не тронуты. Новых файлов не создавалось.
- [ ] **HTTP-контракт:** все запросы идут через `apiRequest<T>` c импортом `from '../http'` внутри `settingsApi.ts`; RulesTab обращается к сети только через `settingsApi`. Пути ровно `/api/settings` (GET/PUT).
- [ ] **Типы соответствуют backend:** `AppSettings` = 5 полей из `settings.service.ts` (`DEFAULT_MARKUP_PERCENT`, `FX_RATES`, `FX_BUFFER_PERCENT`, `DELIVERY_BUFFER_DAYS`, `ORDER_MODE`); патч = `Partial<AppSettings>`, совместим с `UpdateSettingsDto` (`@IsOptional`, `@Min(0)`, `@IsIn(['test','prod'])`).
- [ ] **Все 5 настроек в форме:** три числовых, селект режима, редактируемый список FX_RATES с add/remove/edit. Отрицательные числа не проходят (`min=0` + клэмп), совпадает с `@Min(0)`.
- [ ] **react-query:** `useQuery(['settings'])` для чтения, `useMutation` для записи, кэш обновляется ответом сервера (`setQueryData`). Токен из `useAuthStore(s => s.accessToken)`, `enabled: Boolean(token)`.
- [ ] **Нет тест-раннера:** проверки через `npx tsc --noEmit` + `npm run dev`; фреймворк тестирования НЕ добавлялся (явно зафиксировано). Каждая задача прошла red(tsc-fail)→green(tsc-clean)→ручной прогон→commit.
- [ ] **Никаких плейсхолдеров/фейкового UI:** удалены все мок-поля, которых нет в backend; каждое оставшееся поле реально пишется в `/settings`.
- [ ] **Ошибки видимы пользователю:** состояния загрузки/ошибки чтения и сохранения (в т.ч. 403 без прав) показываются текстом.
