# WT-1 `catalog-core` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared infrastructure for the two-provider catalog integration (parts-catalogs.com + PartsIndex): HTTP clients with auth/error mapping, a DB-backed response cache, rate limiting, config resolution, and the Nest module wiring — with no business endpoints yet.

**Architecture:** A single `CatalogHttpClient` performs raw HTTP with the provider's `Authorization: <key>` header (no `Bearer`), maps upstream HTTP/error codes to typed exceptions, and detects the PartsIndex quota state. Two injectable provider clients (`PartsIndexClient`, `PartsCatalogsClient`) wrap it with env-based config and rate limiting via the existing `RateLimiterRegistry`. A `CatalogCacheService` backed by a `catalog_cache` table provides get-or-fetch caching keyed by `(provider, endpoint, paramsHash)` with per-call TTL, protecting the paid/limited quotas. All wired in `CatalogModule`.

**Tech Stack:** NestJS 10, TypeORM 0.3 (PostgreSQL), axios 1.x, Jest + ts-jest. Follows existing repo patterns (manual migrations registered in `app.module.ts` + `src/config/data-source.ts`; `.spec.ts` unit tests with mocked axios; `RateLimiter`/`RateLimiterRegistry` from `src/suppliers/`).

## Global Constraints

- Provider bases: PartsIndex `https://api.parts-index.com/v1`; parts-catalogs `https://api.parts-catalogs.com/v1`. Override via env.
- Auth header for BOTH providers: `Authorization: <raw key>` — **no `Bearer` prefix**.
- PartsIndex error shape: `{ code: number, message: string }`. `403` with `code === 1004` = quota exceeded; `code === 1006` = no auth data.
- parts-catalogs error shape: `{ code: number, errorCode: string, message: string }`. `403` = access deny (not quota).
- Cache TTL defaults: reference data (`catalogs`, `car/brands`, `models`) = 7 days; car/node/part/analog/card data = 24 h. Callers pass the TTL explicitly.
- New TypeORM entities MUST be registered in BOTH `src/app.module.ts` (TypeOrmModule.forRootAsync `entities: [...]`) and `src/config/data-source.ts` (`entities: [...]`).
- Migration filenames use a timestamp prefix; next free number is `1700000000019`. App runtime loads migrations from `dist/migrations/*.js`; the migration script runs from `src/migrations/*.ts` via `data-source.ts`.
- Test command: `npx jest <path>` (rootDir is `src`; testRegex `.*\.spec\.ts$`).
- Do not modify `src/suppliers/*` or `src/search/*` in WT-1.

---

## File Structure

- `src/catalog/clients/catalog-errors.ts` — typed exceptions (`CatalogQuotaExceededException`, `CatalogUpstreamException`, `CatalogConfigException`).
- `src/catalog/clients/catalog-config.util.ts` — `resolveCatalogConfig(provider)` from env.
- `src/catalog/clients/catalog-http.client.ts` — `CatalogHttpClient` (raw HTTP + auth + error mapping + quota detection).
- `src/catalog/clients/parts-index.client.ts` — `PartsIndexClient` (injectable, config + rate limit).
- `src/catalog/clients/parts-catalogs.client.ts` — `PartsCatalogsClient` (injectable, config + rate limit).
- `src/catalog/cache/catalog-cache.entity.ts` — `CatalogCache` entity.
- `src/catalog/cache/catalog-cache.service.ts` — `CatalogCacheService.getOrFetch(...)`.
- `src/catalog/catalog.module.ts` — module wiring.
- `src/migrations/1700000000019-CreateCatalogCache.ts` — table migration.
- Modify: `src/app.module.ts`, `src/config/data-source.ts` — register entity + module.
- Tests: co-located `*.spec.ts` next to each unit.

---

## Task 1: Catalog config resolver

**Files:**
- Create: `src/catalog/clients/catalog-config.util.ts`
- Test: `src/catalog/clients/catalog-config.util.spec.ts`

**Interfaces:**
- Consumes: nothing (reads `process.env`).
- Produces:
  - `type CatalogProvider = 'partsindex' | 'partscatalogs'`
  - `interface CatalogClientConfig { baseUrl: string; apiKey: string; timeoutMs: number; rpm: number | null }`
  - `function resolveCatalogConfig(provider: CatalogProvider, env?: NodeJS.ProcessEnv): CatalogClientConfig`

