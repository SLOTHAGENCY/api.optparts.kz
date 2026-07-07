# WT-1: Поставщики (Suppliers) — фронт → реальный backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan. Work task-by-task, TDD-style; do not batch tasks. This branch OWNS exactly two files — do not touch anything else.

**Goal:** Подключить вкладку админки «Поставщики и API» (`SuppliersTab`) к реальному backend: список поставщиков через `GET /api/suppliers` и сохранение настроек через `PATCH /api/suppliers/:code`. Убрать все мок-данные из вкладки.

**Architecture:** Тонкий типизированный API-клиент `suppliersApi` (в `src/lib/api/suppliersApi.ts`) поверх примитива `apiRequest` из WT-0. UI-вкладка `SuppliersTab` тянет/мутирует данные через `@tanstack/react-query` (`useQuery` для списка, `useMutation` + `invalidateQueries` для сохранения). Токен берётся из `useAuthStore`. Никакого локального состояния-источника-истины, кроме формы редактирования.

**Tech Stack:** React 19, TypeScript ~5.8 (strict-ish, `noEmit`), Vite 6, `@tanstack/react-query` ^5.101, zustand ^5 (`useAuthStore`), lucide-react (иконки), Tailwind v4 (классы уже в моке). Тест-раннера НЕТ (см. Global Constraints).

---

## Global Constraints

Скопировано из контракта WT-0 — соблюдать дословно:

- Рабочая директория фронта: `/home/mans/projects/Dana/front`. Backend-префикс: `/api`. Base URL `https://api.optparts.kz`.
- HTTP только через `apiRequest<T>(path, { token, body, method })`. Импорт примитивов: `import { apiRequest } from '../http';` (внутри `src/lib/api/`).
- Эта ветка ВЛАДЕЕТ ровно двумя файлами и правит только их тело:
  - `src/lib/api/suppliersApi.ts` (в WT-0 это `export const suppliersApi = {}`)
  - `src/pages/admin/tabs/SuppliersTab.tsx`
- Barrel `src/lib/api/index.ts` уже реэкспортит `suppliersApi` — его НЕ трогать.
- Данные тянуть через `@tanstack/react-query` (`useQuery`/`useMutation`, `queryClient` уже настроен в `src/lib/queryClient.ts`). Токен: `useAuthStore(s => s.accessToken)`.
- Эндпоинты: `GET /api/suppliers` (список), `PATCH /api/suppliers/:code` (обновить настройки поставщика).

**Дополнительные ограничения этой ветки:**

- **Тест-раннера во фронте НЕТ.** В `package.json` только `"lint": "tsc --noEmit"`; vitest/jest отсутствуют. Ставить тест-фреймворк ради этого плана ЗАПРЕЩЕНО. TDD-петля реализуется так: «красный» = провальная компиляция/временная type-assertion через `npx tsc --noEmit`, показывающая точную ошибку; «зелёный» = проходящий `npx tsc --noEmit`; поведенческая проверка = ручной прогон `npm run dev` в браузере (Task 4). Каждая временная type-assertion удаляется в том же шаге, где становится зелёной.
- Все команды запускать из `/home/mans/projects/Dana/front` (worktree фронта). Абсолютный путь указывать в каждой bash-команде.
- Depends on WT-0: должны существовать `src/lib/api/http.ts` (экспорт `apiRequest`), `src/lib/api/index.ts` (реэкспорт `suppliersApi`), `src/pages/admin/tabs/SuppliersTab.tsx` (перенесённый мок `renderSuppliers`/`renderSupplierEdit` как `export const SuppliersTab: React.FC`). Если их нет — остановиться и сообщить оркестратору (не создавать WT-0 самому).

---

## Точная модель данных (выведено из backend, НЕ выдумывать)

Источник: `api.optparts.kz/src/suppliers/entities/supplier.entity.ts` и `dto/update-supplier.dto.ts`.

