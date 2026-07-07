# WT-0: Фундамент админки и доступ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Открыть доступ к `/admin` только админам/менеджерам (кнопка в шапке + защита роута + реальный вход) и разрезать монолиты `Admin.tsx`/`api.ts` на изолированные файлы, чтобы вкладочные ветки WT-1…7 работали параллельно без конфликтов.

**Architecture:** Фронт React/Vite (репозиторий `front`, отдельный git). Доступ строится на существующем `authStore` (zustand + persist) и уже присутствующем поле `AuthUser.roles`. Монолит `Admin.tsx` разбивается на `AdminLayout` + 7 файлов вкладок (переносятся как есть, с моками). Создаётся каркас `src/lib/api/` с barrel-файлом, куда WT-1…7 добавляют только тело своего клиента.

**Tech Stack:** React 18, react-router-dom, zustand, @tanstack/react-query, lucide-react, TypeScript, Vite.

## Global Constraints

- Рабочая директория: `/home/mans/projects/Dana/front` (НЕ репозиторий backend).
- Base URL API: `https://api.optparts.kz`, глобальный префикс backend — `/api`. Все пути в клиентах начинаются с `/api/...`.
- HTTP только через `apiRequest<T>(path, { token, body, method })` из `src/api.ts`. Не использовать `fetch` напрямую.
- Токен: `useAuthStore(s => s.accessToken)`. Роли: `AuthUser.roles: string[]`, значения `'user' | 'manager' | 'admin'`.
- Роль-хелпер: доступ к админке = роль `admin` ИЛИ `manager`.
- Существующие моки при разрезании НЕ переписывать на данные — только механически перенести. Проект должен собираться (`npm run build`) и работать после WT-0.
- Коммиты частые, по одному на задачу. Русский язык в UI-строках как в текущем коде.

---

### Task 1: Хелпер ролей `isAdmin`

**Files:**
- Create: `src/lib/roles.ts`
- Test: `src/lib/roles.test.ts` (vitest; если тест-раннер не настроен — см. Step 2, тогда проверка через `tsc`)

**Interfaces:**
- Produces: `export const isAdmin: (user: { roles?: string[] } | null | undefined) => boolean`

- [ ] **Step 1: Написать провальный тест**

```ts
// src/lib/roles.test.ts
import { describe, it, expect } from 'vitest';
import { isAdmin } from './roles';

describe('isAdmin', () => {
  it('true для роли admin', () => {
    expect(isAdmin({ roles: ['admin'] })).toBe(true);
  });
  it('true для роли manager', () => {
    expect(isAdmin({ roles: ['user', 'manager'] })).toBe(true);
  });
  it('false для обычного user', () => {
    expect(isAdmin({ roles: ['user'] })).toBe(false);
  });
  it('false для null/undefined/пустых ролей', () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin({ roles: [] })).toBe(false);
  });
});
```

- [ ] **Step 2: Проверить, что тест падает**

Run: `cd /home/mans/projects/Dana/front && npx vitest run src/lib/roles.test.ts`
Expected: FAIL — `Cannot find module './roles'`.
Если vitest не установлен (нет в `package.json` devDependencies) — пропустить прогон тестов в этой задаче, оставить тест-файл как документацию и проверять поведение через `npx tsc --noEmit`. Не добавлять vitest ради одной задачи.

- [ ] **Step 3: Реализация**

```ts
// src/lib/roles.ts
export const ADMIN_ROLES = ['admin', 'manager'] as const;

export const isAdmin = (user: { roles?: string[] } | null | undefined): boolean =>
  Boolean(user?.roles?.some((r) => (ADMIN_ROLES as readonly string[]).includes(r)));
```

- [ ] **Step 4: Проверить, что тест проходит**

