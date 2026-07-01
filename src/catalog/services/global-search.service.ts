import { Injectable, Logger } from '@nestjs/common';
import { OemCatalogService } from './oem-catalog.service';
import { PartsIndexService } from './parts-index.service';
import { PartsCatalogService } from './parts-catalog.service';
import { SearchService } from '../../search/search.service';
import { GlobalSearchResultDto, SearchMode } from '../dto/global-search.dto';

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

  constructor(
    private readonly oem: OemCatalogService,
    private readonly searchService: SearchService,
    private readonly parts: PartsIndexService,
    private readonly catalog: PartsCatalogService,
  ) {}

  async search(query: string, opts: GlobalSearchOptions = {}): Promise<GlobalSearchResultDto> {
    const q = query.trim();
    const mode = classifyQuery(q);
    const base: GlobalSearchResultDto = { mode, query: q, vin: [], article: null, name: null };

    if (mode === 'vin') {
      base.vin = await this.safe('vin', () => this.oem.carsByVin(q, opts.catalogs, opts.lang), []);
      return base;
    }

    if (mode === 'article') {
      const [brands, search] = await Promise.all([
        this.safe('brands', () => this.parts.brandsByCode(q), []),
        this.safe('offers', () => this.searchService.search(q, undefined, opts.userId), {
          query: { article: q, brand: null },
          exact: [],
          analogs: [],
        }),
      ]);
      base.article = { brands, search };
      return base;
    }

    const categories = await this.safe('categories', () => this.catalog.listCategories(opts.lang), []);
    const needle = q.toLowerCase();
    base.name = { categories: categories.filter((c) => c.name.toLowerCase().includes(needle)) };
    return base;
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