**Сущность `Supplier`** (ответ `GET /api/suppliers` — массив; `PATCH` возвращает один объект). `secretsEnc` маскируется бэкендом в `'***'` если задан, иначе `null` (см. `SuppliersService.maskSecret`):

| Поле | Тип TS | Примечание |
|---|---|---|
| `id` | `string` | uuid |
| `code` | `string` | уникальный код, `:code` в PATCH-URL (напр. `rossko`) |
| `name` | `string` | **нет в UpdateSupplierDto → не редактируется через PATCH** |
| `isActive` | `boolean` | участвует ли в поиске |
| `markupPercent` | `number \| null` | decimal, `null` = наценка по умолчанию |
| `currency` | `string \| null` | ISO-4217 |
| `deliveryBufferDays` | `number \| null` | доп. дни к сроку доставки |
| `timeoutMs` | `number \| null` | per-request timeout, `null` = дефолт 15000 |
| `rateLimitRpm` | `number \| null` | лимит **запросов в минуту** (не в секунду!), `null` = без лимита |
| `secretsEnc` | `string \| null` | замаскировано `'***'` или `null`; секреты никогда не возвращаются |
| `config` | `Record<string, unknown>` | несекретные настройки; **API URL хранится в `config.API_URL`** |
| `createdAt` | `string` | ISO-дата (JSON) |
| `updatedAt` | `string` | ISO-дата (JSON) |

**`UpdateSupplierDto`** (тело `PATCH /api/suppliers/:code`) — все поля optional:

| Поле | Тип TS | Валидация backend |
|---|---|---|
| `isActive` | `boolean` | — |
| `markupPercent` | `number \| null` | Min 0, Max 1000 |
| `currency` | `string` | — |
| `config` | `Record<string, unknown>` | — |
| `deliveryBufferDays` | `number \| null` | Min 0 |
| `apiUrl` | `string` | пишется бэкендом в `config.API_URL` |
| `timeoutMs` | `number \| null` | Min 1000, Max 60000 |
| `rateLimitRpm` | `number \| null` | Min 1, Max 100000 |
| `secrets` | `Record<string, string>` | шифруется, никогда не возвращается |

**Важные выводы для UI:**
- Поля `name` НЕТ в DTO → в форме показывать read-only.
- В моке есть кнопка «Добавить поставщика» и «Политика повторов (Retry policy)» — **backend их не поддерживает** (нет POST-эндпоинта и поля retry). Кнопку добавления убрать, поле retry убрать.
- Мок пишет «Лимиты (запросов/сек)» — на самом деле backend это `rateLimitRpm` (в минуту). Подпись исправить.
- API URL в форме ↔ `apiUrl` в payload (читается из `config.API_URL` в ответе).

---

## Task 1: API-клиент `suppliersApi` (типы + list + update)

**Files:**
- Modify: `/home/mans/projects/Dana/front/src/lib/api/suppliersApi.ts` (в WT-0: `export const suppliersApi = {}`)
- Test: тест-раннера нет → проверка через `npx tsc --noEmit` (см. Global Constraints)

**Interfaces:**

Produces (экспорт из `suppliersApi.ts`):
```ts
export interface Supplier {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  markupPercent: number | null;
  currency: string | null;
  deliveryBufferDays: number | null;
  timeoutMs: number | null;
  rateLimitRpm: number | null;
  secretsEnc: string | null;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateSupplierPayload {
  isActive?: boolean;
  markupPercent?: number | null;
  currency?: string;
  config?: Record<string, unknown>;
  deliveryBufferDays?: number | null;
  apiUrl?: string;
  timeoutMs?: number | null;
  rateLimitRpm?: number | null;
  secrets?: Record<string, string>;
}

export const suppliersApi: {
  list: (token: string) => Promise<Supplier[]>;
  update: (token: string, code: string, payload: UpdateSupplierPayload) => Promise<Supplier>;
};
```

Consumes: `apiRequest<T>(path, { token, body, method })` из `../http` (WT-0).

