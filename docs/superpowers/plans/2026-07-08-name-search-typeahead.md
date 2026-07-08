# Name-Search Typeahead — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** При вводе названия детали («Свеча») строка поиска показывает живой автоподсказ категорий и подгрупп каталога; выбор ведёт в нужную категорию с раскрытой группой.

**Architecture:** Крон раз в месяц материализует категории + подгруппы PartsIndex в таблицу `catalog_name_index` (через существующий `CatalogCacheService`). Сервис `NameSearchIndex` держит эти записи в памяти и матчит запрос через нормализацию + русский стеммер + курируемые синонимы + фаззи (Levenshtein). HTTP-эндпоинт `GET /api/search/suggest` (в существующем `GlobalSearchController`, `@Controller('search')` внутри `CatalogModule`) отдаёт подсказки; фронт рисует дропдаун под строкой поиска.

**Tech Stack:** NestJS + TypeORM (Postgres), `@nestjs/schedule` (`@Cron`), Jest. Фронт — React 19 + Vite + react-router + TanStack Query (каталог `/home/mans/projects/Dana/front`).

## Global Constraints

- Прод запускается скомпилированной сборкой `node dist/main` — **никаких нативных бинарников** в зависимостях; стеммер реализуем на чистом TS (суффиксное отсечение по алгоритму, без внешних пакетов).
- Все новые сущности регистрируются в ДВУХ местах: `src/app.module.ts` (массив `entities`) и `src/config/data-source.ts` (массив `entities`). Миграции — только руками, глоб `src/migrations/*.ts` (CLI) и `dist/migrations/*.js` (рантайм).
- Миграции именуются `1700000000025-<Name>.ts` (следующий номер после `...024-CreateVehicles`).
- Прод: `NODE_ENV=production`, `synchronize` ВЫКЛ → схема применяется только миграцией (`npm run migration:run`).
- Язык индекса пока только `ru` (колонка `lang` заложена на будущее).
- Backend-запросы к PartsIndex идут ТОЛЬКО через `PartsCatalogService`/`CatalogCacheService` (квота ключа ~1000 запросов).
- Спека: `docs/superpowers/specs/2026-07-08-name-search-typeahead-design.md`.

**Отклонение от спеки (осознанное):** спека предлагала эндпоинт `/suggest` в `SearchController` (SearchModule). Но `NameSearchIndex` зависит от `PartsCatalogService` (CatalogModule), а `CatalogModule` уже импортирует `SearchModule` → размещение в SearchModule дало бы циклическую зависимость модулей. Поэтому эндпоинт живёт в `GlobalSearchController` (тоже `@Controller('search')`, уже в CatalogModule и уже отдаёт `/api/search/global`). Маршрут для клиента идентичен: `/api/search/suggest`.

**Отклонение по стеммеру:** берём named-fallback из спеки — встроенное суффиксное отсечение (dependency-free), а не npm Snowball-порт. Причина — гарантированно чистая прод-сборка `node dist/main` и отсутствие риска нативных зависимостей.

**Отклонение по логированию:** `search_log.queryType` — `varchar(16)` без CHECK-констрейнта (см. `1700000000023-AddSearchLogQueryType.ts`), поэтому для значения `'name'` миграция НЕ нужна — только правка TS-типа и Swagger-описания.

## File Structure

Backend (`/home/mans/projects/Dana/api.optparts.kz`):
- `src/catalog/name-search/name-normalize.ts` — чистый модуль: `normalize()`, `normToString()`, `stemRu()`, `transliterate()`, `levenshtein()`.
- `src/catalog/name-search/name-normalize.spec.ts` — юниты нормализации/стеммера.
- `src/catalog/name-search/synonyms.ts` — курируемая карта синонимов (ключи — стеммы).
- `src/catalog/name-search/name-search.dto.ts` — `NameSuggestionDto`, `SuggestResponseDto`.
- `src/catalog/name-search/name-search-index.service.ts` — `NameSearchIndex` (in-memory индекс + `suggest()`).
- `src/catalog/name-search/name-search-index.service.spec.ts` — юниты матчинга на фикстуре.
- `src/catalog/name-search/name-index.builder.ts` — `NameIndexBuilder` (крон + `rebuild()` + `onModuleInit`).
- `src/catalog/name-search/name-index.builder.spec.ts` — юнит билдера на моке `PartsCatalogService`.
- `src/catalog/entities/catalog-name-index.entity.ts` — сущность `CatalogNameIndex`.
- `src/migrations/1700000000025-CreateCatalogNameIndex.ts` — миграция таблицы.
- `src/catalog/catalog.module.ts` — регистрация сущности/провайдеров.
- `src/catalog/controllers/global-search.controller.ts` — маршрут `/suggest`.
- `src/catalog/services/global-search.service.ts` — режим `name` через `NameSearchIndex`.
- `src/search/search.service.ts` — `logNameSearch()`.
- `src/search/entities/search-log.entity.ts` — тип `queryType` + `'name'`.
- `src/app.module.ts`, `src/config/data-source.ts` — регистрация сущности.

Frontend (`/home/mans/projects/Dana/front`):
- `src/types/catalog.ts` — `NameSuggestion`, `SuggestResponse`.
- `src/api.ts` — `searchApi.suggest`.
- `src/hooks/useSuggest.ts` — дебаунс + TanStack Query.
- `src/components/SearchBox.tsx` — инпут + дропдаун + клавиатура + навигация (новый).
- `src/components/Header.tsx` — заменить обе формы поиска на `<SearchBox />`.

---

### Task 1: Модуль нормализации и стеммер

**Files:**
- Create: `src/catalog/name-search/name-normalize.ts`
- Test: `src/catalog/name-search/name-normalize.spec.ts`

**Interfaces:**
- Produces:
  - `stemRu(word: string): string`
  - `transliterate(token: string): string`
  - `normalize(text: string): string[]`
  - `normToString(text: string): string`
  - `levenshtein(a: string, b: string): number`

- [ ] **Step 1: Написать падающий тест**

Create `src/catalog/name-search/name-normalize.spec.ts`:
```ts
import { stemRu, transliterate, normalize, normToString, levenshtein } from './name-normalize';

describe('stemRu', () => {
  it.each([
    ['свеча', 'свеч'],
    ['свечи', 'свеч'],
    ['свечей', 'свеч'],
    ['зажигания', 'зажигани'],
    ['зажигание', 'зажигани'],
    ['колодки', 'колодк'],
    ['колодка', 'колодк'],
    ['фильтр', 'фильтр'],
    ['фильтра', 'фильтр'],
    ['фильтров', 'фильтр'],
    ['масляный', 'маслян'],
    ['масляная', 'маслян'],
    ['лампы', 'ламп'],
  ])('стеммит %s -> %s', (input, expected) => {
    expect(stemRu(input)).toBe(expected);
  });

  it('не режет слова <= 3 символов', () => {
    expect(stemRu('ось')).toBe('ось');
  });
});

describe('transliterate', () => {
  it('латиница -> кириллица с диграфами', () => {
    expect(transliterate('svecha')).toBe('свеча');
    expect(transliterate('lampa')).toBe('лампа');
  });
});

describe('normalize', () => {
  it('ё->е, пунктуация, стоп-слова, стемминг, транслит', () => {
    expect(normalize('Свечи зажигания')).toEqual(['свеч', 'зажигани']);
    expect(normalize('svecha')).toEqual(['свеч']);
    expect(normalize('фильтр для масла')).toEqual(['фильтр', 'масл']);
  });
  it('пустой ввод -> []', () => {
    expect(normalize('   ')).toEqual([]);
  });
});

describe('normToString', () => {
  it('соединяет стеммы пробелом', () => {
    expect(normToString('Свечи зажигания')).toBe('свеч зажигани');
  });
});

describe('levenshtein', () => {
  it('считает расстояние', () => {
    expect(levenshtein('свеч', 'свеч')).toBe(0);
    expect(levenshtein('колодок', 'колодк')).toBe(1);
    expect(levenshtein('свеча', 'сеча')).toBe(1);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npm test -- name-normalize`
