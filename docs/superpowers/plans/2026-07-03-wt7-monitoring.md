# WT-7 — Логи и Мониторинг: BACKEND (новый эндпоинт) + FRONT

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan task-by-task in the current session. Each `### Task N` is a self-contained TDD unit (write failing test → implement → green). Do NOT batch tasks. Do NOT implement code ahead of its test. Run the verification command at the end of every task before moving on.

---

## Goal

Заменить мок-вкладку «Мониторинг интеграций» на реальные данные. Добавить backend-эндпоинт
`GET /api/admin/monitoring` (роли ADMIN, MANAGER), возвращающий:
1. **состояние коннекторов поставщиков** — реальное (список поставщиков + флаг активности + результат `isConfigured()`);
2. **агрегатную статистику успешности** — реальную, вычисленную из таблицы `search_log` за окно 24ч.

Подключить эту вкладку на фронте через `@tanstack/react-query`.

## Architecture

- **Новый модуль `src/monitoring/`** (`MonitoringModule` → `MonitoringController` + `MonitoringService`).
  Выбран отдельный модуль, а НЕ метод в `SuppliersController`, потому что:
  - сервису нужны сразу два источника: коннекторы поставщиков (`SUPPLIERS` + `SuppliersService`) **и** репозиторий `SearchLog`;
  - маршрут семантически админский (`admin/monitoring`), а не `suppliers/*`;
  - изоляция минимизирует merge-конфликты: единственная правка общего файла — регистрация модуля в `app.module.ts`.
- `MonitoringModule` импортирует `SuppliersModule` (он экспортирует `SuppliersService` и токен `SUPPLIERS`) и `TypeOrmModule.forFeature([SearchLog])` (тот же `SearchLog`, что и в `SearchModule`; повторный `forFeature` в другом модуле допустим).
- RBAC как в проекте: `@UseGuards(RolesGuard)` + `@Roles(UserRole.ADMIN, UserRole.MANAGER)`. Глобальный `JwtAuthGuard` (в `app.module`) уже кладёт `user` в request; `RolesGuard` читает `user.roles`.
- Глобальный префикс `api` (`main.ts` → `app.setGlobalPrefix('api')`), поэтому `@Controller('admin/monitoring')` даёт путь `/api/admin/monitoring`.

## Tech Stack

- **Backend:** NestJS 10, TypeORM 0.3, jest 29 + ts-jest. Тесты — `*.spec.ts` рядом с кодом, `rootDir: src`, `testRegex: .*\.spec\.ts$`. Запуск: `npx jest <path>`.
- **Frontend:** React + Vite, `@tanstack/react-query` ^5, zustand (`useAuthStore`). Тест-раннера НЕТ → верификация фронта: `npm run lint` (это `tsc --noEmit`) + ручной `npm run dev`.

---

## Global Constraints

- **НЕ выдумывать таблицы/сущности.** Персистентного per-supplier лога запросов/ошибок в проекте НЕТ (см. «Реальность данных»). Всё, что не покрыто реальным источником, в ответе не возвращаем и на фронте показываем честный empty-state.
- **Реальность данных (проверено по коду):**
  - ✅ **Состояние коннекторов** — реально. `SuppliersService.findAll()` → строки `suppliers` (`code`, `name`, `isActive`). Каждый коннектор из `SUPPLIERS` имеет `code`, `name`, `isConfigured(): Promise<boolean>` (реальная проверка наличия креденшелов, см. `tabys.connector.ts` / `supplier-connector.interface.ts`).
  - ✅ **Агрегатная успешность / ошибки за 24ч** — реально. Таблица `search_log` (`src/search/entities/search-log.entity.ts`) хранит по каждому поиску: `suppliersQueried`, `suppliersFailed`, `totalResults`, `createdAt`. Из неё вычисляются: число ошибок за 24ч (`SUM(suppliersFailed)`), успешность (`(queried-failed)/queried`), число поисков.
  - ❌ **Список конкретных упавших «задач» с текстом ошибки и кнопкой «Перезапустить»** (мок-таблица «Повторные и неудачные задачи») — источника НЕТ. `search_log.suppliersFailed` — это только счётчик, он НЕ хранит, какой именно поставщик упал и с каким сообщением. Ошибки логируются лишь эфемерно (`this.logger.warn(...)` в `search.service.ts`), не персистятся. Очереди задач/ретраев в проекте нет.
  - ❌ **«Задач в очереди»** (мок-KPI) — источника НЕТ (нет job-queue). Не возвращаем.