Run: `npx vitest run src/lib/roles.test.ts` (или `npx tsc --noEmit`)
Expected: PASS / без ошибок типов.

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles.ts src/lib/roles.test.ts
git commit -m "feat(admin): add isAdmin role helper"
```

---

### Task 2: Каркас `src/lib/api/`

**Files:**
- Create: `src/lib/api/http.ts`
- Create: `src/lib/api/suppliersApi.ts`, `pricingApi.ts`, `settingsApi.ts`, `ordersAdminApi.ts`, `newsApi.ts`, `dashboardApi.ts`, `monitoringApi.ts`
- Create: `src/lib/api/index.ts`

**Interfaces:**
- Produces: `src/lib/api/http.ts` реэкспортит `apiRequest`, `ApiError`, `getApiErrorMessage` и тип `AuthUser` из `../../api`. WT-1…7 импортируют примитивы отсюда: `import { apiRequest } from './http';` (клиенты лежат в той же папке `src/lib/api/`, поэтому путь `./http`, НЕ `../http` и НЕ `src/lib/http.ts`).
- Produces: каждый `xxxApi.ts` экспортит `export const xxxApi = { ... }` (в WT-0 — пустой объект-заглушка). `index.ts` реэкспортит все.

- [ ] **Step 1: http.ts**

```ts
// src/lib/api/http.ts
export { apiRequest, ApiError, getApiErrorMessage, API_BASE_URL } from '../../api';
export type { AuthUser } from '../../api';
```

- [ ] **Step 2: Пустые клиенты (по одному файлу, одинаковый шаблон)**

Создать каждый файл с заглушкой, например:

```ts
// src/lib/api/suppliersApi.ts
import { apiRequest } from './http';
// WT-1 наполняет этот объект.
export const suppliersApi = {};
```

Аналогично: `pricingApi` (WT-2), `settingsApi` (WT-3), `ordersAdminApi` (WT-4), `newsApi` (WT-5), `dashboardApi` (WT-6), `monitoringApi` (WT-7). В каждом — импорт `apiRequest` и пустой экспортируемый объект с именем из списка.

- [ ] **Step 3: Barrel index.ts (все реэкспорты заранее)**

```ts
// src/lib/api/index.ts
export * from './http';
export * from './suppliersApi';
export * from './pricingApi';
export * from './settingsApi';
export * from './ordersAdminApi';
export * from './newsApi';
export * from './dashboardApi';
export * from './monitoringApi';
```

- [ ] **Step 4: Проверить сборку**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api
git commit -m "feat(admin): scaffold src/lib/api client barrel"
```

---

### Task 3: Разрезать `Admin.tsx` на `AdminLayout` + вкладки

**Files:**
- Create: `src/pages/admin/AdminLayout.tsx`
- Create: `src/pages/admin/tabs/DashboardTab.tsx`, `OrdersTab.tsx`, `NewsTab.tsx`, `SuppliersTab.tsx`, `MarkupTab.tsx`, `RulesTab.tsx`, `MonitoringTab.tsx`
- Modify: `src/pages/Admin.tsx` (станет тонкой обёрткой)
- Reference (не менять сейчас): текущий `src/pages/Admin.tsx` — исходник рендер-функций.

**Interfaces:**
- Produces тип вкладки: `export type AdminTabId = 'dashboard' | 'orders' | 'news' | 'suppliers' | 'markup' | 'rules' | 'monitoring'`.
- Produces компоненты вкладок: `export const SuppliersTab: React.FC` и т.д. — WT-1…7 переписывают их внутренности, но НЕ имя, НЕ путь, НЕ сигнатуру (без пропсов; данные вкладка тянет сама).
- `AdminLayout` держит `activeTab` state и рендерит соответствующий `*Tab`.

- [ ] **Step 1: Вынести каждую рендер-функцию в свой компонент**

Из текущего `src/pages/Admin.tsx` перенести:
- `renderDashboard` (стр. ~19) → `tabs/DashboardTab.tsx` как `export const DashboardTab: React.FC = () => ( ... )`.
- `renderOrders` + `renderOrderDetails` (стр. ~360, ~434) → `tabs/OrdersTab.tsx` (локальный state `viewingOrder` переносится внутрь компонента).
- `renderNews` (стр. ~517) → `tabs/NewsTab.tsx` (сохранить текущую логику `useStore`: `news, addNews, updateNews, deleteNews`, локальный `editingNews`).
- `renderSuppliers` + `renderSupplierEdit` (стр. ~81, ~126) → `tabs/SuppliersTab.tsx` (локальный `editingSupplier`).
- `renderMarkup` (стр. ~181) → `tabs/MarkupTab.tsx`.
- `renderRules` (стр. ~275) → `tabs/RulesTab.tsx`.
- `renderMonitoring` (стр. ~646) → `tabs/MonitoringTab.tsx`.

