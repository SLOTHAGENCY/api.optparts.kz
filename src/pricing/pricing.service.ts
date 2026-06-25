import { Injectable } from '@nestjs/common';
import { SuppliersService } from '../suppliers/suppliers.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class PricingService {
  constructor(
    private readonly suppliersService: SuppliersService,
    private readonly settings: SettingsService,
  ) {}

  async applyMarkup(
    costPrice: number,
    supplierCode: string,
    currency = 'KZT',
  ): Promise<number> {
    const supplier = await this.suppliersService.findByCode(supplierCode);
    const effectiveCurrency = supplier?.currency || currency || 'KZT';

    const rates = await this.settings.getFxRates();
    const rate = Number.isFinite(rates[effectiveCurrency])
      ? rates[effectiveCurrency]
      : 1;
    const buffer = await this.settings.getFxBufferPercent();
    const kzt = costPrice * rate * (1 + buffer / 100);

    const markup =
      supplier?.markupPercent != null
        ? Number(supplier.markupPercent)
        : await this.settings.getDefaultMarkup();

    return Math.round(kzt * (1 + markup / 100));
  }
}
