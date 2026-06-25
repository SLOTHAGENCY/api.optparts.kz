import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SuppliersRegistry } from '../suppliers/suppliers.registry';
import { PricingService } from '../pricing/pricing.service';
import { SupplierOffer } from '../suppliers/types';
import { SearchLog } from './entities/search-log.entity';
import { encodeOfferId } from './offer-id.util';
import {
  OfferDto,
  SearchGroupDto,
  SearchResponseDto,
} from './dto/search-response.dto';
import { User, UserRole } from '../users/entities/user.entity';
import { HistoryQueryDto, HistoryResponseDto } from './dto/search-history.dto';

const DEFAULT_SEARCH_TIMEOUT_MS = 15000;

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
  ) {}

  async search(
    article: string,
    brand?: string,
    userId?: string,
  ): Promise<SearchResponseDto> {
    const connectors = await this.registry.getActive();
    const suppliersQueried = connectors.length;

    const settled = await Promise.allSettled(
      connectors.map((connector) =>
        this.withTimeout(connector.search(article, brand), this.timeoutMs).then(
          (offers) => ({ connector, offers }),
        ),
      ),
    );

    let suppliersFailed = 0;
    const rawOffers: { offer: SupplierOffer; supplierName: string }[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        for (const offer of result.value.offers) {
          rawOffers.push({ offer, supplierName: result.value.connector.name });
        }
      } else {
        suppliersFailed += 1;
        this.logger.warn(
          `Supplier search failed: ${result.reason?.message ?? result.reason}`,
        );
      }
    }

    const normalized = await Promise.all(
      rawOffers.map(({ offer, supplierName }) =>
        this.toNormalizedOffer(offer, supplierName),
      ),
    );

    const { exact, analogs } = this.groupAndRank(normalized);
    const totalResults = this.countOffers(exact) + this.countOffers(analogs);

    this.logSearch({
      userId: userId ?? null,
      article,
      brand: brand ?? null,
      totalResults,
      suppliersQueried,
      suppliersFailed,
    });

    return { query: { article, brand: brand ?? null }, exact, analogs };
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
  ): Promise<NormalizedOffer> {
    const sellPrice = await this.pricing.applyMarkup(
      offer.costPrice,
      offer.supplierCode,
      offer.currency,
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
        deliveryDays: offer.deliveryDays,
        count: offer.count,
        multiplicity: offer.multiplicity,
        warehouseId: offer.warehouseId,
        raw: offer.raw,
      },
    };
  }

  private groupAndRank(offers: NormalizedOffer[]): {
    exact: SearchGroupDto[];
    analogs: SearchGroupDto[];
  } {
    const groups = new Map<string, RankedGroup>();
    for (const offer of offers) {
      const key = `${offer.article}|${offer.brand}`;
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