**Шаги:**

- [ ] **(red)** Заменить тело файла на типы + временную type-assertion, которая вызывает ещё не реализованные методы. Записать в `/home/mans/projects/Dana/front/src/lib/api/suppliersApi.ts`:
  ```ts
  import { apiRequest } from '../http';

  export interface Supplier {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    markupPercent: number | null;
    currency: string | null;
    deliveryBufferDays: number | null;
    timeoutMs: number | null;
    rateLimitRpm: number | null;
    secretsEnc: string | null;
    config: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }

  export interface UpdateSupplierPayload {
    isActive?: boolean;
    markupPercent?: number | null;
    currency?: string;
    config?: Record<string, unknown>;
    deliveryBufferDays?: number | null;
    apiUrl?: string;
    timeoutMs?: number | null;
    rateLimitRpm?: number | null;
    secrets?: Record<string, string>;
  }

  // TEMP typecheck — удалить на зелёном шаге
  export const suppliersApi = {};
  const _l: Promise<Supplier[]> = suppliersApi.list('t');
  const _u: Promise<Supplier> = suppliersApi.update('t', 'rossko', { isActive: true });
  void _l; void _u;
  ```
- [ ] **(red — прогнать)** `cd /home/mans/projects/Dana/front && npx tsc --noEmit`
  Ожидаемый провал: `error TS2339: Property 'list' does not exist on type '{}'.` и `error TS2339: Property 'update' does not exist on type '{}'.`
- [ ] **(green)** Реализовать методы и убрать временную assertion. Полное финальное тело файла:
  ```ts
  import { apiRequest } from '../http';

  export interface Supplier {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    markupPercent: number | null;
    currency: string | null;
    deliveryBufferDays: number | null;
    timeoutMs: number | null;
    rateLimitRpm: number | null;
    secretsEnc: string | null;
    config: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }

  export interface UpdateSupplierPayload {
    isActive?: boolean;
    markupPercent?: number | null;
    currency?: string;
    config?: Record<string, unknown>;
    deliveryBufferDays?: number | null;
    apiUrl?: string;
    timeoutMs?: number | null;
    rateLimitRpm?: number | null;
    secrets?: Record<string, string>;
  }

  export const suppliersApi = {
    list: (token: string) =>
      apiRequest<Supplier[]>('/api/suppliers', { token }),
    update: (token: string, code: string, payload: UpdateSupplierPayload) =>
      apiRequest<Supplier>(`/api/suppliers/${code}`, {
        method: 'PATCH',
        token,
        body: payload,
      }),
  };
  ```
- [ ] **(green — прогнать)** `cd /home/mans/projects/Dana/front && npx tsc --noEmit`
  Ожидание: команда завершается без ошибок (exit 0). (Если `SuppliersTab.tsx` из WT-0 ещё содержит мок — он не импортирует `suppliersApi`, компиляция чистая.)
- [ ] **(commit)** `cd /home/mans/projects/Dana/front && git add src/lib/api/suppliersApi.ts && git commit -m "feat(admin/suppliers): typed suppliersApi.list + update client"`

---

## Task 2: `SuppliersTab` — список из `GET /api/suppliers`

**Files:**
- Modify: `/home/mans/projects/Dana/front/src/pages/admin/tabs/SuppliersTab.tsx`
- Test: `npx tsc --noEmit` + ручной прогон в Task 4

**Interfaces:**

Consumes:
```ts
import { suppliersApi } from '../../../lib/api';            // value через barrel WT-0
import type { Supplier, UpdateSupplierPayload } from '../../../lib/api/suppliersApi'; // типы напрямую (barrel может не реэкспортить типы)
import { useAuthStore } from '../../../authStore';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
```
Produces: `export const SuppliersTab: React.FC` (без пропсов).