- [ ] **Step 1: Write the failing test**

```ts
// src/catalog/clients/catalog-config.util.spec.ts
import { resolveCatalogConfig } from './catalog-config.util';

describe('resolveCatalogConfig', () => {
  it('uses defaults when env is empty', () => {
    const cfg = resolveCatalogConfig('partsindex', {});
    expect(cfg.baseUrl).toBe('https://api.parts-index.com/v1');
    expect(cfg.apiKey).toBe('');
    expect(cfg.timeoutMs).toBe(15000);
    expect(cfg.rpm).toBeNull();
  });

  it('reads PartsIndex env overrides', () => {
    const cfg = resolveCatalogConfig('partsindex', {
      PARTSINDEX_API_URL: 'http://local/v1',
      PARTSINDEX_API_KEY: 'PI-KEY',
      PARTSINDEX_TIMEOUT_MS: '5000',
      PARTSINDEX_RPM: '60',
    });
    expect(cfg).toEqual({ baseUrl: 'http://local/v1', apiKey: 'PI-KEY', timeoutMs: 5000, rpm: 60 });
  });

  it('reads parts-catalogs env and defaults its base', () => {
    const cfg = resolveCatalogConfig('partscatalogs', { PARTSCATALOGS_API_KEY: 'OEM-KEY' });
    expect(cfg.baseUrl).toBe('https://api.parts-catalogs.com/v1');
    expect(cfg.apiKey).toBe('OEM-KEY');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/catalog/clients/catalog-config.util.spec.ts`
Expected: FAIL — `Cannot find module './catalog-config.util'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/catalog/clients/catalog-config.util.ts
export type CatalogProvider = 'partsindex' | 'partscatalogs';

export interface CatalogClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  rpm: number | null;
}

const DEFAULTS: Record<CatalogProvider, { baseUrl: string; prefix: string }> = {
  partsindex: { baseUrl: 'https://api.parts-index.com/v1', prefix: 'PARTSINDEX' },
  partscatalogs: { baseUrl: 'https://api.parts-catalogs.com/v1', prefix: 'PARTSCATALOGS' },
};

export function resolveCatalogConfig(
  provider: CatalogProvider,
  env: NodeJS.ProcessEnv = process.env,
): CatalogClientConfig {
  const { baseUrl, prefix } = DEFAULTS[provider];
  const rawRpm = env[`${prefix}_RPM`];
  const rpm = rawRpm != null && rawRpm !== '' && Number.isFinite(Number(rawRpm)) ? Number(rawRpm) : null;
  const rawTimeout = Number(env[`${prefix}_TIMEOUT_MS`]);
  return {
    baseUrl: (env[`${prefix}_API_URL`] || baseUrl).replace(/\/+$/, ''),
    apiKey: env[`${prefix}_API_KEY`] ?? '',
    timeoutMs: Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 15000,
    rpm,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/catalog/clients/catalog-config.util.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/catalog/clients/catalog-config.util.ts src/catalog/clients/catalog-config.util.spec.ts
git commit -m "feat(catalog): env-based provider config resolver"
```

---

## Task 2: HTTP client core (auth + error mapping + quota detection)

**Files:**
- Create: `src/catalog/clients/catalog-errors.ts`
- Create: `src/catalog/clients/catalog-http.client.ts`
- Test: `src/catalog/clients/catalog-http.client.spec.ts`

**Interfaces:**
- Consumes: `CatalogProvider` from `catalog-config.util`.
- Produces:
  - `class CatalogQuotaExceededException extends ServiceUnavailableException`
  - `class CatalogUpstreamException extends BadGatewayException`
  - `class CatalogConfigException extends InternalServerErrorException`
  - `interface CatalogRequest { path: string; query?: Record<string, string | number | boolean | undefined>; headers?: Record<string, string> }`
  - `interface CatalogResponse<T> { data: T; headers: Record<string, string> }`
  - `class CatalogHttpClient { constructor(cfg: { provider: CatalogProvider; baseUrl: string; apiKey: string; timeoutMs: number; http?: AxiosInstance }); request<T>(req: CatalogRequest): Promise<CatalogResponse<T>> }`

- [ ] **Step 1: Write the failing test**