- **Merge-точки (отметить в PR):**
  - `src/app.module.ts` — добавляется 1 import + 1 запись в массив `imports`. Возможный конфликт с **WT-5/WT-6**, если они тоже правят `imports`. Правка минимальна и локальна.
  - **НЕ трогаем** `src/suppliers/*` (кроме чтения через DI). Это исключает конфликт с WT-5/WT-6 по suppliers-модулю и с WT-1 (WT-1 — чисто фронт).
  - Фронт: ветка владеет `src/lib/api/monitoringApi.ts` и `src/pages/admin/tabs/MonitoringTab.tsx`. `src/lib/api/index.ts` уже реэкспортит `monitoringApi` (создан в WT-0) — **не трогать**.
- **Контракт WT-0 (не переопределять):** HTTP через `apiRequest<T>(path, { token, body, method })`, импорт `import { apiRequest } from '../http';`. Данные — через react-query. Токен — `useAuthStore(s => s.accessToken)`.

---

# BACKEND

## Task 1 — Response DTO мониторинга

**Files:**
- `src/monitoring/dto/monitoring-response.dto.ts` (new)

**Interfaces (точный тип ответа `GET /api/admin/monitoring`):**

```ts
export type ConnectorStatus = 'online' | 'disabled' | 'misconfigured';
// online        = isActive && isConfigured
// disabled      = !isActive
// misconfigured = isActive && !isConfigured
```

```ts
// src/monitoring/dto/monitoring-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export type ConnectorStatus = 'online' | 'disabled' | 'misconfigured';

export class MonitoringConnectorDto {
  @ApiProperty({ example: 'tabys', description: 'Код поставщика' })
  code: string;

  @ApiProperty({ example: 'Tabys', description: 'Название поставщика' })
  name: string;

  @ApiProperty({ example: true, description: 'Включён ли поставщик в поиск (suppliers.isActive)' })
  isActive: boolean;

  @ApiProperty({ example: true, description: 'Есть ли все обязательные креденшелы (connector.isConfigured())' })
  isConfigured: boolean;

  @ApiProperty({ enum: ['online', 'disabled', 'misconfigured'], example: 'online' })
  status: ConnectorStatus;
}

export class MonitoringStatsDto {
  @ApiProperty({ example: 24, description: 'Окно агрегации в часах' })
  windowHours: number;

  @ApiProperty({ example: 128, description: 'Сколько поисков было за окно (строк в search_log)' })
  searchCount: number;

  @ApiProperty({ example: 250, description: 'Суммарно опрошено поставщиков за окно (SUM suppliersQueried)' })
  suppliersQueriedTotal: number;

  @ApiProperty({ example: 12, description: 'Суммарно неудачных ответов поставщиков за окно (SUM suppliersFailed)' })
  suppliersFailedTotal: number;

  @ApiProperty({ example: 0.952, description: 'Доля успешных ответов 0..1; =1 если опросов не было' })
  successRate: number;
}

export class MonitoringResponseDto {
  @ApiProperty({ type: [MonitoringConnectorDto] })
  connectors: MonitoringConnectorDto[];

  @ApiProperty({ type: MonitoringStatsDto })
  stats: MonitoringStatsDto;

  @ApiProperty({ example: '2026-07-03T12:00:00.000Z', description: 'Момент формирования ответа (ISO)' })
  generatedAt: string;
}
```

**Steps (TDD):**
- [ ] DTO — это чистые классы без логики; отдельный `.spec.ts` не нужен (в проекте DTO не тестируются отдельно — ср. `update-supplier.dto.ts`). Просто создать файл выше.
- [ ] Верификация: `cd /home/mans/projects/Dana/api.optparts.kz && npx tsc --noEmit -p tsconfig.json` не даёт новых ошибок по этому файлу. (Если `tsconfig` строгий и ругается на неинициализированные поля — оставить как есть; идентичный стиль уже используется в проектных DTO/entities.)

---

## Task 2 — MonitoringService + unit-тест

**Files:**
- `src/monitoring/monitoring.service.ts` (new)
- `src/monitoring/monitoring.service.spec.ts` (new)

**Interfaces (сигнатура сервиса):**

```ts
class MonitoringService {
  constructor(
    connectors: SupplierConnector[],          // @Inject(SUPPLIERS)
    suppliersService: SuppliersService,
    searchLogRepo: Repository<SearchLog>,      // @InjectRepository(SearchLog)
  );
  getMonitoring(): Promise<MonitoringResponseDto>;
}
```