Замечания к списку:
- Колонки: Название (`name`), API URL (`config.API_URL`), Статус (`isActive`), Действия (кнопка «редактировать» по `code`).
- Состояния: загрузка, ошибка, пустой список.
- Кнопку «Добавить поставщика» из мока УБРАТЬ (нет POST-эндпоинта).

**Шаги:**

- [ ] **(red)** Переписать `SuppliersTab.tsx`: добавить импорты, query и рендер списка. Пока БЕЗ формы редактирования (edit-view — заглушка на Task 3). Полное тело файла:
  ```tsx
  import React, { useState } from 'react';
  import { Edit } from 'lucide-react';
  import { useQuery } from '@tanstack/react-query';
  import { suppliersApi } from '../../../lib/api';
  import type { Supplier } from '../../../lib/api/suppliersApi';
  import { useAuthStore } from '../../../authStore';

  const getApiUrl = (s: Supplier): string =>
    typeof s.config?.API_URL === 'string' ? (s.config.API_URL as string) : '';

  export const SuppliersTab: React.FC = () => {
    const token = useAuthStore((s) => s.accessToken);
    const [editingCode, setEditingCode] = useState<string | null>(null);

    const suppliersQuery = useQuery({
      queryKey: ['suppliers'],
      queryFn: () => suppliersApi.list(token as string),
      enabled: Boolean(token),
    });

    // Task 3 заменит эту заглушку на форму редактирования.
    if (editingCode) {
      return (
        <div className="text-[13px] text-slate-500">
          Редактирование «{editingCode}» — в разработке.{' '}
          <button onClick={() => setEditingCode(null)} className="text-orange-500 font-bold">Назад</button>
        </div>
      );
    }

    return (
      <div>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <h2 className="text-[18px] font-bold text-slate-900 border-l-4 border-orange-500 pl-3">Поставщики</h2>
        </div>

        {suppliersQuery.isLoading && (
          <div className="text-[13px] text-slate-500 p-4">Загрузка поставщиков…</div>
        )}
        {suppliersQuery.isError && (
          <div className="text-[13px] text-red-600 p-4">Не удалось загрузить поставщиков.</div>
        )}

        {suppliersQuery.data && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
            <table className="w-full min-w-[500px] text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-4 font-bold">Название</th>
                  <th className="p-4 font-bold">API URL</th>
                  <th className="p-4 font-bold">Статус</th>
                  <th className="p-4 font-bold text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {suppliersQuery.data.map((s) => (
                  <tr key={s.code}>
                    <td className="p-4 font-bold text-slate-900">{s.name}</td>
                    <td className="p-4 text-slate-500">{getApiUrl(s) || '—'}</td>
                    <td className="p-4">
                      {s.isActive ? (
                        <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-[10px] font-bold uppercase">Активен</span>
                      ) : (
                        <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-[10px] font-bold uppercase">Неактивен</span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <button onClick={() => setEditingCode(s.code)} className="text-slate-400 hover:text-orange-500"><Edit size={16} /></button>
                    </td>
                  </tr>
                ))}
                {suppliersQuery.data.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-500">Поставщики не настроены.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };
  ```
  Примечание: перед записью убедиться, что относительный путь до `authStore` и `lib/api` от `src/pages/admin/tabs/` — это `../../../` (три уровня вверх: `tabs`→`admin`→`pages`→`src`). Если WT-0 положил файл иначе — скорректировать глубину.
- [ ] **(red/green — прогнать)** `cd /home/mans/projects/Dana/front && npx tsc --noEmit`
  Ожидание: 0 ошибок. Если есть `Cannot find module '../../../lib/api'` — проверить фактический путь файла вкладки (`find src -name SuppliersTab.tsx`) и поправить глубину `../`. Это и есть «красный→зелёный» для путей.
- [ ] **(commit)** `cd /home/mans/projects/Dana/front && git add src/pages/admin/tabs/SuppliersTab.tsx && git commit -m "feat(admin/suppliers): render real supplier list via useQuery"`

---

## Task 3: `SuppliersTab` — форма редактирования + `PATCH`