```ts
// src/catalog/clients/catalog-http.client.spec.ts
import { CatalogHttpClient } from './catalog-http.client';
import {
  CatalogQuotaExceededException,
  CatalogUpstreamException,
  CatalogConfigException,
} from './catalog-errors';
import { NotFoundException, BadRequestException } from '@nestjs/common';

function fakeHttp(impl: (args: any) => Promise<any>) {
  return { request: jest.fn(impl) } as any;
}

const base = { provider: 'partsindex' as const, baseUrl: 'http://api/v1', apiKey: 'PI-KEY', timeoutMs: 1000 };

describe('CatalogHttpClient', () => {
  it('sends the raw key in Authorization (no Bearer) and returns data + lowercased headers', async () => {
    const http = fakeHttp(async () => ({ data: { list: [] }, headers: { 'X-Total-Count': '5' } }));
    const client = new CatalogHttpClient({ ...base, http });
    const res = await client.request<{ list: unknown[] }>({ path: '/brands/by-part-code', query: { code: 'X1', skip: undefined } });

    const call = http.request.mock.calls[0][0];
    expect(call.baseURL).toBe('http://api/v1');
    expect(call.url).toBe('/brands/by-part-code');
    expect(call.headers.Authorization).toBe('PI-KEY');
    expect(call.headers.Authorization).not.toMatch(/Bearer/);
    expect(call.params).toEqual({ code: 'X1' }); // undefined dropped
    expect(res.data).toEqual({ list: [] });
    expect(res.headers['x-total-count']).toBe('5');
  });

  it('maps 403 code 1004 to quota exceeded', async () => {
    const http = fakeHttp(async () => { throw { response: { status: 403, data: { code: 1004, message: 'quota deny' } } }; });
    const client = new CatalogHttpClient({ ...base, http });
    await expect(client.request({ path: '/x' })).rejects.toBeInstanceOf(CatalogQuotaExceededException);
  });

  it('maps other 403 to config exception', async () => {
    const http = fakeHttp(async () => { throw { response: { status: 403, data: { code: 1003, message: 'ip deny' } } }; });
    const client = new CatalogHttpClient({ ...base, http });
    await expect(client.request({ path: '/x' })).rejects.toBeInstanceOf(CatalogConfigException);
  });

  it('maps 401 to config exception', async () => {
    const http = fakeHttp(async () => { throw { response: { status: 401, data: {} } }; });
    const client = new CatalogHttpClient({ ...base, http });
    await expect(client.request({ path: '/x' })).rejects.toBeInstanceOf(CatalogConfigException);
  });

  it('maps 404 to NotFound and 422/400 to BadRequest', async () => {
    const c404 = new CatalogHttpClient({ ...base, http: fakeHttp(async () => { throw { response: { status: 404, data: {} } }; }) });
    await expect(c404.request({ path: '/x' })).rejects.toBeInstanceOf(NotFoundException);
    const c422 = new CatalogHttpClient({ ...base, http: fakeHttp(async () => { throw { response: { status: 422, data: {} } }; }) });
    await expect(c422.request({ path: '/x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps 5xx and network errors to upstream exception', async () => {
    const c500 = new CatalogHttpClient({ ...base, http: fakeHttp(async () => { throw { response: { status: 502, data: {} } }; }) });
    await expect(c500.request({ path: '/x' })).rejects.toBeInstanceOf(CatalogUpstreamException);
    const cNet = new CatalogHttpClient({ ...base, http: fakeHttp(async () => { throw new Error('ECONNRESET'); }) });
    await expect(cNet.request({ path: '/x' })).rejects.toBeInstanceOf(CatalogUpstreamException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/catalog/clients/catalog-http.client.spec.ts`
