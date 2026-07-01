import { Injectable } from '@nestjs/common';
import { PartsIndexClient } from '../clients/parts-index.client';
import { CatalogCacheService } from '../cache/catalog-cache.service';
import { CATALOG_TTL } from '../catalog.constants';
import {
  CarBrandDto,
  CarEngineDto,
  CarGenerationDto,
  CarModelDto,
  CatalogProductDto,
  CatalogProductsDto,
  CategoryDto,
  FacetDto,
  GroupNodeDto,
} from '../dto/catalog.dto';

export interface CatalogQueryContext {
  groupId?: string;
  generationId?: string;
  engineId?: string;
  /** facet filters, keyed by PartsIndex param id -> value */
  filters?: Record<string, string>;
  q?: string;
  lang?: string;
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && v != null && v !== '' ? n : null;
}

/** Recursively normalize a provider group node (field names vary) to {id,name,children}. */
function normalizeGroup(node: any): GroupNodeDto {
  const kids: any[] = node?.children ?? node?.subGroups ?? node?.subgroups ?? node?.groups ?? [];
  return {
    id: String(node?.id ?? ''),
    name: String(node?.name ?? ''),
    children: Array.isArray(kids) ? kids.map(normalizeGroup) : [],
  };
}

@Injectable()
export class PartsCatalogService {
  constructor(
    private readonly client: PartsIndexClient,
    private readonly cache: CatalogCacheService,
  ) {}

  private async get<T>(
    endpoint: string,
    params: Record<string, string | number | boolean | undefined>,
    ttlMs: number,
  ): Promise<T> {
    return this.cache.getOrFetch<T>(
      { provider: 'partsindex', endpoint, params },
      ttlMs,
      async () => (await this.client.request<T>({ path: endpoint, query: params })).data,
    );
  }

  /** Bracketed query keys PartsIndex expects for car scope + facet filters. */
  private scopeParams(ctx: CatalogQueryContext): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    if (ctx.groupId) out['groupId'] = ctx.groupId;
    if (ctx.generationId) out['car[generationId]'] = ctx.generationId;
    if (ctx.engineId) out['car[engineId]'] = ctx.engineId;
    if (ctx.q) out['q'] = ctx.q;
    if (ctx.lang) out['lang'] = ctx.lang;
    for (const [id, value] of Object.entries(ctx.filters ?? {})) {
      out[`params[${id}]`] = value;
    }
    return out;
  }

  async listCategories(lang?: string): Promise<CategoryDto[]> {
    const res = await this.get<{ list?: any[] }>('/catalogs', { lang }, CATALOG_TTL.REFERENCE_MS);
    return (res.list ?? []).map((c) => ({
      id: String(c.id),
      name: String(c.name ?? ''),
      image: c.image ?? null,
    }));
  }

  async groups(catalogId: string, lang?: string): Promise<GroupNodeDto[]> {
    const res = await this.get<any>(`/catalogs/${catalogId}/groups`, { lang }, CATALOG_TTL.REFERENCE_MS);
    const nodes: any[] = Array.isArray(res) ? res : (res?.list ?? []);
    return nodes.map(normalizeGroup);
  }

  async suggest(catalogId: string, groupId: string, q: string): Promise<string[]> {
    const res = await this.get<{ list?: Array<{ text: string }> }>(
      `/catalogs/${catalogId}/suggest`,
      { groupId, q },
      CATALOG_TTL.DYNAMIC_MS,
    );
    return (res.list ?? []).map((s) => s.text);
  }

  async params(catalogId: string, ctx: CatalogQueryContext): Promise<FacetDto[]> {
    const res = await this.get<{ list?: any[] }>(
      `/catalogs/${catalogId}/params`,
      this.scopeParams(ctx),
      CATALOG_TTL.DYNAMIC_MS,
    );
    return (res.list ?? []).map((p) => ({
      id: String(p.id),
      code: String(p.code ?? ''),
      name: String(p.name ?? ''),
      type: String(p.type ?? 'select'),
      values: (p.values ?? []).map((v: any) => ({
        value: String(v.value ?? ''),
        title: String(v.title ?? v.value ?? ''),
        available: v.available !== false,
        selected: v.selected === true,
      })),
    }));
  }

  async products(
    catalogId: string,
    ctx: CatalogQueryContext,
    page = 1,
    limit = 25,
  ): Promise<CatalogProductsDto> {
    const res = await this.get<any>(
      `/catalogs/${catalogId}/entities`,
      { ...this.scopeParams(ctx), page, limit },
      CATALOG_TTL.DYNAMIC_MS,
    );
    const pageInfo = res?.pagination?.page ?? {};
    const items: CatalogProductDto[] = (res?.list ?? []).map((e: any) => ({
      id: String(e.id),
      code: String(e.code ?? ''),
      name: String(e.name?.name ?? ''),
      originalName: e.originalName ?? null,
      brand: e.brand ? { id: String(e.brand.id), name: e.brand.name } : null,
      images: e.images ?? [],
    }));
    return {
      limit: toNum(res?.pagination?.limit) ?? limit,
      page: {
        prev: toNum(pageInfo.prev),
        current: toNum(pageInfo.current) ?? page,
        next: toNum(pageInfo.next),
      },
      items,
    };
  }

  async carBrands(q?: string): Promise<CarBrandDto[]> {
    const res = await this.get<{ list?: any[] }>('/car/brands', { q }, CATALOG_TTL.REFERENCE_MS);
    return (res.list ?? []).map((b) => ({ id: String(b.id), name: String(b.name ?? '') }));
  }

  async carModels(brandId: string): Promise<CarModelDto[]> {
    const res = await this.get<{ list?: any[] }>(
      `/car/brands/${brandId}/models`,
      {},
      CATALOG_TTL.REFERENCE_MS,
    );
    return (res.list ?? []).map((m) => ({
      id: String(m.id),
      name: String(m.name ?? ''),
      image: m.image ?? null,
    }));
  }

  async carGenerations(brandId: string, modelId: string, lang?: string): Promise<CarGenerationDto[]> {
    const res = await this.get<{ list?: any[] }>(
      `/car/brands/${brandId}/models/${modelId}/generations`,
      { lang },
      CATALOG_TTL.REFERENCE_MS,
    );
    return (res.list ?? []).map((g) => ({
      id: String(g.id),
      name: String(g.name ?? ''),
      yearFrom: toNum(g.yearBegin),
      yearTo: toNum(g.yearEnd),
    }));
  }

  async carEngines(brandId: string, modelId: string, generationId: string): Promise<CarEngineDto[]> {
    const res = await this.get<{ list?: any[] }>(
      `/car/brands/${brandId}/models/${modelId}/generations/${generationId}/engines`,
      {},
      CATALOG_TTL.REFERENCE_MS,
    );
    return (res.list ?? []).map((e) => ({
      id: String(e.id),
      code: e.code ?? null,
      hp: toNum(e.hp),
      kw: toNum(e.kw),
      cc: toNum(e.cc),
    }));
  }
}
