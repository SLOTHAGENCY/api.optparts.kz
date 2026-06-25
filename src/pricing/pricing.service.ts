import { Injectable } from '@nestjs/common';
import { SuppliersService } from '../suppliers/suppliers.service';
import { SettingsService } from '../settings/settings.service';
import { BrandMarkupService } from './brand-markup.service';

@Injectable()
export class PricingService {
  constructor(
    private readonly suppliersService: SuppliersService,
    private readonly settings: SettingsService,
    private readonly brandMarkups: BrandMarkupService,
  ) {}

  async applyMarkup(
    costPrice: number,
    supplierCode: string,
    currency = 'KZT',
    brand?: string,
  ): Promise<number> {
    const supplier = await this.suppliersService.findByCode(supplierCode);
    const effectiveCurrency = supplier?.currency || currency || 'KZT';

    const rates = await this.settings.getFxRates();
    const rate = Number.isFinite(rates[effectiveCurrency])
      ? rates[effectiveCurrency]
      : 1;
    const buffer = await this.settings.getFxBufferPercent();
    const kzt = costPrice * rate * (1 + buffer / 100);

    // Precedence: brand markup → supplier markup → global default.
    const brandPercent = brand
      ? await this.brandMarkups.findPercentByBrand(brand)
      : null;
    const markup =
      brandPercent != null
        ? brandPercent
        : supplier?.markupPercent != null
          ? Number(supplier.markupPercent)
          : await this.settings.getDefaultMarkup();

    return Math.round(kzt * (1 + markup / 100));
  }
}