Expected: FAIL — «Cannot find module './name-normalize'».

- [ ] **Step 3: Реализовать модуль**

Create `src/catalog/name-search/name-normalize.ts`:
```ts
/** Русские окончания для суффиксного стеммера, отсортированы длинными вперёд. */
const ENDINGS = [
  'иями', 'ыми', 'ими', 'ого', 'его', 'ому', 'ему', 'ями', 'ами', 'иях', 'иям',
  'ах', 'ях', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ый', 'ий', 'ой', 'ем', 'ом',
  'им', 'ым', 'их', 'ых', 'ов', 'ев', 'ей', 'ью', 'ья', 'ье', 'ия', 'ам', 'ям',
  'а', 'я', 'о', 'е', 'ы', 'и', 'й', 'ь', 'у', 'ю',
].sort((x, y) => y.length - x.length);

/** Минимальная длина остатка после отсечения окончания. */
const MIN_STEM = 3;

export function stemRu(word: string): string {
  const w = word.toLowerCase().replace(/ё/g, 'е');
  if (w.length <= MIN_STEM) return w;
  for (const end of ENDINGS) {
    if (w.length - end.length >= MIN_STEM && w.endsWith(end)) {
      return w.slice(0, w.length - end.length);
    }
  }
  return w;
}

/** Диграфы латиница->кириллица (применяются раньше одиночных букв). */
const DIGRAPHS: Array<[RegExp, string]> = [
  [/shch/g, 'щ'], [/sch/g, 'щ'], [/sh/g, 'ш'], [/ch/g, 'ч'], [/zh/g, 'ж'],
  [/kh/g, 'х'], [/ya/g, 'я'], [/yu/g, 'ю'], [/yo/g, 'ё'], [/ts/g, 'ц'],
];
const SINGLES: Record<string, string> = {
  a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', z: 'з', i: 'и', j: 'й',
  k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т',
  u: 'у', f: 'ф', h: 'х', c: 'ц', y: 'ы', w: 'в', x: 'кс', q: 'к',
};

export function transliterate(token: string): string {
  let t = token.toLowerCase();
  for (const [re, ru] of DIGRAPHS) t = t.replace(re, ru);
  return t
    .split('')
    .map((ch) => SINGLES[ch] ?? ch)
    .join('');
}

const STOPWORDS = new Set(['для', 'и', 'с', 'со', 'на', 'в', 'по', 'из', 'к', 'от', 'а']);

export function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (/^[a-z0-9]+$/.test(t) ? transliterate(t) : t))
    .filter((t) => !STOPWORDS.has(t))
    .map(stemRu)
    .filter(Boolean);
}

export function normToString(text: string): string {
  return normalize(text).join(' ');
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npm test -- name-normalize`
Expected: PASS (все кейсы зелёные).

- [ ] **Step 5: Коммит**

```bash
git add src/catalog/name-search/name-normalize.ts src/catalog/name-search/name-normalize.spec.ts
git commit -m "feat(catalog): add russian name-normalization + stemmer module

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Карта синонимов

**Files:**
- Create: `src/catalog/name-search/synonyms.ts`
- Test: `src/catalog/name-search/synonyms.spec.ts`

**Interfaces:**
- Produces: `SYNONYMS: Record<string, string[]>` — ключи и значения уже в стеммленой форме (совместимой со `stemRu`).

- [ ] **Step 1: Написать падающий тест**

Create `src/catalog/name-search/synonyms.spec.ts`:
```ts
import { SYNONYMS } from './synonyms';
import { stemRu } from './name-normalize';

