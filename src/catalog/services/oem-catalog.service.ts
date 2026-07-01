import { Injectable } from '@nestjs/common';
import { PartsCatalogsClient } from '../clients/parts-catalogs.client';
import { CatalogCacheService } from '../cache/catalog-cache.service';
import { CATALOG_TTL } from '../catalog.constants';
import {
  OemCarDto,
  OemCarParameterDto,
  OemCatalogDto,
  OemGroupDto,
  OemModelDto,
  OemPartsDto,
  VinCarDto,
  VinValidationDto,
} from '../dto/oem.dto';

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && v != null && v !== '' ? n : null;
}
function img(url: unknown): string | null {
  if (typeof url !== 'string' || url === '') return null;
  return url.startsWith('//') ? `https:${url}` : url;
}
function mapParamPairs(params: any[]): Array<{ key: string; name: string; value: string }> {
  return (params ?? []).map((p) => ({
    key: String(p?.key ?? ''),
    name: String(p?.name ?? ''),
    value: String(p?.value ?? ''),
  }));
}
function mapCar(c: any, fallbackCatalogId?: string): OemCarDto {
  return {
    id: String(c?.id ?? ''),
    catalogId: String(c?.catalogId ?? fallbackCatalogId ?? ''),
    name: String(c?.name ?? ''),
    modelId: c?.modelId != null ? String(c.modelId) : null,
    modelName: c?.modelName ?? null,
    vin: c?.vin ?? null,
    frame: c?.frame ?? null,
    criteria: c?.criteria ?? null,
    brand: c?.brand ?? null,
    groupsTreeAvailable: c?.groupsTreeAvailable === true,
    parameters: mapParamPairs(c?.parameters),
  };
}

@Injectable()
export class OemCatalogService {
  constructor(
    private readonly client: PartsCatalogsClient,
    private readonly cache: CatalogCacheService,
  ) {}

  private headers(lang?: string): Record<string, string> | undefined {
    return lang ? { 'Accept-Language': lang } : undefined;
  }

  private fetch<T>(
    endpoint: string,
    params: Record<string, string | number | boolean | undefined>,
    ttlMs: number,
    map: (raw: { data: any; headers: Record<string, string> }) => T,
    lang?: string,
  ): Promise<T> {
    return this.cache.getOrFetch<T>(
      { provider: 'partscatalogs', endpoint, params: { ...params, lang } },
      ttlMs,
      async () => map(await this.client.request<any>({ path: endpoint, query: params, headers: this.headers(lang) })),
    );
  }

  listCatalogs(lang?: string): Promise<OemCatalogDto[]> {
    return this.fetch('/catalogs/', {}, CATALOG_TTL.REFERENCE_MS, ({ data }) =>
      (data ?? []).map((c: any) => ({
        id: String(c.id),
        name: String(c.name ?? ''),
        modelsCount: toNum(c.modelsCount),
        actuality: c.actuality ?? null,
        hasVinCheck: c.hasVinCheck === true,
        hasFrameCheck: c.hasFrameCheck === true,
      })), lang);
  }

  listModels(catalogId: string, lang?: string): Promise<OemModelDto[]> {
    return this.fetch(`/catalogs/${catalogId}/models/`, {}, CATALOG_TTL.REFERENCE_MS, ({ data }) =>
      (data ?? []).map((m: any) => ({ id: String(m.id), name: String(m.name ?? ''), img: img(m.img) })), lang);
  }

  listCars(
    catalogId: string,
    modelId: string,
    parameter?: string,
    page?: number,
    lang?: string,
  ): Promise<{ items: OemCarDto[]; total: number | null }> {
    return this.fetch(
      `/catalogs/${catalogId}/cars2/`,
      { modelId, parameter, page },
      CATALOG_TTL.DYNAMIC_MS,
      ({ data, headers }) => ({
        items: (data ?? []).map((c: any) => mapCar(c, catalogId)),
        total: numOrNull(headers['x-total-count']),
      }),
      lang,
    );
  }

