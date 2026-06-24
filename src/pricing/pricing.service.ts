import { Injectable } from '@nestjs/common';
import { SuppliersService } from '../suppliers/suppliers.service';

const DEFAULT_MARKUP_PERCENT = 20;

@Injectable()
export class PricingService {
  constructor(private readonly suppliersService: SuppliersService) {}

  async applyMarkup(costPrice: number, supplierCode: string): Promise<number> {
    const supplier = await this.suppliersService.findByCode(supplierCode);
    const markup =
      supplier?.markupPercent != null
        ? Number(supplier.markupPercent)
        : this.defaultMarkup();
    return Math.round(costPrice * (1 + markup / 100));
  }

  private defaultMarkup(): number {
    const raw = process.env.DEFAULT_MARKUP_PERCENT;
    const parsed = raw != null ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : DEFAULT_MARKUP_PERCENT;
  }
}
