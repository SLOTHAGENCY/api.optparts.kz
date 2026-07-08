import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SuppliersRegistry } from '../suppliers/suppliers.registry';
import { SupplierConnector } from '../suppliers/supplier-connector.interface';
import { PricingService } from '../pricing/pricing.service';
import { SupplierOffer } from '../suppliers/types';
import { SearchLog } from './entities/search-log.entity';
import { encodeOfferId } from './offer-id.util';
import { normalizeArticle } from './normalize-article.util';
import {
  ActiveSupplierDto,
  OfferDto,
  SearchGroupDto,
  SearchResponseDto,
  SupplierSearchResponseDto,
} from './dto/search-response.dto';
import { User, UserRole } from '../users/entities/user.entity';
import { HistoryQueryDto, HistoryResponseDto } from './dto/search-history.dto';
import { SettingsService } from '../settings/settings.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { SearchFilterDto } from './dto/search-filter.dto';
import { RateLimiterRegistry } from '../suppliers/rate-limiter.registry';

const DEFAULT_SEARCH_TIMEOUT_MS = 8000;

interface NormalizedOffer {
  article: string;
  brand: string;
  name: string;
  isAnalog: boolean;
  dto: OfferDto;
}

type RankedGroup = SearchGroupDto & { isAnalog: boolean };

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly registry: SuppliersRegistry,
    private readonly pricing: PricingService,
    @InjectRepository(SearchLog)
    private readonly searchLogRepo: Repository<SearchLog>,
    private readonly settings: SettingsService,
    private readonly suppliersService: SuppliersService,
    private readonly rateLimiter: RateLimiterRegistry,
  ) {}

  async search(
    article: string,
    brand?: string,
    userId?: string,
    filter?: SearchFilterDto,
  ): Promise<SearchResponseDto> {
    const connectors = await this.registry.getActive();
    const suppliersQueried = connectors.length;

    const supplierRows = await this.suppliersService.findAll();
    const bufferByCode = new Map(
      supplierRows.map((s) => [s.code, s.deliveryBufferDays]),
    );
    const rateLimitByCode = new Map(
      supplierRows.map((s) => [s.code, s.rateLimitRpm]),
    );

    // Each supplier is timed and its own failure is captured, so a slow/failing
    // partner is named in the logs. NOTE: this aggregate endpoint still blocks on
    // the slowest supplier (bounded by this.timeoutMs). The per-supplier endpoint
    // below (searchSupplier) is what lets the frontend fan out and render results
    // as each partner responds, instead of waiting for the straggler.
    const settled = await Promise.all(
      connectors.map(async (connector) => {
        const r = await this.fetchSupplierOffers(
          connector,
          article,
          brand,
          this.rpmFor(connector.code, rateLimitByCode),
        );
        return { connector, ...r };
      }),
    );

    let suppliersFailed = 0;
    const rawOffers: { offer: SupplierOffer; supplierName: string }[] = [];
    for (const result of settled) {
      if (result.error) {
        suppliersFailed += 1;
        this.logger.warn(
          `Supplier '${result.connector.code}' search failed after ${result.ms}ms: ${
            (result.error as { message?: string })?.message ?? result.error
          }`,
        );
        continue;
      }
      this.logger.log(
        `Supplier '${result.connector.code}' returned ${result.offers.length} offers in ${result.ms}ms`,
      );
      for (const offer of result.offers) {
        rawOffers.push({ offer, supplierName: result.connector.name });
      }
    }
    const globalBuffer = await this.settings.getDeliveryBufferDays();

    const normalized = await Promise.all(
      rawOffers.map(({ offer, supplierName }) =>
        this.toNormalizedOffer(offer, supplierName, bufferByCode, globalBuffer),
      ),
    );

    const ranked = this.groupAndRank(normalized);
    const exact = this.applyFilters(ranked.exact, filter ?? {});
    const analogs = this.applyFilters(ranked.analogs, filter ?? {});
    const totalResults = this.countOffers(exact) + this.countOffers(analogs);

    this.logSearch({
      userId: userId ?? null,
      queryType: 'article',
      article,
      brand: brand ?? null,
      totalResults,
      suppliersQueried,
      suppliersFailed,
    });

    return { query: { article, brand: brand ?? null }, exact, analogs };
  }

  /** Active suppliers the frontend should fan out to (code + name, no secrets). */
  async activeSuppliers(): Promise<ActiveSupplierDto[]> {
    const connectors = await this.registry.getActive();
    return connectors.map((c) => ({ code: c.code, name: c.name }));
  }

  /**
   * One supplier's search, returned FLAT (ungrouped) and normalized (markup +
   * delivery buffer applied). The frontend calls this once per active supplier
   * and renders each response as it arrives, so a slow partner never blocks the
   * others. A partner failure/timeout resolves to `{ ok: false, offers: [] }`
   * (HTTP 200) so the client can drop it silently.
   */
  async searchSupplier(
    code: string,
    article: string,
    brand?: string,
  ): Promise<SupplierSearchResponseDto> {
    // Throws NotFound (unknown code) / BadRequest (inactive) — surfaced as-is.
    const connector = await this.registry.getByCode(code);

    const supplierRows = await this.suppliersService.findAll();
    const bufferByCode = new Map(
      supplierRows.map((s) => [s.code, s.deliveryBufferDays]),
    );
    const rateLimitByCode = new Map(
      supplierRows.map((s) => [s.code, s.rateLimitRpm]),
    );

    const { offers, ms, error } = await this.fetchSupplierOffers(
      connector,
      article,
      brand,
      this.rpmFor(code, rateLimitByCode),
    );

    if (error) {
      this.logger.warn(
        `Supplier '${code}' search failed after ${ms}ms: ${
          (error as { message?: string })?.message ?? error
        }`,
      );
      return { supplierCode: code, ok: false, offers: [] };
    }

    this.logger.log(
      `Supplier '${code}' returned ${offers.length} offers in ${ms}ms`,
    );
    const globalBuffer = await this.settings.getDeliveryBufferDays();
    const normalized = await Promise.all(
      offers.map((offer) =>
        this.toNormalizedOffer(offer, connector.name, bufferByCode, globalBuffer),
      ),
    );
    return {
      supplierCode: code,
      ok: true,
      offers: normalized.map((n) => ({
        article: n.article,
        brand: n.brand,
        name: n.name,
        isAnalog: n.isAnalog,
        offer: n.dto,
      })),
    };
  }

  /**
   * One supplier's raw offers: rate-limited, timed, and bounded by this.timeoutMs.
   * Never throws — a down / inactive / timed-out partner resolves to empty offers
   * plus the captured error, so callers decide how to surface it.
   */
  private async fetchSupplierOffers(
    connector: SupplierConnector,
    article: string,
    brand: string | undefined,
    rateLimitRpm: number | null,
  ): Promise<{ offers: SupplierOffer[]; ms: number; error: unknown }> {
    const startedAt = Date.now();
    try {
      const offers = await this.rateLimiter.gate(connector.code, rateLimitRpm, () =>
        this.withTimeout(connector.search(article, brand), this.timeoutMs),
      );
      return { offers, ms: Date.now() - startedAt, error: null };
    } catch (error) {
      return { offers: [], ms: Date.now() - startedAt, error };
    }
  }

  /** Public for unit testing. Filters offers within each group; drops empty groups. */
  applyFilters(groups: SearchGroupDto[], f: SearchFilterDto): SearchGroupDto[] {
    const brand = f.brand?.trim().toUpperCase();
    const suppliers = f.suppliers?.length
      ? new Set(f.suppliers.map((s) => s.toLowerCase()))
      : null;
    const out: SearchGroupDto[] = [];
    for (const group of groups) {
      if (brand && group.brand.trim().toUpperCase() !== brand) continue;
      const offers = group.offers.filter((o) => {
        if (f.priceMin != null && o.sellPrice < f.priceMin) return false;
        if (f.priceMax != null && o.sellPrice > f.priceMax) return false;
        if (f.inStock && !(o.count > 0)) return false;
        if (f.maxDeliveryDays != null && o.deliveryDays > f.maxDeliveryDays) return false;
        if (suppliers && !suppliers.has(o.supplierCode.toLowerCase())) return false;
        return true;
      });
      if (offers.length) out.push({ ...group, offers });
    }
    return out;
  }

  async history(
    user: User,
    query: HistoryQueryDto,
  ): Promise<HistoryResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const isPrivileged = (user.roles ?? []).some(
      (role) => role === UserRole.ADMIN || role === UserRole.MANAGER,
    );
    const where = isPrivileged ? {} : { userId: user.id };

    const [items, total] = await this.searchLogRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total, page, limit };
  }

  private async toNormalizedOffer(
    offer: SupplierOffer,
    supplierName: string,
    bufferByCode: Map<string, number | null>,
    globalBuffer: number,
  ): Promise<NormalizedOffer> {
    const sellPrice = await this.pricing.applyMarkup(
      offer.costPrice,
      offer.supplierCode,
      offer.currency,
      offer.brand,
    );
    return {
      article: offer.article,
      brand: offer.brand,
      name: offer.name,
      isAnalog: offer.isAnalog,
      dto: {
        offerId: encodeOfferId({
          supplierCode: offer.supplierCode,
          article: offer.article,
          brand: offer.brand,
          warehouseId: offer.warehouseId,
        }),
        supplierCode: offer.supplierCode,
        supplierName,
        sellPrice,
        deliveryDays: this.withBuffer(offer.deliveryDays, offer.supplierCode, bufferByCode, globalBuffer),
        count: offer.count,
        multiplicity: offer.multiplicity,
        warehouseId: offer.warehouseId,
        raw: offer.raw,
      },
    };
  }

  private rpmFor(code: string, byCode: Map<string, number | null>): number | null {
    return byCode.get(code) ?? null;
  }

  /** deliveryDays + (supplier buffer ?? global buffer ?? 0). */
  withBuffer(
    days: number,
    supplierCode: string,
    bufferByCode: Map<string, number | null>,
    globalBuffer: number,
  ): number {
    const sup = bufferByCode.get(supplierCode);
    const buffer = sup != null ? sup : globalBuffer ?? 0;
    return days + buffer;
  }

  private groupAndRank(offers: NormalizedOffer[]): {
    exact: SearchGroupDto[];
    analogs: SearchGroupDto[];
  } {
    const groups = new Map<string, RankedGroup>();
    for (const offer of offers) {
      const key = `${normalizeArticle(offer.article)}|${normalizeArticle(offer.brand)}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          article: offer.article,
          brand: offer.brand,
          name: offer.name,
          isAnalog: offer.isAnalog,
          offers: [],
        };
        groups.set(key, group);
      }
      group.offers.push(offer.dto);
    }

    const ranked = [...groups.values()];
    for (const group of ranked) {
      group.offers.sort(
        (a, b) =>
          a.sellPrice - b.sellPrice ||
          a.deliveryDays - b.deliveryDays ||
          b.count - a.count,
      );
    }
    // Order groups by their cheapest (already-first) offer.
    ranked.sort(
      (a, b) => (a.offers[0]?.sellPrice ?? 0) - (b.offers[0]?.sellPrice ?? 0),
    );

    const strip = (group: RankedGroup): SearchGroupDto => ({
      article: group.article,
      brand: group.brand,
      name: group.name,
      offers: group.offers,
    });

    return {
      exact: ranked.filter((g) => !g.isAnalog).map(strip),
      analogs: ranked.filter((g) => g.isAnalog).map(strip),
    };
  }

  private countOffers(groups: SearchGroupDto[]): number {
    return groups.reduce((sum, group) => sum + group.offers.length, 0);
  }

  /**
   * Records a VIN/FRAME car-lookup into search_log. Fire-and-forget, like article search.
   * suppliersQueried/Failed are 0 — a VIN search hits the OEM catalog, not suppliers.
   */
  logVinSearch(entry: {
    userId?: string | null;
    vin: string;
    catalogs?: string | null;
    matchedCars: number;
  }): void {
    this.logSearch({
      userId: entry.userId ?? null,
      queryType: 'vin',
      article: entry.vin,
      brand: entry.catalogs ?? null,
      totalResults: entry.matchedCars,
      suppliersQueried: 0,
      suppliersFailed: 0,
    });
  }

  /** Fire-and-forget: a write failure must never affect the search response. */
  private logSearch(entry: Partial<SearchLog>): void {
    this.searchLogRepo.save(entry).catch((err) =>
      this.logger.warn(`Failed to write search_log: ${err?.message ?? err}`),
    );
  }

  private get timeoutMs(): number {
    const raw = Number(process.env.SEARCH_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SEARCH_TIMEOUT_MS;
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Supplier search timed out after ${ms}ms`)),
        ms,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
}