Каждый компонент: перенести JSX как есть, состояние, ранее жившее в `Admin` и используемое только этой вкладкой (`editingSupplier`, `viewingOrder`, `editingNews`), сделать локальным `useState` внутри компонента. Импорты (`lucide-react`, `useStore`, `NewsItem`) — по месту использования.

- [ ] **Step 2: AdminLayout — оболочка**

Перенести в `src/pages/admin/AdminLayout.tsx` внешнюю часть текущего `Admin` (сайдбар со `<button>`-ами вкладок стр. ~740–810, шапку с заголовком по `activeTab` стр. ~798–804, мобильное меню). Заменить блок `{activeTab === 'x' && renderX()}` на рендер импортированных компонентов:

```tsx
// src/pages/admin/AdminLayout.tsx (фрагмент переключения)
import { DashboardTab } from './tabs/DashboardTab';
import { OrdersTab } from './tabs/OrdersTab';
import { NewsTab } from './tabs/NewsTab';
import { SuppliersTab } from './tabs/SuppliersTab';
import { MarkupTab } from './tabs/MarkupTab';
import { RulesTab } from './tabs/RulesTab';
import { MonitoringTab } from './tabs/MonitoringTab';

export type AdminTabId =
  | 'dashboard' | 'orders' | 'news' | 'suppliers' | 'markup' | 'rules' | 'monitoring';

// ... внутри компонента:
{activeTab === 'dashboard' && <DashboardTab />}
{activeTab === 'orders' && <OrdersTab />}
{activeTab === 'news' && <NewsTab />}
{activeTab === 'suppliers' && <SuppliersTab />}
{activeTab === 'markup' && <MarkupTab />}
{activeTab === 'rules' && <RulesTab />}
{activeTab === 'monitoring' && <MonitoringTab />}
```

Кнопки сайдбара переключают `activeTab` через `setActiveTab` (тип `AdminTabId`). Сброс `editing*`/`viewing*` больше не нужен в Layout — состояние теперь локально во вкладках.

- [ ] **Step 3: `Admin.tsx` → тонкая обёртка**

```tsx
// src/pages/Admin.tsx
import React from 'react';
import { AdminLayout } from './admin/AdminLayout';

export const Admin: React.FC = () => <AdminLayout />;
```

- [ ] **Step 4: Проверить сборку и ручной прогон**

Run: `npx tsc --noEmit && npm run build`
Expected: без ошибок. Затем `npm run dev`, открыть `/admin`, кликнуть все вкладки — рендерятся как раньше (моки).

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin src/pages/Admin.tsx
git commit -m "refactor(admin): split Admin.tsx into AdminLayout + per-tab components"
```

---

### Task 4: Реальный вход в `AdminAuth`

**Files:**
- Modify: `src/pages/AdminAuth.tsx`

**Interfaces:**
- Consumes: `useAuthStore().login(data: { email, password })` (уже есть), `isAdmin` (Task 1).

- [ ] **Step 1: Переписать форму на реальный логин**

```tsx
// src/pages/AdminAuth.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../authStore';
import { isAdmin } from '../lib/roles';
import { getApiErrorMessage } from '../api';

export const AdminAuth: React.FC = () => {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login({ email, password });
      if (!isAdmin(user)) {
        setError('Недостаточно прав для входа в панель.');
        return;
      }
      navigate('/admin');
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };
  // ... вернуть ту же вёрстку, но:
  //  - input email: value={email} onChange={e => setEmail(e.target.value)}
  //  - input password: value={password} onChange={e => setPassword(e.target.value)}
  //  - под формой: {error && <p className="text-red-600 text-[13px]">{error}</p>}
  //  - кнопка: disabled={submitting}, текст «Вход...» при submitting
};
```

Сохранить существующую вёрстку (обёртки/классы) из текущего файла, добавив управляемые поля, вывод ошибки и `disabled`.

- [ ] **Step 2: Проверка типов**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Ручная проверка**

`npm run dev` → `/admin/login`: неверные креды → сообщение об ошибке; обычный `user` → «Недостаточно прав»; `admin` → редирект на `/admin`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AdminAuth.tsx
git commit -m "feat(admin): real login via authStore in AdminAuth"
```

---

