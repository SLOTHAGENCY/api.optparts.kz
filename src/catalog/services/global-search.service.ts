import { Injectable, Logger } from '@nestjs/common';
import { OemCatalogService } from './oem-catalog.service';
import { PartsIndexService } from './parts-index.service';
import { PartsCatalogService } from './parts-catalog.service';
import { SearchService } from '../../search/search.service';
import { NameSearchIndex } from '../name-search/name-search-index.service';
import { GlobalSearchResultDto, SearchMode } from '../dto/global-search.dto';
import { SearchGroupDto } from '../../search/dto/search-response.dto';
import { isPartInfoEnabled } from '../clients/catalog-config.util';

/** Max number of exact groups enriched with a part image per search (best-effort, quota-bound). */
const MAX_ENRICH = 5;

/** Classify a raw query into the subsystem that should handle it. */
export function classifyQuery(raw: string): SearchMode {
  const q = raw.trim();
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(q)) return 'vin';
  if (q.length >= 3 && !/\s/.test(q) && /[0-9]/.test(q) && /^[\w\-./]+$/.test(q)) {
    return 'article';
  }
  return 'name';
}

export interface GlobalSearchOptions {
  catalogs?: string;
  lang?: string;
  userId?: string;
}

@Injectable()
export class GlobalSearchService {
  private readonly logger = new Logger(GlobalSearchService.name);

  /** PartsIndex "part info" (brand-by-code + image enrichment) — off when PARTSINDEX_PARTINFO_ENABLED=false. */
  private readonly partInfoEnabled = isPartInfoEnabled();

  constructor(
    private readonly oem: OemCatalogService,
    private readonly searchService: SearchService,
    private readonly parts: PartsIndexService,
    private readonly catalog: PartsCatalogService,
    private readonly nameIndex: NameSearchIndex,
  ) {}

  async search(query: string, opts: GlobalSearchOptions = {}): Promise<GlobalSearchResultDto> {
    const q = query.trim();
    const mode = classifyQuery(q);
    const base: GlobalSearchResultDto = { mode, query: q, vin: [], article: null, name: null };

    if (mode === 'vin') {
      base.vin = await this.safe('vin', () => this.oem.carsByVin(q, opts.catalogs, opts.lang), []);
      this.searchService.logVinSearch({
        userId: opts.userId,
        vin: q,
        catalogs: opts.catalogs,
        matchedCars: base.vin.length,
      });
      return base;
    }

    if (mode === 'article') {
      const [brands, search] = await Promise.all([
        this.partInfoEnabled
          ? this.safe('brands', () => this.parts.brandsByCode(q), [])
          : Promise.resolve([]),
        this.safe('offers', () => this.searchService.search(q, undefined, opts.userId), {
          query: { article: q, brand: null },
          exact: [],
          analogs: [],
        }),
      ]);
      await this.enrichExactImages(search.exact);
      base.article = { brands, search };
      return base;
    }

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
  }

  /**
   * Best-effort part-image enrichment for exact match groups only (analogs can number in the
   * thousands and PartsIndex quota is limited). Capped at MAX_ENRICH groups; any failure/null
   * for a given group just leaves that group's image as null — never throws out of search.
   */
  private async enrichExactImages(exact: SearchGroupDto[]): Promise<void> {
    if (!this.partInfoEnabled) return;
    const targets = exact.slice(0, MAX_ENRICH);
    if (exact.length > MAX_ENRICH) {
      this.logger.warn(`Image enrichment capped at ${MAX_ENRICH} exact groups (got ${exact.length})`);
    }
    const results = await Promise.allSettled(
      targets.map((g) => this.parts.entity(g.article, g.brand)),
    );
    results.forEach((r, i) => {
      targets[i].image = r.status === 'fulfilled' ? (r.value?.images?.[0] ?? null) : null;
    });
  }

  private async safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      this.logger.warn(`Global search ${label} failed: ${err?.message ?? err}`);
      return fallback;
    }
  }
}