**Логика `getMonitoring()`:**
1. `rows = await suppliersService.findAll()` → Map `code → isActive`.
2. Для каждого коннектора из `connectors`: `isConfigured = await c.isConfigured()`; `isActive = activeByCode.get(c.code) ?? false`; `status`:
   - `!isActive` → `'disabled'`
   - `isActive && !isConfigured` → `'misconfigured'`
   - иначе → `'online'`.
   Собрать `MonitoringConnectorDto[]` (сортировка по `code` для детерминизма).
3. Статистика из `search_log` за 24ч:
   - `since = new Date(Date.now() - windowHours*3600_000)`;
   - агрегат через `createQueryBuilder`: `COUNT(*) AS cnt`, `SUM(suppliersQueried) AS queried`, `SUM(suppliersFailed) AS failed`, `WHERE createdAt >= :since`.
   - `searchCount = Number(cnt)`, `suppliersQueriedTotal = Number(queried ?? 0)`, `suppliersFailedTotal = Number(failed ?? 0)`.
   - `successRate = queriedTotal > 0 ? (queriedTotal - failedTotal) / queriedTotal : 1`, округлить до 3 знаков.
4. Вернуть `{ connectors, stats, generatedAt: new Date().toISOString() }`.

**Полный код сервиса:**

```ts
// src/monitoring/monitoring.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SUPPLIERS, SupplierConnector } from '../suppliers/supplier-connector.interface';
import { SuppliersService } from '../suppliers/suppliers.service';
import { SearchLog } from '../search/entities/search-log.entity';
import {
  ConnectorStatus,
  MonitoringConnectorDto,
  MonitoringResponseDto,
  MonitoringStatsDto,
} from './dto/monitoring-response.dto';

const WINDOW_HOURS = 24;

@Injectable()
export class MonitoringService {
  constructor(
    @Inject(SUPPLIERS) private readonly connectors: SupplierConnector[],
    private readonly suppliersService: SuppliersService,
    @InjectRepository(SearchLog)
    private readonly searchLogRepo: Repository<SearchLog>,
  ) {}

  async getMonitoring(): Promise<MonitoringResponseDto> {
    const connectors = await this.buildConnectors();
    const stats = await this.buildStats();
    return { connectors, stats, generatedAt: new Date().toISOString() };
  }

  private async buildConnectors(): Promise<MonitoringConnectorDto[]> {
    const rows = await this.suppliersService.findAll();
    const activeByCode = new Map(rows.map((r) => [r.code, r.isActive]));

    const dtos = await Promise.all(
      this.connectors.map(async (c) => {
        const isActive = activeByCode.get(c.code) ?? false;
        let isConfigured = false;
        try {
          isConfigured = await c.isConfigured();
        } catch {
          isConfigured = false;
        }
        return {
          code: c.code,
          name: c.name,
          isActive,
          isConfigured,
          status: this.statusOf(isActive, isConfigured),
        };
      }),
    );

    return dtos.sort((a, b) => a.code.localeCompare(b.code));
  }

  private statusOf(isActive: boolean, isConfigured: boolean): ConnectorStatus {
    if (!isActive) return 'disabled';
    if (!isConfigured) return 'misconfigured';
    return 'online';
  }

  private async buildStats(): Promise<MonitoringStatsDto> {
    const since = new Date(Date.now() - WINDOW_HOURS * 3600_000);
    const raw = await this.searchLogRepo
      .createQueryBuilder('log')
      .select('COUNT(*)', 'cnt')
      .addSelect('COALESCE(SUM(log.suppliersQueried), 0)', 'queried')
      .addSelect('COALESCE(SUM(log.suppliersFailed), 0)', 'failed')
      .where('log.createdAt >= :since', { since })
      .getRawOne<{ cnt: string; queried: string; failed: string }>();

    const searchCount = Number(raw?.cnt ?? 0);
    const suppliersQueriedTotal = Number(raw?.queried ?? 0);
    const suppliersFailedTotal = Number(raw?.failed ?? 0);
    const successRate =
      suppliersQueriedTotal > 0
        ? Math.round(
            ((suppliersQueriedTotal - suppliersFailedTotal) / suppliersQueriedTotal) * 1000,
          ) / 1000
        : 1;

    return {
      windowHours: WINDOW_HOURS,
      searchCount,
      suppliersQueriedTotal,
      suppliersFailedTotal,
      successRate,
    };
  }
}
```