**Files:**
- Modify: `/home/mans/projects/Dana/front/src/pages/admin/tabs/SuppliersTab.tsx`
- Test: `npx tsc --noEmit` + ручной прогон в Task 4

**Interfaces:**

Consumes: `suppliersApi.update(token, code, payload: UpdateSupplierPayload)`, `useMutation`, `useQueryClient`.

Маппинг поле формы → payload (`UpdateSupplierPayload`):

| Поле формы | Ключ payload | Тип / правило |
|---|---|---|
| Название | — | read-only (нет в DTO) |
| Код | — | read-only |
| API URL | `apiUrl` | string; пусто → не отправлять |
| Наценка % | `markupPercent` | `number \| null`; пусто → `null` |
| Валюта | `currency` | string; пусто → не отправлять |
| Лимит (запросов/мин) | `rateLimitRpm` | `number \| null`; пусто → `null` |
| Таймаут (мс) | `timeoutMs` | `number \| null`; пусто → `null` |
| Доп. дни доставки | `deliveryBufferDays` | `number \| null`; пусто → `null` |
| API-ключи (JSON) | `secrets` | пусто или `'***'` → не отправлять; иначе `JSON.parse` → `Record<string,string>` |
| Активен | `isActive` | boolean |

**Шаги:**

- [ ] **(red)** Полностью переписать `SuppliersTab.tsx`, заменив заглушку edit-view на реальную форму. Полное тело файла:
  ```tsx
  import React, { useState } from 'react';
  import { ArrowLeft, Edit, Save } from 'lucide-react';
  import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
  import { suppliersApi } from '../../../lib/api';
  import type { Supplier, UpdateSupplierPayload } from '../../../lib/api/suppliersApi';
  import { useAuthStore } from '../../../authStore';

  const getApiUrl = (s: Supplier): string =>
    typeof s.config?.API_URL === 'string' ? (s.config.API_URL as string) : '';

  const numOrNull = (v: string): number | null => {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isNaN(n) ? null : n;
  };

  interface EditFormState {
    apiUrl: string;
    markupPercent: string;
    currency: string;
    rateLimitRpm: string;
    timeoutMs: string;
    deliveryBufferDays: string;
    secrets: string;
    isActive: boolean;
  }

  const toFormState = (s: Supplier): EditFormState => ({
    apiUrl: getApiUrl(s),
    markupPercent: s.markupPercent == null ? '' : String(s.markupPercent),
    currency: s.currency ?? '',
    rateLimitRpm: s.rateLimitRpm == null ? '' : String(s.rateLimitRpm),
    timeoutMs: s.timeoutMs == null ? '' : String(s.timeoutMs),
    deliveryBufferDays: s.deliveryBufferDays == null ? '' : String(s.deliveryBufferDays),
    secrets: s.secretsEnc === '***' ? '***' : '',
    isActive: s.isActive,
  });

  export const SuppliersTab: React.FC = () => {
    const token = useAuthStore((s) => s.accessToken);
    const queryClient = useQueryClient();
    const [editingCode, setEditingCode] = useState<string | null>(null);
    const [form, setForm] = useState<EditFormState | null>(null);
    const [secretsError, setSecretsError] = useState<string | null>(null);

    const suppliersQuery = useQuery({
      queryKey: ['suppliers'],
      queryFn: () => suppliersApi.list(token as string),
      enabled: Boolean(token),
    });

    const updateMutation = useMutation({
      mutationFn: (vars: { code: string; payload: UpdateSupplierPayload }) =>
        suppliersApi.update(token as string, vars.code, vars.payload),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['suppliers'] });
        setEditingCode(null);
        setForm(null);
      },
    });

    const startEdit = (s: Supplier) => {
      setSecretsError(null);
      setEditingCode(s.code);
      setForm(toFormState(s));
    };

    const cancelEdit = () => {
      setEditingCode(null);
      setForm(null);
      setSecretsError(null);
    };

    const buildPayload = (f: EditFormState): UpdateSupplierPayload | null => {
      const payload: UpdateSupplierPayload = {
        isActive: f.isActive,
        markupPercent: numOrNull(f.markupPercent),
        rateLimitRpm: numOrNull(f.rateLimitRpm),
        timeoutMs: numOrNull(f.timeoutMs),
        deliveryBufferDays: numOrNull(f.deliveryBufferDays),
      };
      if (f.apiUrl.trim() !== '') payload.apiUrl = f.apiUrl.trim();
      if (f.currency.trim() !== '') payload.currency = f.currency.trim();
      const rawSecrets = f.secrets.trim();
      if (rawSecrets !== '' && rawSecrets !== '***') {
        try {
          const parsed = JSON.parse(rawSecrets) as Record<string, string>;
          payload.secrets = parsed;
        } catch {
          setSecretsError('API-ключи должны быть валидным JSON-объектом, напр. {"API_KEY":"..."}');
          return null;
        }
      }
      return payload;
    };

    const submit = () => {
      if (!editingCode || !form) return;
      setSecretsError(null);
      const payload = buildPayload(form);
      if (!payload) return;
      updateMutation.mutate({ code: editingCode, payload });
    };

    // ---- EDIT VIEW ----
    if (editingCode && form) {
      const editing = suppliersQuery.data?.find((s) => s.code === editingCode);
      return (
        <div>
          <div className="flex items-center gap-4 mb-6">
            <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-900"><ArrowLeft size={20} /></button>
            <h2 className="text-[18px] font-bold text-slate-900 border-l-4 border-orange-500 pl-3">Редактирование поставщика</h2>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-6 max-w-2xl">
            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-bold text-slate-700 mb-1">Название поставщика</label>
                <input type="text" value={editing?.name ?? ''} readOnly className="w-full border border-slate-200 rounded p-2.5 bg-slate-50 text-slate-500 text-[14px]" />
              </div>
              <div>
                <label className="block text-[13px] font-bold text-slate-700 mb-1">Код</label>
                <input type="text" value={editingCode} readOnly className="w-full border border-slate-200 rounded p-2.5 bg-slate-50 text-slate-500 text-[14px] font-mono" />
              </div>
              <div>
                <label className="block text-[13px] font-bold text-slate-700 mb-1">API URL</label>
                <input type="text" value={form.apiUrl} onChange={(e) => setForm({ ...form, apiUrl: e.target.value })} className="w-full border border-slate-200 rounded p-2.5 outline-none focus:border-orange-500 text-[14px]" />
              </div>
              <div>
                <label className="block text-[13px] font-bold text-slate-700 mb-1">API-ключи (JSON, напр. {'{"API_KEY":"..."}'})</label>
                <textarea value={form.secrets} onChange={(e) => setForm({ ...form, secrets: e.target.value })} className="w-full border border-slate-200 rounded p-2.5 outline-none focus:border-orange-500 text-[14px] font-mono h-20" placeholder='{"API_KEY":"..."}' />
                {form.secrets === '***' && (
                  <p className="text-[12px] text-slate-400 mt-1">Ключи заданы и скрыты. Оставьте «***», чтобы не менять их.</p>
                )}
                {secretsError && <p className="text-[12px] text-red-600 mt-1">{secretsError}</p>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-bold text-slate-700 mb-1">Наценка (%)</label>
                  <input type="number" value={form.markupPercent} onChange={(e) => setForm({ ...form, markupPercent: e.target.value })} className="w-full border border-slate-200 rounded p-2.5 outline-none focus:border-orange-500 text-[14px]" />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-slate-700 mb-1">Валюта (ISO-4217)</label>
                  <input type="text" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="w-full border border-slate-200 rounded p-2.5 outline-none focus:border-orange-500 text-[14px]" placeholder="KZT" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-bold text-slate-700 mb-1">Лимит (запросов/мин)</label>
                  <input type="number" value={form.rateLimitRpm} onChange={(e) => setForm({ ...form, rateLimitRpm: e.target.value })} className="w-full border border-slate-200 rounded p-2.5 outline-none focus:border-orange-500 text-[14px]" />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-slate-700 mb-1">Таймаут (мс)</label>
                  <input type="number" value={form.timeoutMs} onChange={(e) => setForm({ ...form, timeoutMs: e.target.value })} className="w-full border border-slate-200 rounded p-2.5 outline-none focus:border-orange-500 text-[14px]" />
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-bold text-slate-700 mb-1">Доп. дни доставки</label>
                <input type="number" value={form.deliveryBufferDays} onChange={(e) => setForm({ ...form, deliveryBufferDays: e.target.value })} className="w-full sm:w-1/2 border border-slate-200 rounded p-2.5 outline-none focus:border-orange-500 text-[14px]" />
              </div>
              <div className="flex items-center gap-3 pt-2">
                <input type="checkbox" id="active-switch" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="w-4 h-4 text-orange-500 focus:ring-orange-500 border-slate-300 rounded" />
                <label htmlFor="active-switch" className="text-[14px] font-bold text-slate-900">Активен</label>
              </div>
              {updateMutation.isError && (
                <p className="text-[13px] text-red-600">Не удалось сохранить настройки.</p>
              )}
              <div className="pt-6 flex flex-col sm:flex-row gap-3">
                <button onClick={submit} disabled={updateMutation.isPending} className="w-full sm:w-auto justify-center bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white px-6 py-2.5 rounded text-[13px] font-bold flex items-center gap-2">
                  <Save size={16} /> {updateMutation.isPending ? 'Сохранение…' : 'Сохранить'}
                </button>
                <button onClick={cancelEdit} className="w-full sm:w-auto justify-center bg-slate-100 hover:bg-slate-200 text-slate-700 px-6 py-2.5 rounded text-[13px] font-bold">Отмена</button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // ---- LIST VIEW ----
    return (
      <div>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <h2 className="text-[18px] font-bold text-slate-900 border-l-4 border-orange-500 pl-3">Поставщики</h2>
        </div>

        {suppliersQuery.isLoading && (
          <div className="text-[13px] text-slate-500 p-4">Загрузка поставщиков…</div>
        )}
        {suppliersQuery.isError && (
          <div className="text-[13px] text-red-600 p-4">Не удалось загрузить поставщиков.</div>
        )}

        {suppliersQuery.data && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
            <table className="w-full min-w-[500px] text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-4 font-bold">Название</th>
                  <th className="p-4 font-bold">API URL</th>
                  <th className="p-4 font-bold">Статус</th>
                  <th className="p-4 font-bold text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {suppliersQuery.data.map((s) => (
                  <tr key={s.code}>
                    <td className="p-4 font-bold text-slate-900">{s.name}</td>
                    <td className="p-4 text-slate-500">{getApiUrl(s) || '—'}</td>
                    <td className="p-4">
                      {s.isActive ? (
                        <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-[10px] font-bold uppercase">Активен</span>
                      ) : (
                        <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-[10px] font-bold uppercase">Неактивен</span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <button onClick={() => startEdit(s)} className="text-slate-400 hover:text-orange-500"><Edit size={16} /></button>
                    </td>
                  </tr>
                ))}
                {suppliersQuery.data.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-500">Поставщики не настроены.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };
  ```