Expected: FAIL — cannot find `./catalog-http.client`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/catalog/clients/catalog-errors.ts
import {
  BadGatewayException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';

/** Upstream provider quota/limit exhausted (e.g. PartsIndex 403 code 1004). */
export class CatalogQuotaExceededException extends ServiceUnavailableException {
  constructor(message = 'Catalog provider quota exceeded.') {
    super(message);
  }
}

/** Upstream provider unreachable or returned 5xx / network failure. */
export class CatalogUpstreamException extends BadGatewayException {
  constructor(message = 'Catalog provider is unavailable.') {
    super(message);
  }
}

/** Our credentials/access are wrong (401 / access-deny 403) — a config problem, not the client's fault. */
export class CatalogConfigException extends InternalServerErrorException {
  constructor(message = 'Catalog provider access is misconfigured.') {
    super(message);
  }
}
```

```ts
// src/catalog/clients/catalog-http.client.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { CatalogProvider } from './catalog-config.util';
import {
  CatalogConfigException,
  CatalogQuotaExceededException,
  CatalogUpstreamException,
} from './catalog-errors';

export interface CatalogRequest {
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

export interface CatalogResponse<T> {
  data: T;
  headers: Record<string, string>;
}

export interface CatalogHttpConfig {
  provider: CatalogProvider;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  http?: AxiosInstance;
}

export class CatalogHttpClient {
  private readonly http: AxiosInstance;

  constructor(private readonly cfg: CatalogHttpConfig) {
    this.http = cfg.http ?? axios.create();
  }

  async request<T>(req: CatalogRequest): Promise<CatalogResponse<T>> {
    const params: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (v !== undefined) params[k] = v;
    }
    try {
      const res = await this.http.request({
        method: 'GET',
        baseURL: this.cfg.baseUrl,
        url: req.path,
        params,
        timeout: this.cfg.timeoutMs,
        headers: { Authorization: this.cfg.apiKey, Accept: 'application/json', ...req.headers },
      });
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers ?? {})) {
        headers[k.toLowerCase()] = String(v);
      }
      return { data: res.data as T, headers };
    } catch (err: any) {
      throw this.mapError(err);
    }
  }

  private mapError(err: any): Error {
    const status: number | undefined = err?.response?.status;
    const body = err?.response?.data;
    if (status == null) return new CatalogUpstreamException();
    if (status === 403 && Number(body?.code) === 1004) return new CatalogQuotaExceededException();
    if (status === 401 || status === 403) return new CatalogConfigException();
    if (status === 404) return new NotFoundException('Not found in catalog provider.');
    if (status === 400 || status === 422) return new BadRequestException('Invalid catalog request.');
    return new CatalogUpstreamException();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/catalog/clients/catalog-http.client.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/catalog/clients/catalog-errors.ts src/catalog/clients/catalog-http.client.ts src/catalog/clients/catalog-http.client.spec.ts
git commit -m "feat(catalog): HTTP client core with auth and error mapping"
```

---

## Task 3: Provider clients (rate-limited, config-driven)

**Files:**
- Create: `src/catalog/clients/parts-index.client.ts`
- Create: `src/catalog/clients/parts-catalogs.client.ts`
- Test: `src/catalog/clients/provider-clients.spec.ts`

**Interfaces:**
- Consumes: `RateLimiterRegistry` from `../../suppliers/rate-limiter.registry`; `CatalogHttpClient`, `CatalogRequest`, `CatalogResponse` from `./catalog-http.client`; `resolveCatalogConfig` from `./catalog-config.util`.
- Produces:
  - `class PartsIndexClient { constructor(rateLimiter: RateLimiterRegistry, http?: CatalogHttpClient); isConfigured(): boolean; request<T>(req: CatalogRequest): Promise<CatalogResponse<T>> }`
  - `class PartsCatalogsClient { constructor(rateLimiter: RateLimiterRegistry, http?: CatalogHttpClient); isConfigured(): boolean; request<T>(req: CatalogRequest): Promise<CatalogResponse<T>> }`
  - Both are `@Injectable()`. `request` gates through `RateLimiterRegistry.gate(<code>, rpm, fn)` with code `partsindex` / `partscatalogs`.

- [ ] **Step 1: Write the failing test**

```ts
// src/catalog/clients/provider-clients.spec.ts
import { PartsIndexClient } from './parts-index.client';
import { PartsCatalogsClient } from './parts-catalogs.client';
import { RateLimiterRegistry } from '../../suppliers/rate-limiter.registry';

describe('provider clients', () => {
  it('PartsIndexClient gates through the rate limiter and delegates to http', async () => {
    const registry = new RateLimiterRegistry();
    const gate = jest.spyOn(registry, 'gate');
    const http = { request: jest.fn(async () => ({ data: { ok: 1 }, headers: {} })) } as any;
    const client = new PartsIndexClient(registry, http);

    const res = await client.request({ path: '/brands/by-part-code', query: { code: 'X' } });

    expect(gate).toHaveBeenCalledWith('partsindex', expect.anything(), expect.any(Function));
    expect(http.request).toHaveBeenCalledWith({ path: '/brands/by-part-code', query: { code: 'X' } });
    expect(res.data).toEqual({ ok: 1 });
  });

  it('PartsCatalogsClient uses the partscatalogs limiter code', async () => {
    const registry = new RateLimiterRegistry();
    const gate = jest.spyOn(registry, 'gate');
    const http = { request: jest.fn(async () => ({ data: {}, headers: {} })) } as any;
    const client = new PartsCatalogsClient(registry, http);
    await client.request({ path: '/catalogs/' });
    expect(gate).toHaveBeenCalledWith('partscatalogs', expect.anything(), expect.any(Function));
  });

  it('isConfigured reflects presence of the API key', () => {
    const prev = process.env.PARTSINDEX_API_KEY;
    process.env.PARTSINDEX_API_KEY = '';
    expect(new PartsIndexClient(new RateLimiterRegistry()).isConfigured()).toBe(false);
    process.env.PARTSINDEX_API_KEY = 'PI-KEY';
    expect(new PartsIndexClient(new RateLimiterRegistry()).isConfigured()).toBe(true);
    process.env.PARTSINDEX_API_KEY = prev;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/catalog/clients/provider-clients.spec.ts`
Expected: FAIL — cannot find `./parts-index.client`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/catalog/clients/parts-index.client.ts
import { Injectable } from '@nestjs/common';
import { RateLimiterRegistry } from '../../suppliers/rate-limiter.registry';
import { resolveCatalogConfig } from './catalog-config.util';
import { CatalogHttpClient, CatalogRequest, CatalogResponse } from './catalog-http.client';

@Injectable()
export class PartsIndexClient {
  private readonly http: CatalogHttpClient;
  private readonly rpm: number | null;

  constructor(
    private readonly rateLimiter: RateLimiterRegistry,
    http?: CatalogHttpClient,
  ) {
    const cfg = resolveCatalogConfig('partsindex');
    this.rpm = cfg.rpm;
    this.http = http ?? new CatalogHttpClient({ provider: 'partsindex', ...cfg });
  }

  isConfigured(): boolean {
    return resolveCatalogConfig('partsindex').apiKey.trim() !== '';
  }

  request<T>(req: CatalogRequest): Promise<CatalogResponse<T>> {
    return this.rateLimiter.gate('partsindex', this.rpm, () => this.http.request<T>(req));
  }
}
```

```ts
// src/catalog/clients/parts-catalogs.client.ts
import { Injectable } from '@nestjs/common';
import { RateLimiterRegistry } from '../../suppliers/rate-limiter.registry';
import { resolveCatalogConfig } from './catalog-config.util';
import { CatalogHttpClient, CatalogRequest, CatalogResponse } from './catalog-http.client';

@Injectable()
export class PartsCatalogsClient {
  private readonly http: CatalogHttpClient;
  private readonly rpm: number | null;

  constructor(
    private readonly rateLimiter: RateLimiterRegistry,
    http?: CatalogHttpClient,
  ) {
    const cfg = resolveCatalogConfig('partscatalogs');
    this.rpm = cfg.rpm;
    this.http = http ?? new CatalogHttpClient({ provider: 'partscatalogs', ...cfg });
  }

  isConfigured(): boolean {
    return resolveCatalogConfig('partscatalogs').apiKey.trim() !== '';
  }

  request<T>(req: CatalogRequest): Promise<CatalogResponse<T>> {
    return this.rateLimiter.gate('partscatalogs', this.rpm, () => this.http.request<T>(req));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/catalog/clients/provider-clients.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/catalog/clients/parts-index.client.ts src/catalog/clients/parts-catalogs.client.ts src/catalog/clients/provider-clients.spec.ts
git commit -m "feat(catalog): rate-limited PartsIndex and parts-catalogs clients"
```

---

## Task 4: Cache entity + migration + registration

**Files:**
- Create: `src/catalog/cache/catalog-cache.entity.ts`
- Create: `src/migrations/1700000000019-CreateCatalogCache.ts`
- Modify: `src/app.module.ts` (import entity; add to `entities: [...]`)
- Modify: `src/config/data-source.ts` (import entity; add to `entities: [...]`)
- Test: `src/catalog/cache/catalog-cache.entity.spec.ts`

**Interfaces:**
- Produces: `class CatalogCache { id: string; provider: string; endpoint: string; paramsHash: string; payload: unknown; createdAt: Date; expiresAt: Date }` — table `catalog_cache`, unique `(provider, endpoint, paramsHash)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/catalog/cache/catalog-cache.entity.spec.ts
import { CatalogCache } from './catalog-cache.entity';
import { getMetadataArgsStorage } from 'typeorm';

describe('CatalogCache entity', () => {
  it('maps to the catalog_cache table', () => {
    const table = getMetadataArgsStorage().tables.find((t) => t.target === CatalogCache);
    expect(table?.name).toBe('catalog_cache');
  });

  it('declares the expected columns', () => {
    const cols = getMetadataArgsStorage()
      .columns.filter((c) => c.target === CatalogCache)
      .map((c) => c.propertyName);
    expect(cols).toEqual(
      expect.arrayContaining(['id', 'provider', 'endpoint', 'paramsHash', 'payload', 'createdAt', 'expiresAt']),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/catalog/cache/catalog-cache.entity.spec.ts`
Expected: FAIL — cannot find `./catalog-cache.entity`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/catalog/cache/catalog-cache.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('catalog_cache')
@Index('UQ_catalog_cache_key', ['provider', 'endpoint', 'paramsHash'], { unique: true })
export class CatalogCache {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32 })
  provider: string;

  @Column({ type: 'varchar', length: 255 })
  endpoint: string;

  @Column({ type: 'varchar', length: 64 })
  paramsHash: string;

  @Column({ type: 'jsonb' })
  payload: unknown;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp' })
  expiresAt: Date;
}
```

```ts
// src/migrations/1700000000019-CreateCatalogCache.ts
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateCatalogCache1700000000019 implements MigrationInterface {
  name = 'CreateCatalogCache1700000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'catalog_cache',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'provider', type: 'varchar', length: '32' },
          { name: 'endpoint', type: 'varchar', length: '255' },
          { name: 'paramsHash', type: 'varchar', length: '64' },
          { name: 'payload', type: 'jsonb' },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'expiresAt', type: 'timestamp' },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'catalog_cache',
      new TableIndex({ name: 'UQ_catalog_cache_key', columnNames: ['provider', 'endpoint', 'paramsHash'], isUnique: true }),
    );
    await queryRunner.createIndex(
      'catalog_cache',
      new TableIndex({ name: 'IDX_catalog_cache_expiresAt', columnNames: ['expiresAt'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('catalog_cache');
  }
}
```

- [ ] **Step 4: Register the entity in the two entity arrays**

In `src/app.module.ts`: add `import { CatalogCache } from './catalog/cache/catalog-cache.entity';` and append `CatalogCache` to the `entities: [...]` array of `TypeOrmModule.forRootAsync`.

In `src/config/data-source.ts`: add the same import and append `CatalogCache` to its `entities: [...]` array.

- [ ] **Step 5: Run test + build to verify**

Run: `npx jest src/catalog/cache/catalog-cache.entity.spec.ts`
Expected: PASS (2 tests).
Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/catalog/cache/catalog-cache.entity.ts src/catalog/cache/catalog-cache.entity.spec.ts src/migrations/1700000000019-CreateCatalogCache.ts src/app.module.ts src/config/data-source.ts
git commit -m "feat(catalog): catalog_cache entity + migration + registration"
```

---

## Task 5: Cache service (get-or-fetch, hashing, TTL)

**Files:**
- Create: `src/catalog/cache/catalog-cache.service.ts`
- Test: `src/catalog/cache/catalog-cache.service.spec.ts`

**Interfaces:**
- Consumes: `CatalogCache` entity + its TypeORM `Repository`; `CatalogProvider` from `../clients/catalog-config.util`.
- Produces:
  - `interface CatalogCacheKey { provider: CatalogProvider; endpoint: string; params: Record<string, unknown> }`
  - `class CatalogCacheService { constructor(repo: Repository<CatalogCache>, clock?: () => number); getOrFetch<T>(key: CatalogCacheKey, ttlMs: number, fetchFn: () => Promise<T>): Promise<T> }`
  - Behavior: returns cached `payload` when a row exists and `expiresAt > now`; otherwise calls `fetchFn`, upserts `(provider, endpoint, paramsHash) → payload, expiresAt = now + ttlMs`, and returns the fresh value. `paramsHash` = sha256 hex of the stable-sorted JSON of `params`.

- [ ] **Step 1: Write the failing test**

```ts
// src/catalog/cache/catalog-cache.service.spec.ts
import { CatalogCacheService } from './catalog-cache.service';

function repoMock(row: any = null) {
  return {
    findOne: jest.fn(async () => row),
    upsert: jest.fn(async () => ({})),
  } as any;
}

const key = { provider: 'partsindex' as const, endpoint: '/brands', params: { code: 'X' } };

describe('CatalogCacheService', () => {
  it('fetches and upserts on a cache miss', async () => {
    const repo = repoMock(null);
    let now = 1000;
    const svc = new CatalogCacheService(repo, () => now);
    const fetchFn = jest.fn(async () => ({ list: [1] }));

    const out = await svc.getOrFetch(key, 5000, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ list: [1] });
    const [entity, conflict] = repo.upsert.mock.calls[0];
    expect(entity.provider).toBe('partsindex');
    expect(entity.endpoint).toBe('/brands');
    expect(entity.paramsHash).toHaveLength(64);
    expect(new Date(entity.expiresAt).getTime()).toBe(6000);
    expect(conflict).toEqual(['provider', 'endpoint', 'paramsHash']);
  });

  it('returns cached payload without fetching when not expired', async () => {
    const repo = repoMock({ payload: { cached: true }, expiresAt: new Date(10_000) });
    const svc = new CatalogCacheService(repo, () => 5000);
    const fetchFn = jest.fn(async () => ({ cached: false }));

    const out = await svc.getOrFetch(key, 5000, fetchFn);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(out).toEqual({ cached: true });
  });

  it('refetches when the row is expired', async () => {
    const repo = repoMock({ payload: { cached: true }, expiresAt: new Date(4000) });
    const svc = new CatalogCacheService(repo, () => 5000);
    const fetchFn = jest.fn(async () => ({ fresh: true }));

    const out = await svc.getOrFetch(key, 5000, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ fresh: true });
  });

  it('hashes params order-independently', async () => {
    const repo = repoMock(null);
    const svc = new CatalogCacheService(repo, () => 0);
    await svc.getOrFetch({ ...key, params: { a: 1, b: 2 } }, 1, async () => 1);
    await svc.getOrFetch({ ...key, params: { b: 2, a: 1 } }, 1, async () => 1);
    expect(repo.upsert.mock.calls[0][0].paramsHash).toBe(repo.upsert.mock.calls[1][0].paramsHash);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/catalog/cache/catalog-cache.service.spec.ts`
Expected: FAIL — cannot find `./catalog-cache.service`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/catalog/cache/catalog-cache.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { CatalogCache } from './catalog-cache.entity';
import { CatalogProvider } from '../clients/catalog-config.util';

export interface CatalogCacheKey {
  provider: CatalogProvider;
  endpoint: string;
  params: Record<string, unknown>;
}

@Injectable()
export class CatalogCacheService {
  constructor(
    @InjectRepository(CatalogCache)
    private readonly repo: Repository<CatalogCache>,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async getOrFetch<T>(key: CatalogCacheKey, ttlMs: number, fetchFn: () => Promise<T>): Promise<T> {
    const paramsHash = this.hash(key.params);
    const now = this.clock();
    const row = await this.repo.findOne({
      where: { provider: key.provider, endpoint: key.endpoint, paramsHash },
    });
    if (row && new Date(row.expiresAt).getTime() > now) {
      return row.payload as T;
    }
    const value = await fetchFn();
    await this.repo.upsert(
      {
        provider: key.provider,
        endpoint: key.endpoint,
        paramsHash,
        payload: value as unknown,
        expiresAt: new Date(now + ttlMs),
      },
      ['provider', 'endpoint', 'paramsHash'],
    );
    return value;
  }

  private hash(params: Record<string, unknown>): string {
    const stable = JSON.stringify(params, Object.keys(params).sort());
    return createHash('sha256').update(stable).digest('hex');
  }
}
```

> Note: `JSON.stringify(value, replacerArray)` uses the sorted key array as an allow-list applied at every level, giving order-independent output for flat param maps (the shape used by callers).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/catalog/cache/catalog-cache.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/catalog/cache/catalog-cache.service.ts src/catalog/cache/catalog-cache.service.spec.ts
git commit -m "feat(catalog): DB-backed get-or-fetch cache service"
```

---

## Task 6: Module wiring

**Files:**
- Create: `src/catalog/catalog.module.ts`
- Modify: `src/app.module.ts` (import + register `CatalogModule`)
- Test: `src/catalog/catalog.module.spec.ts`

**Interfaces:**
- Consumes: all of the above.
- Produces: `class CatalogModule` — provides & exports `PartsIndexClient`, `PartsCatalogsClient`, `CatalogCacheService`; provides `RateLimiterRegistry`; imports `TypeOrmModule.forFeature([CatalogCache])`.

- [ ] **Step 1: Write the failing test**

```ts
// src/catalog/catalog.module.spec.ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CatalogModule } from './catalog.module';
import { CatalogCache } from './cache/catalog-cache.entity';
import { CatalogCacheService } from './cache/catalog-cache.service';
import { PartsIndexClient } from './clients/parts-index.client';
import { PartsCatalogsClient } from './clients/parts-catalogs.client';

describe('CatalogModule', () => {
  it('resolves the provider clients and cache service', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [CatalogModule] })
      .overrideProvider(getRepositoryToken(CatalogCache))
      .useValue({ findOne: jest.fn(), upsert: jest.fn() })
      .compile();

    expect(moduleRef.get(PartsIndexClient)).toBeInstanceOf(PartsIndexClient);
    expect(moduleRef.get(PartsCatalogsClient)).toBeInstanceOf(PartsCatalogsClient);
    expect(moduleRef.get(CatalogCacheService)).toBeInstanceOf(CatalogCacheService);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/catalog/catalog.module.spec.ts`
Expected: FAIL — cannot find `./catalog.module`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/catalog/catalog.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogCache } from './cache/catalog-cache.entity';
import { CatalogCacheService } from './cache/catalog-cache.service';
import { PartsIndexClient } from './clients/parts-index.client';
import { PartsCatalogsClient } from './clients/parts-catalogs.client';
import { RateLimiterRegistry } from '../suppliers/rate-limiter.registry';

@Module({
  imports: [TypeOrmModule.forFeature([CatalogCache])],
  providers: [RateLimiterRegistry, PartsIndexClient, PartsCatalogsClient, CatalogCacheService],
  exports: [PartsIndexClient, PartsCatalogsClient, CatalogCacheService],
})
export class CatalogModule {}
```

- [ ] **Step 4: Register the module in the app**

In `src/app.module.ts`: add `import { CatalogModule } from './catalog/catalog.module';` and append `CatalogModule` to the top-level `imports: [...]` array (after `SettingsModule`).

- [ ] **Step 5: Run test + full suite + build**

Run: `npx jest src/catalog/catalog.module.spec.ts`
Expected: PASS (1 test).
Run: `npx jest`
Expected: all suites pass (existing + new catalog specs).
Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/catalog/catalog.module.ts src/catalog/catalog.module.spec.ts src/app.module.ts
git commit -m "feat(catalog): wire CatalogModule into the app"
```

---

## Self-Review Notes

- **Spec coverage (WT-1 scope):** clients w/ auth (Tasks 2–3), error mapping incl. quota guard (Task 2), DB cache + TTL (Tasks 4–5), rate-limit reuse (Task 3), config/secrets via env (Task 1), module wiring (Task 6). Business services/controllers are intentionally out of scope — they belong to WT-2/3/4/5.
- **Deferred from spec §4:** `Settings`-based config override (WT-1 uses env only); services' DTO normalization; the `X-Message`/empty-list interpretation and `X-Total-Count` reading are surfaced via `CatalogResponse.headers` for consumers — no special handling needed in core.
- **Type consistency:** `CatalogProvider`, `CatalogRequest`, `CatalogResponse<T>`, `CatalogHttpClient`, `PartsIndexClient.request`, `PartsCatalogsClient.request`, `CatalogCacheService.getOrFetch` names are used identically across tasks and match the exports each task produces.