**Steps (TDD):**
- [ ] Сначала написать `monitoring.service.spec.ts` (падающий). Мокаем без Nest DI (как в `suppliers.service.spec.ts`): передаём фейковые `connectors`, `suppliersService`, `searchLogRepo` прямо в конструктор.
- [ ] Мок `searchLogRepo.createQueryBuilder()` возвращает цепочку `{ select, addSelect, where }` → `this` и `getRawOne` → фиксированный объект.
- [ ] Тест-кейсы:
  1. **статусы коннекторов**: active+configured → `online`; active+!configured → `misconfigured`; !active → `disabled`; коннектора нет в `suppliers` (`activeByCode` без него) → `disabled`.
  2. **сортировка** connectors по `code`.
  3. **successRate**: queried=250, failed=12 → `0.952`; queried=0 → `successRate=1`, `searchCount` из `cnt`.
  4. `isConfigured()` бросает → ловится, `isConfigured=false`, `status` учитывает (active → `misconfigured`).
  5. `generatedAt` — валидная ISO-строка.

**Полный код теста:**

```ts
// src/monitoring/monitoring.service.spec.ts
import { MonitoringService } from './monitoring.service';

function makeRepo(raw: { cnt: string; queried: string; failed: string }) {
  const qb: any = {
    select: jest.fn(() => qb),
    addSelect: jest.fn(() => qb),
    where: jest.fn(() => qb),
    getRawOne: jest.fn(async () => raw),
  };
  return { createQueryBuilder: jest.fn(() => qb) } as any;
}

function makeConnector(code: string, name: string, configured: boolean | Error) {
  return {
    code,
    name,
    isConfigured: jest.fn(async () => {
      if (configured instanceof Error) throw configured;
      return configured;
    }),
  } as any;
}

describe('MonitoringService', () => {
  it('maps connector statuses (online / disabled / misconfigured) and sorts by code', async () => {
    const connectors = [
      makeConnector('tabys', 'Tabys', true),   // active + configured -> online
      makeConnector('rossko', 'Rossko', true), // active but no row -> disabled
      makeConnector('shatem', 'ShateM', false),// active + !configured -> misconfigured
    ];
    const suppliersService = {
      findAll: jest.fn(async () => [
        { code: 'tabys', isActive: true },
        { code: 'shatem', isActive: true },
        // 'rossko' intentionally absent -> defaults to inactive
      ]),
    } as any;
    const repo = makeRepo({ cnt: '0', queried: '0', failed: '0' });

    const svc = new MonitoringService(connectors, suppliersService, repo);
    const res = await svc.getMonitoring();

    expect(res.connectors.map((c) => c.code)).toEqual(['rossko', 'shatem', 'tabys']);
    const byCode = Object.fromEntries(res.connectors.map((c) => [c.code, c.status]));
    expect(byCode).toEqual({ tabys: 'online', shatem: 'misconfigured', rossko: 'disabled' });
  });

  it('computes successRate from search_log window', async () => {
    const connectors = [makeConnector('tabys', 'Tabys', true)];
    const suppliersService = {
      findAll: jest.fn(async () => [{ code: 'tabys', isActive: true }]),
    } as any;
    const repo = makeRepo({ cnt: '128', queried: '250', failed: '12' });

    const svc = new MonitoringService(connectors, suppliersService, repo);
    const res = await svc.getMonitoring();

    expect(res.stats.windowHours).toBe(24);
    expect(res.stats.searchCount).toBe(128);
    expect(res.stats.suppliersQueriedTotal).toBe(250);
    expect(res.stats.suppliersFailedTotal).toBe(12);
    expect(res.stats.successRate).toBe(0.952);
    expect(new Date(res.generatedAt).toISOString()).toBe(res.generatedAt);
  });

  it('successRate is 1 when no suppliers were queried', async () => {
    const connectors = [makeConnector('tabys', 'Tabys', true)];
    const suppliersService = { findAll: jest.fn(async () => [{ code: 'tabys', isActive: true }]) } as any;
    const repo = makeRepo({ cnt: '0', queried: '0', failed: '0' });

    const svc = new MonitoringService(connectors, suppliersService, repo);
    const res = await svc.getMonitoring();

    expect(res.stats.successRate).toBe(1);
    expect(res.stats.searchCount).toBe(0);
  });

  it('treats a throwing isConfigured() as not configured', async () => {
    const connectors = [makeConnector('tabys', 'Tabys', new Error('boom'))];
    const suppliersService = { findAll: jest.fn(async () => [{ code: 'tabys', isActive: true }]) } as any;
    const repo = makeRepo({ cnt: '0', queried: '0', failed: '0' });

    const svc = new MonitoringService(connectors, suppliersService, repo);
    const res = await svc.getMonitoring();

    expect(res.connectors[0].isConfigured).toBe(false);
    expect(res.connectors[0].status).toBe('misconfigured');
  });
});
```

