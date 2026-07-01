import { Injectable } from '@nestjs/common';
import { PartsIndexClient } from '../clients/parts-index.client';
import { CatalogCacheService } from '../cache/catalog-cache.service';
import { CATALOG_TTL } from '../catalog.constants';
import {
  PartAnalogDto,
  PartApplicabilityDto,
  PartBrandDto,
  PartParamGroupDto,
} from '../dto/parts.dto';

/** Normalized entity (card fields) — offers/analogs/applicability are added by ProductCardService. */
export interface PartsEntity {
  id: string | null;
  code: string;
  name: string;
  originalName: string | null;
  brand: PartBrandDto | null;
  description: string | null;
  barcodes: string[];
  images: string[];
  parameters: PartParamGroupDto[];
}

// ---- Raw PartsIndex response shapes (only the fields we consume) ----
interface PiBrand { id: string | number; name: string }
interface PiRelation { id: string | number; code: string; relation: string; brand?: PiBrand }
interface PiCarApply {
  brand: string; model: string; modif: string;
  dateFrom?: number; dateTo?: number; kw?: number; hp?: number; cc?: number;
  body?: string; engCode?: string;
}
interface PiParamValue { value: string }
interface PiParam { title: string; values?: PiParamValue[] }
interface PiParamsGroup { name: string; params?: PiParam[] }
interface PiEntity {
  id?: string | number;
  name?: { id: string; name: string };
  originalName?: string;
  code?: string;
  barcodes?: string[];
  brand?: PiBrand;
  description?: string;
  parameters?: PiParamsGroup[];
  images?: string[];
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && v != null && v !== '' ? n : null;
}

@Injectable()
export class PartsIndexService {
  constructor(
    private readonly client: PartsIndexClient,
    private readonly cache: CatalogCacheService,
  ) {}

  private async get<T>(
    endpoint: string,
    params: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.cache.getOrFetch<T>(
      { provider: 'partsindex', endpoint, params },
      CATALOG_TTL.DYNAMIC_MS,
      async () => (await this.client.request<T>({ path: endpoint, query: params })).data,
    );
  }

  async brandsByCode(code: string): Promise<PartBrandDto[]> {
    const res = await this.get<{ list?: PiBrand[] }>('/brands/by-part-code', { code });
    return (res.list ?? []).map((b) => ({ id: String(b.id), name: b.name }));
  }

  async analogs(params: {
    id?: string;
    code?: string;
    brand?: string;
    types?: string;
  }): Promise<PartAnalogDto[]> {
    const res = await this.get<{ list?: PiRelation[] }>('/relations', {
      id: params.id,
      code: params.code,
      brand: params.brand,
      types: params.types ?? 'all',
    });
    return (res.list ?? []).map((r) => ({
      id: String(r.id),
      code: r.code,
      brand: { id: String(r.brand?.id ?? ''), name: r.brand?.name ?? '' },
      relation: r.relation,
    }));
  }

  async applicability(
    code: string,
    brand: string,
    lang?: string,
  ): Promise<PartApplicabilityDto[]> {
    const res = await this.get<{ list?: PiCarApply[] }>('/cars', { code, brand, lang });
    return (res.list ?? []).map((c) => ({
      brand: c.brand,
      model: c.model,
      modif: c.modif,
      yearFrom: toNum(c.dateFrom),
      yearTo: toNum(c.dateTo),
      kw: toNum(c.kw),
      hp: toNum(c.hp),
      cc: toNum(c.cc),
      body: c.body ?? null,
      engineCode: c.engCode ?? null,
    }));
  }

  async entity(code: string, brand?: string, lang?: string): Promise<PartsEntity | null> {
    const res = await this.get<{ list?: PiEntity[] }>('/entities', { code, brand, lang });
    const e = (res.list ?? [])[0];
    if (!e) return null;
    return {
      id: e.id != null ? String(e.id) : null,
      code: e.code ?? code,
      name: e.name?.name ?? '',
      originalName: e.originalName ?? null,
      brand: e.brand ? { id: String(e.brand.id), name: e.brand.name } : null,
      description: e.description ?? null,
      barcodes: e.barcodes ?? [],
      images: e.images ?? [],
      parameters: (e.parameters ?? []).map((g) => ({
        group: g.name,
        items: (g.params ?? []).map((p) => ({
          title: p.title,
          value: (p.values ?? []).map((v) => v.value).join(', '),
          unit: null,
        })),
      })),
    };
  }
}