  carParameters(
    catalogId: string,
    modelId: string,
    parameter?: string,
    lang?: string,
  ): Promise<OemCarParameterDto[]> {
    return this.fetch(
      `/catalogs/${catalogId}/cars-parameters/`,
      { modelId, parameter },
      CATALOG_TTL.DYNAMIC_MS,
      ({ data }) =>
        (data ?? []).map((p: any) => ({
          key: String(p.key ?? ''),
          name: String(p.name ?? ''),
          values: (p.values ?? []).map((v: any) => ({ idx: String(v.idx ?? ''), value: String(v.value ?? '') })),
        })),
      lang,
    );
  }

  getCar(catalogId: string, carId: string, criteria?: string, lang?: string): Promise<OemCarDto | null> {
    return this.fetch(
      `/catalogs/${catalogId}/cars2/${carId}`,
      { criteria },
      CATALOG_TTL.DYNAMIC_MS,
      ({ data }) => (data ? mapCar(data, catalogId) : null),
      lang,
    );
  }

  validateVin(vin: string, lang?: string): Promise<VinValidationDto | null> {
    return this.fetch(
      '/cars/vin-validator',
      { vin },
      CATALOG_TTL.DYNAMIC_MS,
      ({ data }) => {
        const v = (data ?? [])[0];
        if (!v) return null;
        return {
          changed: String(v.changed ?? ''),
          original: String(v.original ?? ''),
          errors: (v.errors ?? []).map((e: any) => ({
            errorCode: String(e.errorCode ?? ''),
            errorTranslate: String(e.errorTranslate ?? ''),
            details: e.details ?? [],
          })),
        };
      },
      lang,
    );
  }

  carsByVin(q: string, catalogs?: string, lang?: string): Promise<VinCarDto[]> {
    return this.fetch(
      '/car/info',
      { q, catalogs },
      CATALOG_TTL.DYNAMIC_MS,
      ({ data }) =>
        (data ?? []).map((c: any) => ({
          catalogId: String(c.catalogId ?? ''),
          carId: c.carId != null ? String(c.carId) : null,
          title: String(c.title ?? ''),
          brand: c.brand ?? null,
          modelId: c.modelId != null ? String(c.modelId) : null,
          modelName: c.modelName ?? null,
          criteria: c.criteria ?? null,
          vin: c.vin ?? null,
          frame: c.frame ?? null,
        })),
      lang,
    );
  }

  groups(
    catalogId: string,
    carId: string,
    groupId?: string,
    criteria?: string,
    lang?: string,
  ): Promise<OemGroupDto[]> {
    return this.fetch(
      `/catalogs/${catalogId}/groups2/`,
      { carId, groupId, criteria },
      CATALOG_TTL.DYNAMIC_MS,
      ({ data }) =>
        (data ?? []).map((g: any) => ({
          id: String(g.id),
          parentId: g.parentId != null ? String(g.parentId) : null,
          name: String(g.name ?? ''),
          img: img(g.img),
          hasSubgroups: g.hasSubgroups === true,
          hasParts: g.hasParts === true,
        })),
      lang,
    );
  }

  parts(
    catalogId: string,
    carId: string,
    groupId: string,
    criteria?: string,
    lang?: string,
  ): Promise<OemPartsDto> {
    return this.fetch(
      `/catalogs/${catalogId}/parts2`,
      { carId, groupId, criteria },
      CATALOG_TTL.DYNAMIC_MS,
      ({ data }) => {
        const d = data ?? {};
        return {
          img: img(d.img),
          imgDescription: d.imgDescription ?? null,
          brand: d.brand ?? null,
          positions: (d.positions ?? []).map((p: any) => {
            const c = p.coordinates ?? [];
            return { number: String(p.number ?? ''), x: toNum(c[0]), y: toNum(c[1]), h: toNum(c[2]), w: toNum(c[3]) };
          }),
          partGroups: (d.partGroups ?? []).map((pg: any) => ({
            name: pg.name ?? null,
            number: pg.number ?? null,
            positionNumber: pg.positionNumber ?? null,
            description: pg.description ?? null,
            parts: (pg.parts ?? []).map((p: any) => ({
              id: String(p.id ?? ''),
              name: String(p.name ?? ''),
              number: String(p.number ?? ''),
              positionNumber: p.positionNumber ?? null,
              notice: p.notice ?? null,
              description: p.description ?? null,
            })),
          })),
        };
      },
      lang,
    );
  }
}