- [ ] Реализовать `monitoring.service.ts` (код выше) до зелёного.
- [ ] Верификация: `cd /home/mans/projects/Dana/api.optparts.kz && npx jest src/monitoring/monitoring.service.spec.ts` — все зелёные.

---

## Task 3 — MonitoringController (роли ADMIN, MANAGER) + unit-тест

**Files:**
- `src/monitoring/monitoring.controller.ts` (new)
- `src/monitoring/monitoring.controller.spec.ts` (new)

**Interfaces:**

```ts
@Controller('admin/monitoring')   // → GET /api/admin/monitoring
class MonitoringController {
  getMonitoring(): Promise<MonitoringResponseDto>;
}
```

**Полный код контроллера:**

```ts
// src/monitoring/monitoring.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { MonitoringService } from './monitoring.service';
import { MonitoringResponseDto } from './dto/monitoring-response.dto';

@ApiTags('monitoring')
@ApiBearerAuth()
@Controller('admin/monitoring')
@UseGuards(RolesGuard)
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get()
  @ApiOperation({
    summary: 'Состояние интеграций поставщиков и агрегатная статистика (ADMIN, MANAGER)',
    description:
      'Возвращает текущее состояние подключённых коннекторов поставщиков (включён ли поставщик ' +
      'в поиск и настроены ли его креденшелы) и агрегатную статистику успешности ответов ' +
      'поставщиков за последние 24 часа, вычисленную из журнала поиска (search_log).',
  })
  @ApiOkResponse({ type: MonitoringResponseDto })
  @ApiResponse({ status: 403, description: 'Только для администратора или менеджера.' })
  getMonitoring(): Promise<MonitoringResponseDto> {
    return this.monitoringService.getMonitoring();
  }
}
```

**Steps (TDD):**
- [ ] Написать падающий `monitoring.controller.spec.ts` по образцу `suppliers.controller.spec.ts` (инстанцируем контроллер с мок-сервисом, без Nest).
- [ ] Реализовать контроллер до зелёного.

**Полный код теста:**

```ts
// src/monitoring/monitoring.controller.spec.ts
import { MonitoringController } from './monitoring.controller';

describe('MonitoringController', () => {
  const payload = {
    connectors: [{ code: 'tabys', name: 'Tabys', isActive: true, isConfigured: true, status: 'online' }],
    stats: { windowHours: 24, searchCount: 0, suppliersQueriedTotal: 0, suppliersFailedTotal: 0, successRate: 1 },
    generatedAt: '2026-07-03T12:00:00.000Z',
  };
  const service = { getMonitoring: jest.fn(async () => payload) };
  const controller = new MonitoringController(service as any);

  it('GET delegates to service.getMonitoring', async () => {
    await expect(controller.getMonitoring()).resolves.toEqual(payload);
    expect(service.getMonitoring).toHaveBeenCalled();
  });
});
```

- [ ] Верификация: `cd /home/mans/projects/Dana/api.optparts.kz && npx jest src/monitoring/monitoring.controller.spec.ts` — зелёный.

---

## Task 4 — MonitoringModule + регистрация в app.module

**Files:**
- `src/monitoring/monitoring.module.ts` (new)
- `src/app.module.ts` (**merge point** — см. Global Constraints)

**Полный код модуля:**

```ts
// src/monitoring/monitoring.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchLog } from '../search/entities/search-log.entity';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

@Module({
  imports: [TypeOrmModule.forFeature([SearchLog]), SuppliersModule],
  controllers: [MonitoringController],
  providers: [MonitoringService],
})
export class MonitoringModule {}
```

**Правки `src/app.module.ts` (минимальные):**
- [ ] Добавить импорт рядом с другими модулями:
  ```ts
  import { MonitoringModule } from './monitoring/monitoring.module';
  ```