- [ ] **(red→green — прогнать)** `cd /home/mans/projects/Dana/front && npx tsc --noEmit`
  Ожидание: 0 ошибок. Типичный «красный», который надо устранить, — несовпадение имён полей `useMutation` v5 (`isPending`, не `isLoading`) или неверный `queryClient.invalidateQueries` объектной формы; исправить до зелёного.
- [ ] **(commit)** `cd /home/mans/projects/Dana/front && git add src/pages/admin/tabs/SuppliersTab.tsx && git commit -m "feat(admin/suppliers): edit form wired to PATCH /api/suppliers/:code"`

---

## Task 4: Ручная поведенческая проверка (нет тест-раннера)

**Files:** нет изменений кода (только проверка); при находках — правки в двух owned-файлах.

**Шаги:**

- [ ] `cd /home/mans/projects/Dana/front && npx tsc --noEmit` — финально 0 ошибок.
- [ ] `cd /home/mans/projects/Dana/front && npm run dev` (Vite на `:3000`). Залогиниться админом, открыть админку → вкладка «Поставщики и API».
- [ ] Проверить в браузере (DevTools → Network):
  - При открытии вкладки уходит `GET /api/suppliers` c заголовком `Authorization: Bearer <token>`; таблица показывает реальные `name` / `config.API_URL` / статус.
  - Клик по «редактировать» открывает форму, поля заполнены реальными значениями; `name` и `Код` — read-only; секреты показаны как `***` если заданы.
  - Изменить `isActive` и `markupPercent`, «Сохранить» → уходит `PATCH /api/suppliers/<code>` с корректным JSON-телом (только заполненные поля; `***` в секретах НЕ отправляется); после ответа список рефетчится (`invalidateQueries`) и показывает новое значение.
  - Ввести невалидный JSON в «API-ключи» → появляется ошибка про JSON, PATCH не уходит.
