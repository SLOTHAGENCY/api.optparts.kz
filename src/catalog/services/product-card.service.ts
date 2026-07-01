import { Injectable, Logger } from '@nestjs/common';
import { PartsIndexService } from './parts-index.service';
import { SearchService } from '../../search/search.service';
import { OfferDto } from '../../search/dto/search-response.dto';
import { ProductCardDto } from '../dto/parts.dto';

/**
 * Assembles a full product card by combining PartsIndex reference data
 * (entity, analogs, applicability) with live supplier prices from SearchService.
 * Each source degrades gracefully: a provider failure (e.g. quota) never blocks
 * the rest of the card.
 */
@Injectable()
export class ProductCardService {
  private readonly logger = new Logger(ProductCardService.name);

  constructor(
    private readonly parts: PartsIndexService,
    private readonly search: SearchService,
  ) {}

  async getCard(code: string, brand?: string, lang?: string): Promise<ProductCardDto> {
    const [entity, analogs, applicability, offers] = await Promise.all([
      this.safe('entity', () => this.parts.entity(code, brand, lang), null),
      this.safe('analogs', () => this.parts.analogs({ code, brand, types: 'all' }), []),
      brand
        ? this.safe('applicability', () => this.parts.applicability(code, brand, lang), [])
        : Promise.resolve([]),
      this.fetchOffers(code, brand),
    ]);

    return {
      id: entity?.id ?? null,
      code,
      name: entity?.name ?? '',
      originalName: entity?.originalName ?? null,
      brand: entity?.brand ?? (brand ? { id: '', name: brand } : null),
      description: entity?.description ?? null,
      barcodes: entity?.barcodes ?? [],
      images: entity?.images ?? [],
      parameters: entity?.parameters ?? [],
      analogs,
      applicability,
      offers,
    };
  }

  /** Live supplier offers for the exact article (prices already include markup). */
  private async fetchOffers(code: string, brand?: string): Promise<OfferDto[]> {
    try {
      const res = await this.search.search(code, brand);
      return res.exact.flatMap((g) => g.offers);
    } catch (err: any) {
      this.logger.warn(`Price lookup failed for ${code}: ${err?.message ?? err}`);
      return [];
    }
  }

  private async safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      this.logger.warn(`PartsIndex ${label} failed: ${err?.message ?? err}`);
      return fallback;
    }
  }
}