- [ ] Добавить `MonitoringModule` в массив `imports` (например, сразу после `CatalogModule`).
- [ ] `SearchLog` уже в списке `entities` TypeORM root-конфига (строка с `entities: [...]`) — **ничего добавлять не нужно**.

**Steps:**
- [ ] Внести обе правки.
- [ ] Верификация: `cd /home/mans/projects/Dana/api.optparts.kz && npx jest src/monitoring && npx tsc --noEmit -p tsconfig.build.json` (если `tsconfig.build.json` нет — `npx tsc --noEmit`). Модуль компилируется, DI (`SUPPLIERS`, `SuppliersService` экспортированы из `SuppliersModule`; `SearchLog` repo из `forFeature`) резолвится.
- [ ] (Опционально, smoke) `npm run start:dev`, затем `curl -s http://localhost:3000/api/admin/monitoring -H "Authorization: Bearer <ADMIN_JWT>"` — 200 с реальным телом; без токена/с ролью `user` — 403.

---

# FRONTEND

> Директория: `/home/mans/projects/Dana/front`. Тест-раннера нет → верификация: `npm run lint` (`tsc --noEmit`) + ручной `npm run dev`.
>
> **Зависит от WT-0:** предполагается, что WT-0 уже создал `src/lib/http.ts` (экспорт `apiRequest`), пустой `src/lib/api/monitoringApi.ts`, `src/lib/api/index.ts` (реэкспорт `monitoringApi`) и каркас `src/pages/admin/tabs/MonitoringTab.tsx` с `export const MonitoringTab`. Если каких-то файлов нет — создать по контракту WT-0, но **`src/lib/api/index.ts` не трогать** (реэкспорт уже есть).

## Task 5 — monitoringApi.get()

**Files:**
- `src/lib/api/monitoringApi.ts` (fill in; WT-0 оставил пустым)
- (типы) inline в этом же файле.

**Interfaces (зеркало backend DTO; сигнатура `monitoringApi.get()`):**

```ts
export type ConnectorStatus = 'online' | 'disabled' | 'misconfigured';

export interface MonitoringConnector {
  code: string;
  name: string;
  isActive: boolean;
  isConfigured: boolean;
  status: ConnectorStatus;
}

export interface MonitoringStats {
  windowHours: number;
  searchCount: number;
  suppliersQueriedTotal: number;
  suppliersFailedTotal: number;
  successRate: number; // 0..1
}

export interface MonitoringResponse {
  connectors: MonitoringConnector[];
  stats: MonitoringStats;
  generatedAt: string;
}

// monitoringApi.get(token: string | null) => Promise<MonitoringResponse>
```

**Полный код:**

```ts
// src/lib/api/monitoringApi.ts
import { apiRequest } from '../http';

export type ConnectorStatus = 'online' | 'disabled' | 'misconfigured';

export interface MonitoringConnector {
  code: string;
  name: string;
  isActive: boolean;
  isConfigured: boolean;
  status: ConnectorStatus;
}

export interface MonitoringStats {
  windowHours: number;
  searchCount: number;
  suppliersQueriedTotal: number;
  suppliersFailedTotal: number;
  successRate: number;
}

export interface MonitoringResponse {
  connectors: MonitoringConnector[];
  stats: MonitoringStats;
  generatedAt: string;
}

export const monitoringApi = {
  get: (token: string | null) =>
    apiRequest<MonitoringResponse>('/api/admin/monitoring', { token: token ?? undefined }),
};
```

**Steps:**
- [ ] Заполнить файл кодом выше. Путь `'/api/admin/monitoring'` — с префиксом `/api` (см. конвенцию `api.ts`: все пути идут как `/api/...`, `apiRequest` конкатенирует с `API_BASE_URL`).
- [ ] Проверить фактическую сигнатуру `apiRequest` из WT-0 `src/lib/http.ts`: options — `{ token?, body?, method? }`. Если `token` типизирован как `string | undefined`, передача `token ?? undefined` корректна.
- [ ] Верификация: `cd /home/mans/projects/Dana/front && npm run lint` — без новых ошибок по файлу.

---

## Task 6 — MonitoringTab на реальных данных

**Files:**
- `src/pages/admin/tabs/MonitoringTab.tsx` (заменить мок на реальные данные)