- [ ] Если что-то не так — чинить только в `suppliersApi.ts` / `SuppliersTab.tsx`, повторить `tsc --noEmit`, коммитить фикс: `cd /home/mans/projects/Dana/front && git add -A && git commit -m "fix(admin/suppliers): <краткое описание>"`.

---

## Self-Review

- [ ] **Владение файлами:** тронуты РОВНО два файла — `src/lib/api/suppliersApi.ts` и `src/pages/admin/tabs/SuppliersTab.tsx`. `src/lib/api/index.ts`, `http.ts`, `queryClient.ts`, `authStore.ts` — не изменялись.
- [ ] **Реальные поля:** все имена полей (`isActive`, `markupPercent`, `currency`, `config.API_URL`↔`apiUrl`, `deliveryBufferDays`, `timeoutMs`, `rateLimitRpm`, `secrets`/`secretsEnc`) взяты из `supplier.entity.ts` и `update-supplier.dto.ts`, не выдуманы. `name` корректно read-only (нет в DTO). Кнопка «Добавить» и «Retry policy» из мока убраны — backend их не поддерживает.
- [ ] **Единицы измерения:** подпись лимита исправлена на «запросов/мин» (`rateLimitRpm`), а не «/сек» как в моке.
- [ ] **Контракт WT-0:** HTTP только через `apiRequest` из `../http`; данные через react-query с `queryKey: ['suppliers']`; токен из `useAuthStore(s => s.accessToken)`; эндпоинты `GET /api/suppliers` и `PATCH /api/suppliers/:code`.
- [ ] **Секреты:** значение `***` (маска backend) никогда не отправляется обратно в `secrets`; отправляется только если админ ввёл новый валидный JSON.
- [ ] **Нет тест-раннера:** тест-фреймворк не добавлялся; TDD-петля через `npx tsc --noEmit` + ручной прогон `npm run dev` — соответствует ограничению.
- [ ] **react-query v5:** используются `isPending` (не `isLoading` для мутации), объектная форма `useQuery`/`useMutation`/`invalidateQueries`.
- [ ] **Пути импортов:** проверить фактическую глубину `../` до `lib/api` и `authStore` от расположения `SuppliersTab.tsx` (ожидается `../../../`); скорректировать, если WT-0 разместил файл иначе.
- [ ] **Edge cases:** пустые числовые поля → `null` (сброс к дефолту), пустые строковые (`apiUrl`/`currency`) → не отправляются, невалидный JSON секретов → блок сабмита с сообщением, `token == null` → query отключён (`enabled`).