### Task 5: Защита роута `/admin` (`RequireAdmin`)

**Files:**
- Create: `src/pages/admin/RequireAdmin.tsx`
- Modify: `src/App.tsx` (роуты `/admin`, `/admin/login`; строки ~90-91)

**Interfaces:**
- Consumes: `useAuthStore` (`user`, `accessToken`, `isAuthInitialized`, `fetchCurrentUser`), `isAdmin`.
- Produces: `export const RequireAdmin: React.FC<{ children: React.ReactNode }>`.

- [ ] **Step 1: Компонент-гард**

```tsx
// src/pages/admin/RequireAdmin.tsx
import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../authStore';
import { isAdmin } from '../../lib/roles';

export const RequireAdmin: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.accessToken);
  const isInit = useAuthStore((s) => s.isAuthInitialized);
  const fetchCurrentUser = useAuthStore((s) => s.fetchCurrentUser);

  useEffect(() => {
    if (token && !isInit) void fetchCurrentUser();
  }, [token, isInit, fetchCurrentUser]);

  if (token && !isInit) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Загрузка…</div>;
  }
  if (!isAdmin(user)) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
};
```

- [ ] **Step 2: Обернуть роут в App.tsx**

В `src/App.tsx` заменить `<Route path="/admin" element={<Admin />} />` на:

```tsx
<Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
```

Добавить импорт `import { RequireAdmin } from './pages/admin/RequireAdmin';`. Роут `/admin/login` оставить открытым.

- [ ] **Step 3: Проверка**

Run: `npx tsc --noEmit`. Затем `npm run dev`: как `user` открыть `/admin` → редирект на `/admin/login`; как `admin` → панель открывается; перезагрузка на `/admin` при валидном токене админа не выкидывает.

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/RequireAdmin.tsx src/App.tsx
git commit -m "feat(admin): protect /admin route with RequireAdmin guard"
```

---

### Task 6: Кнопка «Админка» в шапке

**Files:**
- Modify: `src/components/Header.tsx` (блок Actions ~стр. 83-101 и мобильное меню ~стр. 130-140)

**Interfaces:**
- Consumes: `useAuthStore(s => s.user)`, `isAdmin`.

- [ ] **Step 1: Условная кнопка (desktop)**

В `Header.tsx` добавить импорт `LayoutDashboard` в существующий импорт `lucide-react` и `import { isAdmin } from '../lib/roles';`. Вычислить `const showAdmin = isAdmin(authUser);` (переменная `authUser` уже есть). В блоке Actions перед ссылкой на корзину:

```tsx
{showAdmin && (
  <Link to="/admin" className="hidden sm:flex flex-col items-center text-[11px] font-semibold text-orange-600 hover:text-orange-500 transition-colors">
    <LayoutDashboard size={18} className="mb-0.5" />
    <span>Админка</span>
  </Link>
)}
```

- [ ] **Step 2: Пункт в мобильном меню**

В списке мобильного меню (`<ul>`), после пункта аккаунта, добавить:

```tsx
{showAdmin && (
  <li><Link to="/admin" className="block px-6 py-3 text-[13px] font-semibold text-orange-600 hover:bg-slate-50" onClick={() => setIsMenuOpen(false)}>Админка</Link></li>
)}
```

- [ ] **Step 3: Проверка**

Run: `npx tsc --noEmit`. `npm run dev`: под `user`/гостем кнопки нет; под `admin` кнопка видна и ведёт в `/admin`.

- [ ] **Step 4: Commit**

```bash
git add src/components/Header.tsx
git commit -m "feat(admin): show Admin button in header for admins"
```

---

## Self-Review

- Покрытие спека (раздел «WT-0»): хелпер ролей (T1), каркас api (T2), разрез монолита (T3), реальный вход (T4), защита роута (T5), кнопка в шапке (T6) — все пункты закрыты.
- Плейсхолдеров нет: код приведён во всех шагах.
- Согласованность имён: `isAdmin`, `AdminTabId`, имена вкладок `SuppliersTab`/`MarkupTab`/… и файлы `lib/api/*Api.ts` совпадают с тем, что консюмят планы WT-1…7.
- Зависимость: WT-0 мержится ПЕРВЫМ; WT-1…7 стартуют от коммита с влитым WT-0.