**Что рендерим (маппинг мок → реальные данные):**
- KPI-карточки (было 3 мок-карточки):
  - «Ошибки поставщиков (24ч)» ← `stats.suppliersFailedTotal` (**реально**).
  - «Успешность ответов» ← `${(stats.successRate * 100).toFixed(1)}%` (**реально**).
  - «Поисков за 24ч» ← `stats.searchCount` (**реально**; заменяет мок-«Задач в очереди», у которого нет источника).
- Таблица «Состояние коннекторов» (**реально**, заменяет мок-таблицу «Повторные и неудачные задачи»): колонки Код / Название / Активен / Настроен / Статус, строки — `connectors[]`. Бейдж статуса: `online` (зелёный), `misconfigured` (оранжевый), `disabled` (серый).
- **Честный empty-state / примечание** вместо мок-таблицы упавших задач с «Перезапустить»: под таблицей коннекторов — заметка «Детализация ошибок по каждому запросу (какой поставщик, текст ошибки, ретраи) недоступна: в системе нет журнала запросов к поставщикам. Показаны агрегаты из журнала поиска за 24ч.» Не рендерить фейковые строки job'ов и кнопки «Перезапустить» (нет backend-действия).

**Interfaces / данные:**

```tsx
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../../authStore';           // сверить путь при интеграции
import { monitoringApi, type MonitoringResponse } from '../../../lib/api';

const token = useAuthStore((s) => s.accessToken);
const { data, isLoading, isError, refetch } = useQuery<MonitoringResponse>({
  queryKey: ['admin', 'monitoring'],
  queryFn: () => monitoringApi.get(token),
  enabled: !!token,
  refetchInterval: 30_000,   // лёгкий авто-рефреш состояния
});
```

**Полный код компонента (Tailwind-стиль из проекта; иконки lucide-react уже используются в Admin.tsx):**