describe('SYNONYMS', () => {
  it('ключи хранятся в стеммленой форме', () => {
    for (const key of Object.keys(SYNONYMS)) {
      expect(stemRu(key)).toBe(key);
    }
  });
  it('значения тоже стеммлены', () => {
    for (const arr of Object.values(SYNONYMS)) {
      for (const v of arr) expect(stemRu(v)).toBe(v);
    }
  });
  it('покрывает базовые кейсы', () => {
    expect(SYNONYMS['дворник']).toContain('щетк');
    expect(SYNONYMS['тормоз']).toContain('колодк');
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npm test -- synonyms`
Expected: FAIL — «Cannot find module './synonyms'».

- [ ] **Step 3: Реализовать карту**

Create `src/catalog/name-search/synonyms.ts`:
```ts
/**
 * Курируемая карта синонимов. Ключ и значения — в стеммленой форме (stemRu),
 * чтобы напрямую сопоставляться с токенами индекса. Расширяется по логам
 * name-запросов с нулём подсказок (см. search_log queryType='name').
 */
export const SYNONYMS: Record<string, string[]> = {
  свеч: ['зажигани', 'накал'],
  тормоз: ['колодк', 'диск', 'суппорт'],
  дворник: ['щетк', 'стеклоочистител'],
  фильтр: ['воздушн', 'маслян', 'салон', 'топливн'],
  ремен: ['грм', 'приводн'],
  амортизатор: ['стойк'],
  фара: ['фар', 'оптик'],
  аккум: ['аккумулятор', 'акб'],
};
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npm test -- synonyms`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/catalog/name-search/synonyms.ts src/catalog/name-search/synonyms.spec.ts
git commit -m "feat(catalog): add curated synonym map for name search

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Сущность `catalog_name_index` + миграция + регистрация

**Files:**
- Create: `src/catalog/entities/catalog-name-index.entity.ts`
- Create: `src/migrations/1700000000025-CreateCatalogNameIndex.ts`
- Modify: `src/app.module.ts:60` (массив `entities`)
- Modify: `src/config/data-source.ts` (импорт + массив `entities`)
- Modify: `src/catalog/catalog.module.ts:19` (`TypeOrmModule.forFeature`)

**Interfaces:**
- Produces: класс `CatalogNameIndex` с полями `id, kind, catalogId, groupId, name, parentName, lang, norm, updatedAt`.

- [ ] **Step 1: Создать сущность**

Create `src/catalog/entities/catalog-name-index.entity.ts`:
```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Плоский снимок категорий и подгрупп PartsIndex для поиска по названию.
 * Не источник правды — целиком перестраивается кроном NameIndexBuilder
 * (delete-by-lang + insert в транзакции). norm — стеммленая форма для матчинга.
 */
@Entity('catalog_name_index')
@Index(['lang', 'kind'])
export class CatalogNameIndex {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  kind: 'category' | 'group';

  @Column()
  catalogId: string;

  @Column({ type: 'varchar', nullable: true, default: null })
  groupId: string | null;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true, default: null })
  parentName: string | null;

  @Column({ default: 'ru' })
  lang: string;

  @Column()
  norm: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 2: Создать миграцию**

Create `src/migrations/1700000000025-CreateCatalogNameIndex.ts`:
```ts
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateCatalogNameIndex1700000000025 implements MigrationInterface {
  name = 'CreateCatalogNameIndex1700000000025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'catalog_name_index',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'uuid_generate_v4()' },
          { name: 'kind', type: 'varchar', length: '16', isNullable: false },
          { name: 'catalogId', type: 'varchar', isNullable: false },
          { name: 'groupId', type: 'varchar', isNullable: true, default: null },
          { name: 'name', type: 'varchar', isNullable: false },
          { name: 'parentName', type: 'varchar', isNullable: true, default: null },
          { name: 'lang', type: 'varchar', isNullable: false, default: "'ru'" },
          { name: 'norm', type: 'varchar', isNullable: false },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()', isNullable: false },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'catalog_name_index',
      new TableIndex({ name: 'IDX_cat_name_idx_lang_kind', columnNames: ['lang', 'kind'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('catalog_name_index');
  }
}
```

Note: `uuid_generate_v4()` уже используется в проекте (расширение `uuid-ossp` включено предыдущими миграциями). Если сборка на чистой БД упадёт на отсутствии функции — использовать `gen_random_uuid()` (pgcrypto). Проверить, чем пользуются соседние `Create*`-миграции (`grep uuid_generate_v4 src/migrations`), и взять тот же вариант.

- [ ] **Step 3: Зарегистрировать сущность (app.module + data-source + forFeature)**

In `src/app.module.ts`, add the import near the other catalog import and add `CatalogNameIndex` to the `entities` array (line ~60):
```ts
import { CatalogNameIndex } from './catalog/entities/catalog-name-index.entity';
```
```ts
entities: [User, Product, ProductImage, ProductProperty, Cart, CartItem, Address, Category, Brand, Order, OrderItem, Supplier, SearchLog, SupplierOrder, PartnerProduct, AppSetting, BrandMarkup, CatalogCache, News, Vehicle, CatalogNameIndex],
```

In `src/config/data-source.ts`, add import and append to `entities`:
```ts
import { CatalogNameIndex } from '../catalog/entities/catalog-name-index.entity';
```
```ts
    CatalogCache,
    News,
    CatalogNameIndex,
```

In `src/catalog/catalog.module.ts`, update the `forFeature` (line 19):
```ts
import { CatalogNameIndex } from './entities/catalog-name-index.entity';
```
```ts
  imports: [TypeOrmModule.forFeature([CatalogCache, CatalogNameIndex]), SearchModule],
```

- [ ] **Step 4: Собрать и прогнать миграцию**

Run:
```bash
npm run build
npm run migration:run
```
Expected: сборка без ошибок; миграция `CreateCatalogNameIndex1700000000025` применяется (в логе `migration ... has been executed successfully`). Проверить таблицу:
```bash
grep -c uuid_generate_v4 src/migrations/*.ts   # подтвердить единый способ генерации uuid
```

- [ ] **Step 5: Коммит**

```bash
git add src/catalog/entities/catalog-name-index.entity.ts src/migrations/1700000000025-CreateCatalogNameIndex.ts src/app.module.ts src/config/data-source.ts src/catalog/catalog.module.ts
git commit -m "feat(catalog): add catalog_name_index entity + migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Сервис `NameSearchIndex` (in-memory + suggest)

**Files:**
- Create: `src/catalog/name-search/name-search.dto.ts`
- Create: `src/catalog/name-search/name-search-index.service.ts`
- Test: `src/catalog/name-search/name-search-index.service.spec.ts`

**Interfaces:**
- Consumes: `normalize`, `levenshtein` (Task 1); `SYNONYMS` (Task 2); `CatalogNameIndex` (Task 3).
- Produces:
  - `NameSuggestionDto { kind: 'category'|'group'; categoryId: string; groupId: string|null; name: string; parentName: string|null; score: number }`
  - `SuggestResponseDto { query: string; suggestions: NameSuggestionDto[] }`
  - `NameSearchIndex` c методами:
    - `load(): Promise<void>` — читает строки `lang='ru'` из репозитория в память
    - `reload(): Promise<void>` — алиас `load()` (зовётся билдером)
    - `suggest(query: string, lang?: string, limit?: number): NameSuggestionDto[]`
    - `size(): number`

- [ ] **Step 1: Создать DTO**

Create `src/catalog/name-search/name-search.dto.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';

export class NameSuggestionDto {
  @ApiProperty({ enum: ['category', 'group'], example: 'category' })
  kind: 'category' | 'group';

  @ApiProperty({ description: 'Id категории каталога', example: 'ignition' })
  categoryId: string;

  @ApiProperty({ description: 'Id подгруппы (для kind=group)', example: '84', nullable: true })
  groupId: string | null;

  @ApiProperty({ description: 'Отображаемое название', example: 'Свечи зажигания' })
  name: string;

  @ApiProperty({ description: 'Имя родительской категории (для kind=group)', example: 'Зажигание', nullable: true })
  parentName: string | null;

  @ApiProperty({ description: 'Оценка релевантности (больше — лучше)', example: 115 })
  score: number;
}

export class SuggestResponseDto {
  @ApiProperty({ example: 'свеча' })
  query: string;

  @ApiProperty({ type: [NameSuggestionDto] })
  suggestions: NameSuggestionDto[];
}
```

- [ ] **Step 2: Написать падающий тест**

Create `src/catalog/name-search/name-search-index.service.spec.ts`:
```ts
import { Repository } from 'typeorm';
import { NameSearchIndex } from './name-search-index.service';
import { CatalogNameIndex } from '../entities/catalog-name-index.entity';
import { normToString } from './name-normalize';

/** Собрать fake-строку индекса с корректным norm. */
function row(p: Partial<CatalogNameIndex>): CatalogNameIndex {
  return {
    id: Math.random().toString(36).slice(2),
    kind: 'category',
    catalogId: 'x',
    groupId: null,
    name: '',
    parentName: null,
    lang: 'ru',
    norm: normToString(p.name ?? ''),
    updatedAt: new Date(0),
    ...p,
    norm: normToString(p.name ?? ''),
  } as CatalogNameIndex;
}

function makeIndex(rows: CatalogNameIndex[]): NameSearchIndex {
  const repo = { find: async () => rows } as unknown as Repository<CatalogNameIndex>;
  return new NameSearchIndex(repo);
}

describe('NameSearchIndex.suggest', () => {
  const rows = [
    row({ kind: 'category', catalogId: 'ignition', name: 'Свечи зажигания' }),
    row({ kind: 'group', catalogId: 'ignition', groupId: '84', name: 'Свечи накаливания', parentName: 'Зажигание' }),
    row({ kind: 'category', catalogId: 'lamps', name: 'Лампы' }),
    row({ kind: 'category', catalogId: 'brakes', name: 'Тормозные колодки' }),
    row({ kind: 'category', catalogId: 'wipers', name: 'Щётки стеклоочистителя' }),
    row({ kind: 'category', catalogId: 'filters', name: 'Масляный фильтр' }),
  ];

  let index: NameSearchIndex;
  beforeEach(async () => {
    index = makeIndex(rows);
    await index.load();
  });

  it('единственное число находит множественное (стемминг)', () => {
    const top = index.suggest('свеча');
    expect(top[0].catalogId).toBe('ignition');
  });

  it('транслит: svecha -> свечи', () => {
    expect(index.suggest('svecha')[0].catalogId).toBe('ignition');
  });

  it('синоним: дворники -> щётки стеклоочистителя', () => {
    expect(index.suggest('дворники')[0].catalogId).toBe('wipers');
  });

  it('синоним: тормоз -> тормозные колодки', () => {
    expect(index.suggest('тормоз')[0].catalogId).toBe('brakes');
  });

  it('опечатка (фаззи): сеча -> свечи', () => {
    const top = index.suggest('сеча');
    expect(top.map((s) => s.catalogId)).toContain('ignition');
  });

  it('категория ранжируется выше подгруппы при равном совпадении', () => {
    const top = index.suggest('свечи');
    expect(top[0].kind).toBe('category');
  });

  it('короткий запрос (< 1 значимого токена) -> []', () => {
    expect(index.suggest('')).toEqual([]);
  });

  it('уважает limit', () => {
    expect(index.suggest('фильтр', 'ru', 1).length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 3: Запустить тест — убедиться, что падает**

Run: `npm test -- name-search-index`
Expected: FAIL — «Cannot find module './name-search-index.service'».

- [ ] **Step 4: Реализовать сервис**

Create `src/catalog/name-search/name-search-index.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CatalogNameIndex } from '../entities/catalog-name-index.entity';
import { normalize, levenshtein } from './name-normalize';
import { SYNONYMS } from './synonyms';
import { NameSuggestionDto } from './name-search.dto';

interface Entry {
  kind: 'category' | 'group';
  categoryId: string;
  groupId: string | null;
  name: string;
  parentName: string | null;
  tokens: string[];
}

@Injectable()
export class NameSearchIndex {
  private readonly logger = new Logger(NameSearchIndex.name);
  private entries: Entry[] = [];

  constructor(
    @InjectRepository(CatalogNameIndex)
    private readonly repo: Repository<CatalogNameIndex>,
  ) {}

  async load(lang = 'ru'): Promise<void> {
    const rows = await this.repo.find({ where: { lang } });
    this.entries = rows.map((r) => ({
      kind: r.kind,
      categoryId: r.catalogId,
      groupId: r.groupId,
      name: r.name,
      parentName: r.parentName,
      tokens: r.norm.split(' ').filter(Boolean),
    }));
    this.logger.log(`Name index loaded: ${this.entries.length} entries (lang=${lang})`);
  }

  reload(lang = 'ru'): Promise<void> {
    return this.load(lang);
  }

  size(): number {
    return this.entries.length;
  }

  suggest(query: string, _lang = 'ru', limit = 8): NameSuggestionDto[] {
    const qTokens = normalize(query);
    if (qTokens.length === 0) return [];

    const scored: Array<{ e: Entry; score: number }> = [];
    for (const e of this.entries) {
      let total = 0;
      let matchedAll = true;
      for (const qt of qTokens) {
        const s = this.bestTokenScore(qt, e.tokens);
        if (s <= 0) {
          matchedAll = false;
          break;
        }
        total += s;
      }
      if (!matchedAll) continue;
      if (e.kind === 'category') total += 15;
      if (e.name.length <= 15) total += 5;
      scored.push({ e, score: total });
    }

    scored.sort((a, b) => b.score - a.score || a.e.name.length - b.e.name.length);
    return scored.slice(0, limit).map(({ e, score }) => ({
      kind: e.kind,
      categoryId: e.categoryId,
      groupId: e.groupId,
      name: e.name,
      parentName: e.parentName,
      score,
    }));
  }

  /** Лучший балл сопоставления одного query-токена с токенами записи. */
  private bestTokenScore(qt: string, tokens: string[]): number {
    const candidates = [qt, ...(SYNONYMS[qt] ?? [])];
    let best = 0;
    for (const tok of tokens) {
      for (const c of candidates) {
        const isPrimary = c === qt;
        if (tok === c) {
          best = Math.max(best, isPrimary ? 100 : 70);
        } else if (c.length >= 3 && tok.startsWith(c)) {
          best = Math.max(best, isPrimary ? 60 : 45);
        } else if (isPrimary) {
          const d = levenshtein(qt, tok);
          const tol = qt.length > 6 ? 2 : qt.length >= 5 ? 1 : 0;
          if (d > 0 && d <= tol) best = Math.max(best, 30 - d * 5);
        }
      }
    }
    return best;
  }
}
```

- [ ] **Step 5: Запустить тест — убедиться, что проходит**

Run: `npm test -- name-search-index`
Expected: PASS (все кейсы).

- [ ] **Step 6: Коммит**

```bash
git add src/catalog/name-search/name-search.dto.ts src/catalog/name-search/name-search-index.service.ts src/catalog/name-search/name-search-index.service.spec.ts
git commit -m "feat(catalog): add NameSearchIndex in-memory suggest service

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `NameIndexBuilder` (крон + rebuild + старт)

**Files:**
- Create: `src/catalog/name-search/name-index.builder.ts`
- Test: `src/catalog/name-search/name-index.builder.spec.ts`
- Modify: `src/catalog/catalog.module.ts` (providers)

**Interfaces:**
- Consumes: `PartsCatalogService.listCategories(lang)`, `PartsCatalogService.groups(catalogId, lang)` (см. `src/catalog/services/parts-catalog.service.ts`); `CatalogNameIndex` repo; `NameSearchIndex.reload()`; `normToString` (Task 1); `DataSource` (транзакция).
- Produces: `NameIndexBuilder` c `rebuild(lang?: string): Promise<{ categories: number; groups: number }>` и `@Cron`-хендлером.

- [ ] **Step 1: Написать падающий тест**

Create `src/catalog/name-search/name-index.builder.spec.ts`:
```ts
import { NameIndexBuilder } from './name-index.builder';
import { normToString } from './name-normalize';

describe('NameIndexBuilder.rebuild', () => {
  it('плоско разворачивает категории + дерево групп и пишет norm', async () => {
    const catalog = {
      listCategories: jest.fn().mockResolvedValue([
        { id: 'ignition', name: 'Свечи зажигания', image: null },
      ]),
      groups: jest.fn().mockResolvedValue([
        {
          id: 'root',
          name: 'Зажигание',
          children: [{ id: '84', name: 'Свечи накаливания', children: [] }],
        },
      ]),
    };

    const saved: any[] = [];
    const manager = {
      delete: jest.fn().mockResolvedValue(undefined),
      insert: jest.fn(async (_e: unknown, rows: any[]) => { saved.push(...rows); }),
    };
    const dataSource = { transaction: (fn: any) => fn(manager) };
    const index = { reload: jest.fn().mockResolvedValue(undefined), size: () => saved.length };

    const builder = new NameIndexBuilder(
      catalog as any,
      dataSource as any,
      index as any,
    );

    const res = await builder.rebuild('ru');

    expect(res.categories).toBe(1);
    expect(res.groups).toBe(2); // root + 1 child
    expect(manager.delete).toHaveBeenCalled();
    const category = saved.find((r) => r.kind === 'category');
    expect(category.norm).toBe(normToString('Свечи зажигания'));
    const child = saved.find((r) => r.name === 'Свечи накаливания');
    expect(child.kind).toBe('group');
    expect(child.groupId).toBe('84');
    expect(child.parentName).toBe('Свечи зажигания');
    expect(index.reload).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npm test -- name-index.builder`
Expected: FAIL — «Cannot find module './name-index.builder'».

- [ ] **Step 3: Реализовать билдер**

Create `src/catalog/name-search/name-index.builder.ts`:
```ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { PartsCatalogService } from '../services/parts-catalog.service';
import { CatalogNameIndex } from '../entities/catalog-name-index.entity';
import { GroupNodeDto } from '../dto/catalog.dto';
import { NameSearchIndex } from './name-search-index.service';
import { normToString } from './name-normalize';

type NewRow = Pick<
  CatalogNameIndex,
  'kind' | 'catalogId' | 'groupId' | 'name' | 'parentName' | 'lang' | 'norm'
>;

/**
 * Материализует категории + подгруппы PartsIndex в таблицу catalog_name_index.
 * Дефолт крона — раз в месяц (1-го числа, полночь); переопределяется NAME_INDEX_CRON.
 * На старте грузит индекс из таблицы; если пусто — запускает первичный rebuild
 * в фоне (best-effort, не блокирует запуск приложения).
 */
@Injectable()
export class NameIndexBuilder implements OnModuleInit {
  private readonly logger = new Logger(NameIndexBuilder.name);
  private running = false;

  constructor(
    private readonly catalog: PartsCatalogService,
    private readonly dataSource: DataSource,
    private readonly index: NameSearchIndex,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.index.load();
    if (this.index.size() === 0) {
      this.logger.warn('Name index empty on startup — triggering initial rebuild.');
      this.rebuild().catch((err) =>
        this.logger.error('Initial name-index rebuild failed.', err?.stack ?? String(err)),
      );
    }
  }

  @Cron(process.env.NAME_INDEX_CRON || '0 0 1 * *', { name: 'rebuild-name-index' })
  cron(): Promise<void> {
    return this.rebuild()
      .then(() => undefined)
      .catch((err) =>
        this.logger.error('Scheduled name-index rebuild failed.', err?.stack ?? String(err)),
      );
  }

  async rebuild(lang = 'ru'): Promise<{ categories: number; groups: number }> {
    if (this.running) {
      this.logger.warn('Skipping rebuild: previous run still in progress.');
      return { categories: 0, groups: 0 };
    }
    this.running = true;
    try {
      const categories = await this.catalog.listCategories(lang);
      const rows: NewRow[] = [];

      for (const cat of categories) {
        rows.push({
          kind: 'category',
          catalogId: cat.id,
          groupId: null,
          name: cat.name,
          parentName: null,
          lang,
          norm: normToString(cat.name),
        });

        let tree: GroupNodeDto[] = [];
        try {
          tree = await this.catalog.groups(cat.id, lang);
        } catch (err: any) {
          this.logger.warn(`groups(${cat.id}) failed: ${err?.message ?? err}`);
        }
        this.flatten(tree, cat.id, cat.name, lang, rows);
      }

      const groupCount = rows.filter((r) => r.kind === 'group').length;

      await this.dataSource.transaction(async (manager) => {
        await manager.delete(CatalogNameIndex, { lang });
        // insert батчами по 500, чтобы не упереться в лимит параметров драйвера
        for (let i = 0; i < rows.length; i += 500) {
          await manager.insert(CatalogNameIndex, rows.slice(i, i + 500));
        }
      });

      await this.index.reload(lang);
      this.logger.log(
        `Name index rebuilt: categories=${categories.length} groups=${groupCount}`,
      );
      return { categories: categories.length, groups: groupCount };
    } finally {
      this.running = false;
    }
  }

  private flatten(
    nodes: GroupNodeDto[],
    catalogId: string,
    parentName: string,
    lang: string,
    out: NewRow[],
  ): void {
    for (const n of nodes) {
      out.push({
        kind: 'group',
        catalogId,
        groupId: n.id,
        name: n.name,
        parentName,
        lang,
        norm: normToString(n.name),
      });
      if (n.children?.length) this.flatten(n.children, catalogId, parentName, lang, out);
    }
  }
}
```

Note: тестовый мок `insert(entity, rows)` вызывается с двумя аргументами — сигнатура `manager.insert(CatalogNameIndex, batch)` совпадает.

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npm test -- name-index.builder`
Expected: PASS.

- [ ] **Step 5: Зарегистрировать провайдеры в CatalogModule**

In `src/catalog/catalog.module.ts` add imports and providers:
```ts
import { NameSearchIndex } from './name-search/name-search-index.service';
import { NameIndexBuilder } from './name-search/name-index.builder';
```
Add both to the `providers` array (after `GlobalSearchService`):
```ts
    GlobalSearchService,
    NameSearchIndex,
    NameIndexBuilder,
```
Add `NameSearchIndex` to `exports` (used by controller/service in this module — export not strictly required but keeps it discoverable):
```ts
    OemCatalogService,
    NameSearchIndex,
```

- [ ] **Step 6: Собрать (проверить DI-граф)**

Run: `npm run build`
Expected: сборка без ошибок (все зависимости `NameIndexBuilder`/`NameSearchIndex` резолвятся; `ScheduleModule.forRoot()` уже подключён в `app.module.ts`).

- [ ] **Step 7: Коммит**

```bash
git add src/catalog/name-search/name-index.builder.ts src/catalog/name-search/name-index.builder.spec.ts src/catalog/catalog.module.ts
git commit -m "feat(catalog): add monthly NameIndexBuilder cron + startup load

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Эндпоинт `GET /api/search/suggest`

**Files:**
- Modify: `src/catalog/controllers/global-search.controller.ts`
- Test: `test/name-suggest.e2e-spec.ts` (или ближайший стиль e2e в `test/`; если e2e-инфраструктуры нет — контроллерный unit-тест рядом с контроллером)

**Interfaces:**
- Consumes: `NameSearchIndex.suggest()` (Task 4); `SuggestResponseDto` (Task 4).
- Produces: HTTP `GET /api/search/suggest?q=&lang=&limit=` → `SuggestResponseDto`.

- [ ] **Step 1: Написать падающий тест (контроллерный unit)**

Create `src/catalog/controllers/global-search.controller.spec.ts` (если файла нет; иначе добавить `describe`):
```ts
import { GlobalSearchController } from './global-search.controller';

describe('GlobalSearchController.suggest', () => {
  const index = {
    suggest: jest.fn().mockReturnValue([
      { kind: 'category', categoryId: 'ignition', groupId: null, name: 'Свечи зажигания', parentName: null, score: 120 },
    ]),
  };
  const controller = new GlobalSearchController({} as any, index as any);

  it('возвращает подсказки для запроса >= 2 символов', () => {
    const res = controller.suggest('свеча', undefined, undefined);
    expect(res.query).toBe('свеча');
    expect(res.suggestions[0].categoryId).toBe('ignition');
    expect(index.suggest).toHaveBeenCalledWith('свеча', 'ru', 8);
  });

  it('короткий запрос -> пустой список без обращения к индексу', () => {
    index.suggest.mockClear();
    const res = controller.suggest('с', undefined, undefined);
    expect(res.suggestions).toEqual([]);
    expect(index.suggest).not.toHaveBeenCalled();
  });

  it('ограничивает limit сверху (<=20)', () => {
    index.suggest.mockClear();
    controller.suggest('фильтр', 'ru', '100');
    expect(index.suggest).toHaveBeenCalledWith('фильтр', 'ru', 20);
  });
});
```

Проверить фактический конструктор `GlobalSearchController` перед этим — сигнатуру `new GlobalSearchController(service, index)` привести в соответствие Step 3 (порядок аргументов).

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npm test -- global-search.controller`
Expected: FAIL — метод `suggest` не существует / конструктор не принимает индекс.

- [ ] **Step 3: Реализовать маршрут**

In `src/catalog/controllers/global-search.controller.ts`:
- добавить импорты:
```ts
import { NameSearchIndex } from '../name-search/name-search-index.service';
import { SuggestResponseDto } from '../name-search/name-search.dto';
```
- добавить `NameSearchIndex` в конструктор:
```ts
constructor(
  private readonly globalSearch: GlobalSearchService,
  private readonly nameIndex: NameSearchIndex,
) {}
```
(имя первого поля привести к тому, что уже есть в файле — не переименовывать существующее.)
- добавить метод (рядом с существующим `global`-хендлером):
```ts
@Public()
@Get('suggest')
@ApiOperation({
  summary: 'Автоподсказ по названию детали (категории + подгруппы)',
  description:
    'Живой typeahead для строки поиска. По части названия («Свеч») возвращает ' +
    'подходящие категории и подгруппы каталога (стемминг + синонимы + опечатки). ' +
    'Меньше 2 символов — пустой список. Ответ мгновенный (индекс в памяти).',
})
@ApiQuery({ name: 'q', required: true, example: 'свеча' })
@ApiQuery({ name: 'lang', required: false, example: 'ru' })
@ApiQuery({ name: 'limit', required: false, example: 8 })
@ApiOkResponse({ type: SuggestResponseDto })
suggest(
  @Query('q') q: string | undefined,
  @Query('lang') lang: string | undefined,
  @Query('limit') limit: string | undefined,
): SuggestResponseDto {
  const query = (q ?? '').trim();
  if (query.length < 2) return { query, suggestions: [] };
  const n = Math.min(Number(limit) || 8, 20);
  return { query, suggestions: this.nameIndex.suggest(query, lang || 'ru', n) };
}
```
Убедиться, что `Public`, `Get`, `Query`, `ApiOperation`, `ApiQuery`, `ApiOkResponse` уже импортированы в файле (добавить недостающие из `@nestjs/common` / `@nestjs/swagger` / `../../auth/decorators/public.decorator`).

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npm test -- global-search.controller`
Expected: PASS.

- [ ] **Step 5: Smoke-проверка живого эндпоинта**

Run (по README — прод-инстанс на :3100, см. память проекта):
```bash
npm run build
# перезапуск прод-процесса согласно CLAUDE.md/памяти (PORT=3100)
curl -s "http://localhost:3100/api/search/suggest?q=свеча" | head -c 400
```
Expected: JSON `{"query":"свеча","suggestions":[{"kind":"category","categoryId":"...","name":"Свечи зажигания",...}]}`. Если `suggestions` пуст — проверить, что индекс наполнился (лог `Name index rebuilt` / `Name index loaded: N entries`, N > 0); при пустой таблице дождаться первичного `rebuild` или дёрнуть его (Task 5 onModuleInit).

- [ ] **Step 6: Коммит**

```bash
git add src/catalog/controllers/global-search.controller.ts src/catalog/controllers/global-search.controller.spec.ts
git commit -m "feat(search): add GET /api/search/suggest typeahead endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Режим `name` глобального поиска через индекс + логирование

**Files:**
- Modify: `src/catalog/services/global-search.service.ts:69-72` (+ конструктор)
- Modify: `src/search/search.service.ts` (метод `logNameSearch`)
- Modify: `src/search/entities/search-log.entity.ts` (тип `queryType` + Swagger)
- Test: `src/catalog/services/global-search.service.spec.ts` (добавить/создать `describe` для name-режима)

**Interfaces:**
- Consumes: `NameSearchIndex.suggest()` (Task 4); `SearchService.logNameSearch()` (этот таск).
- Produces: `logNameSearch(entry: { userId?: string|null; query: string; results: number }): void`.

- [ ] **Step 1: Расширить тип queryType**

In `src/search/entities/search-log.entity.ts`:
```ts
  @ApiProperty({
    description: "Тип поиска: 'article' — по артикулу; 'vin' — подбор авто по VIN/FRAME; 'name' — по названию детали",
    example: 'article',
    enum: ['article', 'vin', 'name'],
  })
  @Index()
  @Column({ type: 'varchar', length: 16, default: 'article' })
  queryType: 'article' | 'vin' | 'name';
```
(Миграция не нужна — колонка `varchar(16)` без CHECK.)

- [ ] **Step 2: Добавить logNameSearch (с тестом)**

In `src/search/search.service.ts`, рядом с `logVinSearch`:
```ts
  logNameSearch(entry: {
    userId?: string | null;
    query: string;
    results: number;
  }): void {
    this.logSearch({
      userId: entry.userId ?? null,
      queryType: 'name',
      article: entry.query,
      brand: null,
      totalResults: entry.results,
      suppliersQueried: 0,
      suppliersFailed: 0,
    });
  }
```

- [ ] **Step 3: Написать падающий тест для name-режима**

In `src/catalog/services/global-search.service.spec.ts` (создать при отсутствии) добавить:
```ts
import { GlobalSearchService } from './global-search.service';

describe('GlobalSearchService name mode', () => {
  it('использует NameSearchIndex и логирует name-поиск', async () => {
    const nameIndex = {
      suggest: jest.fn().mockReturnValue([
        { kind: 'category', categoryId: 'ignition', groupId: null, name: 'Свечи зажигания', parentName: null, score: 120 },
        { kind: 'group', categoryId: 'ignition', groupId: '84', name: 'Свечи накаливания', parentName: 'Зажигание', score: 90 },
        { kind: 'category', categoryId: 'ignition', groupId: null, name: 'Свечи зажигания', parentName: null, score: 80 },
      ]),
    };
    const searchService = { logNameSearch: jest.fn() };
    const svc = new GlobalSearchService(
      {} as any, searchService as any, {} as any, {} as any, nameIndex as any,
    );

    const res = await svc.search('свеча');

    expect(res.mode).toBe('name');
    // категории дедуплицированы по id
    expect(res.name?.categories.map((c) => c.id)).toEqual(['ignition']);
    expect(searchService.logNameSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'свеча' }),
    );
  });
});
```
(Порядок аргументов конструктора в тесте привести к фактическому после Step 4.)

- [ ] **Step 4: Запустить тест — убедиться, что падает**

Run: `npm test -- global-search.service`
Expected: FAIL — конструктор не принимает `nameIndex` / всё ещё substring-фильтр.

- [ ] **Step 5: Реализовать name-режим через индекс**

In `src/catalog/services/global-search.service.ts`:
- добавить импорт и в конструктор `NameSearchIndex`:
```ts
import { NameSearchIndex } from '../name-search/name-search-index.service';
```
```ts
constructor(
  private readonly oem: OemCatalogService,
  private readonly searchService: SearchService,
  private readonly parts: PartsIndexService,
  private readonly catalog: PartsCatalogService,
  private readonly nameIndex: NameSearchIndex,
) {}
```
- заменить блок L69-72:
```ts
    const suggestions = this.nameIndex.suggest(q, opts.lang, 20);
    const seen = new Set<string>();
    const categories = suggestions
      .filter((s) => {
        if (seen.has(s.categoryId)) return false;
        seen.add(s.categoryId);
        return true;
      })
      .map((s) => ({ id: s.categoryId, name: s.parentName ?? s.name, image: null }));
    base.name = { categories };
    this.searchService.logNameSearch({
      userId: opts.userId,
      query: q,
      results: suggestions.length,
    });
    return base;
```
Note: для `kind='group'` категория называется по `parentName` (имя категории), для `kind='category'` — по `name`; `parentName ?? s.name` даёт корректную подпись категории. Frontend `SearchResults` (mode=name) рендерит `data.name.categories` со ссылкой на `/catalog/:id` — контракт `GlobalSearchNameDto.categories: CategoryDto[]` сохранён.

- [ ] **Step 6: Запустить тесты — убедиться, что проходят**

Run: `npm test -- global-search`
Expected: PASS (и контроллер, и сервис).

- [ ] **Step 7: Коммит**

```bash
git add src/catalog/services/global-search.service.ts src/catalog/services/global-search.service.spec.ts src/search/search.service.ts src/search/entities/search-log.entity.ts
git commit -m "feat(search): route name-mode global search through NameSearchIndex + log name queries

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Фронт — API-клиент и типы

**Files:**
- Modify: `front/src/types/catalog.ts`
- Modify: `front/src/api.ts`

**Interfaces:**
- Produces:
  - тип `NameSuggestion { kind: 'category'|'group'; categoryId: string; groupId: string|null; name: string; parentName: string|null; score: number }`
  - тип `SuggestResponse { query: string; suggestions: NameSuggestion[] }`
  - `searchApi.suggest(q: string, opts?: { lang?: string; limit?: number }): Promise<SuggestResponse>`

- [ ] **Step 1: Добавить типы**

In `front/src/types/catalog.ts` (рядом с `ActiveSupplier`):
```ts
export interface NameSuggestion {
  kind: 'category' | 'group';
  categoryId: string;
  groupId: string | null;
  name: string;
  parentName: string | null;
  score: number;
}

export interface SuggestResponse {
  query: string;
  suggestions: NameSuggestion[];
}
```

- [ ] **Step 2: Добавить клиент**

In `front/src/api.ts`:
- в импорт типов добавить `SuggestResponse`:
```ts
  SuggestResponse,
```
- в объект `searchApi` (после `global`, до `suppliers`):
```ts
  suggest: (q: string, opts?: { lang?: string; limit?: number }) =>
    apiRequest<SuggestResponse>(
      `/api/search/suggest?${qs({ q, lang: opts?.lang, limit: opts?.limit })}`,
    ),
```

- [ ] **Step 3: Проверить типами**

Run:
```bash
cd /home/mans/projects/Dana/front && npx tsc --noEmit
```
Expected: без ошибок типов.

- [ ] **Step 4: Коммит**

```bash
cd /home/mans/projects/Dana/front
git add src/types/catalog.ts src/api.ts
git commit -m "feat(front): add searchApi.suggest client + NameSuggestion types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Фронт — хук `useSuggest` (дебаунс + query)

**Files:**
- Create: `front/src/hooks/useSuggest.ts`

**Interfaces:**
- Consumes: `searchApi.suggest` (Task 8).
- Produces:
  - `useDebouncedValue<T>(value: T, delayMs: number): T`
  - `useSuggest(query: string): { data?: SuggestResponse; isFetching: boolean }`

- [ ] **Step 1: Реализовать хук**

Create `front/src/hooks/useSuggest.ts`:
```ts
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchApi } from '../api';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function useSuggest(query: string) {
  const q = useDebouncedValue(query.trim(), 200);
  return useQuery({
    queryKey: ['suggest', q],
    queryFn: () => searchApi.suggest(q, { limit: 8 }),
    enabled: q.length >= 2,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Проверить типами**

Run:
```bash
cd /home/mans/projects/Dana/front && npx tsc --noEmit
```
Expected: без ошибок.

- [ ] **Step 3: Коммит**

```bash
cd /home/mans/projects/Dana/front
git add src/hooks/useSuggest.ts
git commit -m "feat(front): add debounced useSuggest hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Фронт — `SearchBox` (дропдаун + клавиатура + навигация) в Header

**Files:**
- Create: `front/src/components/SearchBox.tsx`
- Modify: `front/src/components/Header.tsx` (заменить обе формы на `<SearchBox />`)

**Interfaces:**
- Consumes: `useSuggest` (Task 9); `NameSuggestion` (Task 8); `react-router-dom` `useNavigate`.
- Produces: компонент `SearchBox` (props: `variant?: 'desktop' | 'mobile'`).

- [ ] **Step 1: Реализовать SearchBox**

Create `front/src/components/SearchBox.tsx`:
```tsx
import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Folder } from 'lucide-react';
import { useSuggest } from '../hooks/useSuggest';
import type { NameSuggestion } from '../types/catalog';

interface SearchBoxProps {
  variant?: 'desktop' | 'mobile';
}

/** Навигация по выбранной подсказке: категория -> страница категории,
 * подгруппа -> та же страница с раскрытой группой (CategoryPage читает ?groupId). */
function targetPath(s: NameSuggestion): string {
  return s.kind === 'group' && s.groupId
    ? `/catalog/${s.categoryId}?groupId=${encodeURIComponent(s.groupId)}`
    : `/catalog/${s.categoryId}`;
}

export const SearchBox: React.FC<SearchBoxProps> = ({ variant = 'desktop' }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data } = useSuggest(query);
  const suggestions = data?.suggestions ?? [];

  const go = (path: string) => {
    setOpen(false);
    setActive(-1);
    navigate(path);
  };

  const submitFreeText = () => {
    if (query.trim()) go(`/search?query=${encodeURIComponent(query.trim())}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || suggestions.length === 0) {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitFreeText();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0) go(targetPath(suggestions[active]));
      else submitFreeText();
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  const inputClass =
    variant === 'desktop'
      ? 'w-full py-2.5 px-4 border border-slate-200 rounded-md text-[14px] outline-none focus:border-orange-500'
      : 'w-full py-2.5 px-4 border border-slate-200 rounded-l-md text-[14px] outline-none focus:border-orange-500';

  return (
    <div className="w-full relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitFreeText();
        }}
        className="w-full relative flex items-center"
      >
        <input
          type="text"
          placeholder="Поиск по названию детали, артикулу, OEM-номеру или модели авто..."
          className={inputClass}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="submit"
          className={
            variant === 'desktop'
              ? 'bg-slate-900 text-white px-5 h-full absolute right-0 rounded-r-md border-none font-semibold text-[13px] hover:bg-slate-800 transition-colors'
              : 'bg-slate-900 text-white px-4 rounded-r-md flex items-center justify-center font-semibold text-[13px] absolute right-0 h-full'
          }
        >
          ПОИСК
        </button>
      </form>

      {open && suggestions.length > 0 && (
        <ul
          className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-80 overflow-auto"
          onMouseDown={() => blurTimer.current && clearTimeout(blurTimer.current)}
        >
          {suggestions.map((s, i) => (
            <li key={`${s.kind}:${s.categoryId}:${s.groupId ?? ''}`}>
              <button
                type="button"
                onClick={() => go(targetPath(s))}
                onMouseEnter={() => setActive(i)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[14px] ${
                  i === active ? 'bg-orange-50 text-orange-700' : 'text-slate-800 hover:bg-slate-50'
                }`}
              >
                {s.kind === 'category' ? (
                  <Layers size={15} className="shrink-0 text-slate-400" />
                ) : (
                  <Folder size={15} className="shrink-0 text-slate-400" />
                )}
                <span className="truncate">{s.name}</span>
                {s.kind === 'group' && s.parentName && (
                  <span className="ml-auto text-[12px] text-slate-400 truncate">{s.parentName}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Подключить в Header**

In `front/src/components/Header.tsx`:
- добавить импорт:
```ts
import { SearchBox } from './SearchBox';
```
- удалить локальный `searchQuery`/`handleSearch` state и обе `<form>`-разметки поиска (десктоп-блок `Search Bar (Desktop)` и мобильный `Search Bar (Mobile)`), заменив их на компонент:

Desktop (заменить содержимое блока `{/* Search Bar (Desktop) */}`):
```tsx
        <div className="hidden md:flex flex-grow relative">
          <SearchBox variant="desktop" />
        </div>
```
Mobile (заменить содержимое блока `{/* Search Bar (Mobile) */}`):
```tsx
      <div className="md:hidden px-4 pb-4">
        <SearchBox variant="mobile" />
      </div>
```
- убрать теперь неиспользуемые `searchQuery`, `setSearchQuery`, `handleSearch` и (если больше не нужен) импорт `Search` из lucide в Header. Прогнать `tsc` для отлова неиспользуемого.

- [ ] **Step 3: Проверить типами и сборкой**

Run:
```bash
cd /home/mans/projects/Dana/front && npx tsc --noEmit && npm run build
```
Expected: без ошибок типов и сборки.

- [ ] **Step 4: Ручная проверка в браузере (verify)**

Запустить фронт (`npm run dev`, порт :3000 согласно памяти проекта) и бэкенд (:3100). В строке поиска ввести «свеча»:
- появляется дропдаун с «Свечи зажигания» (категория) и подгруппами;
- ↑/↓ подсвечивает, Enter переходит в `/catalog/ignition` (категория) или `/catalog/ignition?groupId=84` (подгруппа) с раскрытой группой;
- Enter без выбора ведёт на `/search?query=свеча` и показывает категории (mode=name).

- [ ] **Step 5: Коммит**

```bash
cd /home/mans/projects/Dana/front
git add src/components/SearchBox.tsx src/components/Header.tsx
git commit -m "feat(front): typeahead SearchBox with category/group suggestions in Header

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- Живой typeahead → Tasks 9–10. ✓
- Категории + подгруппы → Task 5 (flatten групп в индекс), Task 4/10 (отдача и рендер). ✓
- Стемминг + синонимы + фаззи → Task 1 (стеммер/нормализация/Levenshtein), Task 2 (синонимы), Task 4 (ранжирование). ✓
- Индекс в памяти → Task 4. ✓
- Крон раз в месяц + кэш в БД → Task 3 (таблица), Task 5 (крон `0 0 1 * *`, rebuild через `PartsCatalogService`→`CatalogCacheService`). ✓
- Старт из таблицы (0 запросов) + ленивый первичный билд → Task 5 `onModuleInit`. ✓
- Ручной rebuild-триггер → спека упоминала admin-эндпоинт; в плане реализован `onModuleInit` + крон. **Осознанное сокращение scope:** отдельный admin `POST /rebuild` не включён (YAGNI на первую итерацию; крон+старт покрывают наполнение). При необходимости добавляется отдельным таском (маршрут в GlobalSearchController → `NameIndexBuilder.rebuild()` под RolesGuard admin).
- Эндпоинт `/api/search/suggest` → Task 6. ✓
- Режим name глобального поиска через индекс → Task 7. ✓
- Логирование name-запросов (`queryType='name'`) → Task 7. ✓
- Диплинк в подгруппу через `?groupId=` → Task 10 (`CategoryPage` уже читает `searchParams.get('groupId')`). ✓
- Только `ru`, колонка `lang` заложена → Task 3/4/5. ✓

**2. Placeholder scan:** плейсхолдеров нет; весь код приведён целиком. Единственные «проверь фактическое» пометки (порядок аргументов конструктора GlobalSearchController/GlobalSearchService, способ генерации uuid в миграции) — это сверка с существующим кодом перед правкой, а не отложенная реализация.

**3. Type consistency:**
- `NameSuggestionDto`/`NameSuggestion` — идентичные поля на бэке (Task 4) и фронте (Task 8): `kind, categoryId, groupId, name, parentName, score`. ✓
- `NameSearchIndex.suggest(query, lang?, limit?)` — одинаковая сигнатура в Task 4, вызовах Task 6 и Task 7. ✓
- `NameIndexBuilder.rebuild(lang?)` возвращает `{ categories, groups }` — согласовано с тестом Task 5. ✓
- `reload(lang?)`/`load(lang?)` — согласованы между Task 4 и Task 5. ✓
- `searchApi.suggest(q, opts?)` (Task 8) ↔ `useSuggest` (Task 9) ↔ `SearchBox` (Task 10). ✓
