import {
  BadRequestException,
  Injectable,
  Logger,
  NotImplementedException,
} from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { SupplierConnector } from '../../supplier-connector.interface';
import {
  PlaceOrderItem,
  ReturnItem,
  ReturnResult,
  SupplierOffer,
  SupplierOrderResult,
  SupplierOrderStatusValue,
} from '../../types';

/**
 * Tabys (api.tabys.parts) REST connector.
 *
 * Auth: X-External-Api-Key header.
 * Account-scoped config (contractId/outletId) and the API key come from env.
 * Search needs a brand+productCode pair; when no brand is given we first
 * resolve candidate brands via GET /v1/brands.
 */
@Injectable()
export class TabysConnector implements SupplierConnector {
  readonly code = 'tabys';
  readonly name = 'Tabys';

  private readonly logger = new Logger(TabysConnector.name);

  private http(): AxiosInstance {
    return axios.create({
      baseURL: process.env.TABYS_API_URL || 'https://api.tabys.parts',
      timeout: 15000,
      headers: {
        'X-External-Api-Key': process.env.TABYS_API_KEY || '',
        'Content-Type': 'application/json',
      },
    });
  }

  async search(article: string, brand?: string): Promise<SupplierOffer[]> {
    const client = this.http();

    // Build brand+productCode pairs. With a brand → one pair; otherwise resolve
    // candidate brands for the article first.
    let products: Array<{ brand: string; productCode: string }>;
    if (brand) {
      products = [{ brand, productCode: article }];
    } else {
      const brands = await this.resolveBrands(client, article);
      products = brands.map((b) => ({ brand: b, productCode: article }));
      if (!products.length) return [];
    }

    let data: any;
    try {
      const res = await client.post(
        '/v1/product-offers/by-brand-and-product-code',
        {
          products,
          contractId: process.env.TABYS_CONTRACT_ID,
          outletId: process.env.TABYS_OUTLET_ID,
          enableAnalog: true,
          isInStockInHomeWarehousesOnly: false,
        },
      );
      data = res.data;
    } catch (err: any) {
      this.logger.error('Tabys search request failed', err?.message);
      throw new BadRequestException('External parts API is unavailable.');
    }

    return this.mapOffers(data, article, brand);
  }

  /** Public for unit testing without a live HTTP call. */
  mapOffers(data: any, article: string, brand?: string): SupplierOffer[] {
    const items: any[] = Array.isArray(data) ? data : data?.items ?? [];
    const offers: SupplierOffer[] = [];

    for (const item of items) {
      const blockType = String(item?.offeringBlockType ?? '');
      const isAnalog = !(
        blockType === 'RequestedProduct' || blockType === 'ActualProduct'
      );
      const itemArticle = String(item?.productCode ?? item?.displayProductCode ?? article);
      const itemBrand = String(item?.brandName ?? brand ?? '');
      const name = String(item?.productName ?? '');
      const productId = item?.productId;

      for (const offer of item?.offers ?? []) {
        offers.push({
          supplierCode: this.code,
          article: itemArticle,
          brand: itemBrand,
          name,
          costPrice: this.toNumber(offer?.price),
          currency: 'KZT',
          count: this.toNumber(offer?.amount),
          deliveryDays: this.toNumber(offer?.deliveryInfo?.workDays),
          multiplicity: this.toNumber(offer?.minPackSize) || 1,
          warehouseId: String(offer?.warehouseId ?? ''),
          isAnalog,
          // Everything placeOrder needs back.
          raw: {
            // Stable offer identity: product + price template (the orderable line).
            offerKey: `${productId}|${offer?.priceTemplateId ?? offer?.warehouseId ?? ''}`,
            // Original query, so the cart re-check reproduces the same response.
            queryArticle: article,
            queryBrand: brand ?? null,
            productId,
            sourceType: 1, // PriceTemplate
            sourceId: offer?.priceTemplateId ?? null,
            priceTemplateUniqueCode: offer?.priceTemplateUniqueCode ?? null,
            warehouseId: offer?.warehouseId ?? null,
            price: this.toNumber(offer?.price),
          },
        });
      }
    }

    return offers;
  }

  async placeOrder(items: PlaceOrderItem[]): Promise<SupplierOrderResult> {
    const client = this.http();
    const body = {
      contractId: process.env.TABYS_CONTRACT_ID,
      outletId: process.env.TABYS_OUTLET_ID,
      deliveryType: process.env.TABYS_DELIVERY_TYPE || 'ToOutlet',
      oneTimeDelivery: false,
      notGroupReserves: false,
      items: items.map((i) => ({
        productId: (i.raw as any)?.productId,
        sourceType: (i.raw as any)?.sourceType ?? 1,
        sourceId: (i.raw as any)?.sourceId,
        actualPrice: this.toNumber((i.raw as any)?.price),
        amountInCart: i.quantity,
      })),
    };

    try {
      const res = await client.post('/v1/ordering/orders', body);
      // Response is the order id (UUID string).
      const externalOrderId =
        typeof res.data === 'string' ? res.data : res.data?.id ?? null;
      return { externalOrderId, status: 'PLACED' };
    } catch (err: any) {
      this.logger.error('Tabys placeOrder failed', err?.message);
      return {
        externalOrderId: null,
        status: 'FAILED',
        errorMessage: err?.response?.data?.message || err?.message || 'Tabys order failed.',
      };
    }
  }

  async getOrderStatus(
    externalOrderId: string,
  ): Promise<SupplierOrderStatusValue> {
    const client = this.http();
    try {
      const res = await client.post('/v1/orders-history/statuses', [
        externalOrderId,
      ]);
      const row = (Array.isArray(res.data) ? res.data : []).find(
        (r: any) => String(r?.orderId) === String(externalOrderId),
      );
      return this.mapStatus(row?.status);
    } catch (err: any) {
      this.logger.error('Tabys getOrderStatus failed', err?.message);
      throw new BadRequestException('External parts API is unavailable.');
    }
  }

  async requestReturn(
    _externalOrderId: string,
    _items: ReturnItem[],
  ): Promise<ReturnResult> {
    throw new NotImplementedException(
      'Tabys has no return API — handle the return manually.',
    );
  }

  /** Map Tabys EnumExtended status to our internal status, defensively. */
  mapStatus(status: any): SupplierOrderStatusValue {
    const raw = String(status?.value ?? status?.name ?? status ?? '').toLowerCase();
    if (!raw) return 'PLACED';
    if (raw.includes('cancel')) return 'CANCELLED';
    if (raw.includes('deliver')) return 'DELIVERED';
    if (raw.includes('ship')) return 'SHIPPED';
    if (raw.includes('confirm') || raw.includes('accept')) return 'CONFIRMED';
    return 'PLACED';
  }

  private async resolveBrands(
    client: AxiosInstance,
    article: string,
  ): Promise<string[]> {
    try {
      const res = await client.get('/v1/brands', {
        params: { productCode: article },
      });
      const rows: any[] = Array.isArray(res.data) ? res.data : res.data?.items ?? [];
      return rows.map((b) => String(b?.name)).filter(Boolean);
    } catch (err: any) {
      this.logger.error('Tabys brands lookup failed', err?.message);
      return [];
    }
  }

  private toNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
}