```tsx
// src/pages/admin/tabs/MonitoringTab.tsx
import { useQuery } from '@tanstack/react-query';
import { Activity, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../../../authStore';
import {
  monitoringApi,
  type MonitoringConnector,
  type MonitoringResponse,
} from '../../../lib/api';

const statusBadge: Record<MonitoringConnector['status'], { label: string; cls: string }> = {
  online: { label: 'Онлайн', cls: 'bg-green-50 text-green-600' },
  misconfigured: { label: 'Не настроен', cls: 'bg-orange-50 text-orange-600' },
  disabled: { label: 'Выключен', cls: 'bg-slate-100 text-slate-500' },
};

export const MonitoringTab = () => {
  const token = useAuthStore((s) => s.accessToken);
  const { data, isLoading, isError, refetch, isFetching } = useQuery<MonitoringResponse>({
    queryKey: ['admin', 'monitoring'],
    queryFn: () => monitoringApi.get(token),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-[18px] font-bold text-slate-900 border-l-4 border-orange-500 pl-3">
          Мониторинг интеграций
        </h2>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 text-[13px] font-bold text-orange-500 hover:text-orange-600"
        >
          <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} /> Обновить
        </button>
      </div>

      {isLoading && <div className="text-slate-500 text-[14px]">Загрузка…</div>}
      {isError && (
        <div className="text-red-500 text-[14px]">
          Не удалось загрузить данные мониторинга.
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <KpiCard
              icon={<XCircle size={24} />}
              tone="red"
              label={`Ошибки поставщиков (${data.stats.windowHours}ч)`}
              value={String(data.stats.suppliersFailedTotal)}
            />
            <KpiCard
              icon={<CheckCircle size={24} />}
              tone="green"
              label="Успешность ответов"
              value={`${(data.stats.successRate * 100).toFixed(1)}%`}
            />
            <KpiCard
              icon={<Activity size={24} />}
              tone="blue"
              label={`Поисков за ${data.stats.windowHours}ч`}
              value={String(data.stats.searchCount)}
            />
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
            <div className="p-4 border-b border-slate-200 bg-slate-50 min-w-[600px]">
              <h3 className="font-bold text-slate-900">Состояние коннекторов</h3>
            </div>
            <table className="w-full min-w-[600px] text-left text-[13px]">
              <thead className="bg-white border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-4 font-bold">Код</th>
                  <th className="p-4 font-bold">Название</th>
                  <th className="p-4 font-bold">Активен</th>
                  <th className="p-4 font-bold">Настроен</th>
                  <th className="p-4 font-bold">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.connectors.map((c) => {
                  const badge = statusBadge[c.status];
                  return (
                    <tr key={c.code} className="hover:bg-slate-50">
                      <td className="p-4 font-mono text-slate-600">{c.code}</td>
                      <td className="p-4 font-bold text-slate-900">{c.name}</td>
                      <td className="p-4 text-slate-600">{c.isActive ? 'Да' : 'Нет'}</td>
                      <td className="p-4 text-slate-600">{c.isConfigured ? 'Да' : 'Нет'}</td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded text-[11px] font-bold ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-[12px] text-slate-500 leading-relaxed">
            Детализация ошибок по каждому запросу (какой поставщик, текст ошибки, повторные
            попытки) недоступна: в системе нет журнала запросов к поставщикам. Показаны агрегаты
            из журнала поиска за {data.stats.windowHours}ч (опрошено поставщиков:{' '}
            {data.stats.suppliersQueriedTotal}).
          </p>
        </>
      )}
    </div>
  );
};

function KpiCard({
  icon,
  tone,
  label,
  value,
}: {
  icon: React.ReactNode;
  tone: 'red' | 'green' | 'blue';
  label: string;
  value: string;
}) {
  const toneCls = {
    red: 'bg-red-50 text-red-500',
    green: 'bg-green-50 text-green-500',
    blue: 'bg-blue-50 text-blue-500',
  }[tone];
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${toneCls}`}>
        {icon}
      </div>
      <div>
        <div className="text-[12px] text-slate-500 font-bold uppercase tracking-wider">{label}</div>
        <div className="text-[24px] font-bold text-slate-900">{value}</div>
      </div>
    </div>
  );
}
```

**Steps:**
- [ ] Заменить мок-тело `MonitoringTab` на код выше.
- [ ] Сверить относительные пути импортов (`authStore`, `lib/api`) в реальной структуре после WT-0; поправить количество `../` при необходимости.
- [ ] Убедиться, что `type` реэкспортируется из `lib/api/index.ts` (WT-0 реэкспортит `monitoringApi`; типы можно импортировать напрямую из `../../../lib/api/monitoringApi`, если index не реэкспортит типы — тогда заменить путь импорта типов).
- [ ] Верификация: `cd /home/mans/projects/Dana/front && npm run lint` (без ошибок), затем `npm run dev` → открыть админку, вкладку «Мониторинг»: карточки и таблица коннекторов заполнены реальными данными; при остановленном backend — видно состояние ошибки.

---

## Self-Review

- **Реальные данные:** состояние коннекторов (`code`, `name`, `isActive` из таблицы `suppliers`, `isConfigured()` из коннектора) и агрегаты за 24ч из `search_log` (`searchCount`, `suppliersQueriedTotal`, `suppliersFailedTotal`, `successRate`). Всё подтверждено чтением кода (`suppliers.service.ts`, `supplier-connector.interface.ts`, `search.service.ts`, `search-log.entity.ts`).
- **Явно недоступно (не выдумано):** пофакторный лог ошибок по поставщику с текстом и ретраями, «Задач в очереди» — источника нет; на фронте честный empty-state, backend их не возвращает. Рекомендация на будущее (вне scope WT-7, НЕ реализуем): сущность `SupplierRequestLog` (supplierCode, article, ok, errorMessage, latencyMs, createdAt), пишущаяся из `SearchService` в `Promise.allSettled` — только тогда таблица упавших задач станет реальной.
- **Путь модуля:** выбран отдельный `MonitoringModule` (не метод в `SuppliersController`) — меньше связности и merge-конфликтов; `src/suppliers/*` не изменяется.
- **Merge-точки:** единственная правка общего файла — `src/app.module.ts` (1 import + 1 запись в `imports`), возможный конфликт с WT-5/WT-6; отмечено. `src/lib/api/index.ts` на фронте не трогается.
- **RBAC:** `@Roles(ADMIN, MANAGER)` + `RolesGuard`, как в существующих контроллерах; глобальный `JwtAuthGuard` обеспечивает `user`.
- **Тесты:** backend — 2 spec-файла (service: 4 кейса, controller: 1 кейс), запуск `npx jest src/monitoring`. Front — тест-раннера нет → `npm run lint` + ручной `npm run dev` (отмечено).
- **Число задач:** 6 (4 backend, 2 front).
- **Открытые допущения:** точная сигнатура `apiRequest`/наличие `src/lib/http.ts` и каркаса `MonitoringTab` — из WT-0; при интеграции сверить относительные пути импортов и тип `token` (`string | null` vs `undefined`).
