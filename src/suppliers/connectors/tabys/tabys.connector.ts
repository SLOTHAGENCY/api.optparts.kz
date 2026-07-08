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
import { resolveConfig, hasKeys } from '../../connector-config.util';
import { SuppliersService } from '../../suppliers.service';

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

  private readonly envMap = {
    API_KEY: 'TABYS_API_KEY', CONTRACT_ID: 'TABYS_CONTRACT_ID',
    OUTLET_ID: 'TABYS_OUTLET_ID', DELIVERY_TYPE: 'TABYS_DELIVERY_TYPE',
    API_URL: 'TABYS_API_URL',
  };

  constructor(private readonly suppliers: SuppliersService) {}

  async isConfigured(): Promise<boolean> {
    return hasKeys(await resolveConfig(this.suppliers, this.code, this.envMap),
      ['API_KEY', 'CONTRACT_ID', 'OUTLET_ID']);
  }

  private http(c: Record<string, string>): AxiosInstance {
    return axios.create({
      baseURL: c.API_URL || 'https://api.tabys.parts',
      timeout: Number(c.TIMEOUT_MS) || 15000,
      headers: {
        'X-External-Api-Key': c.API_KEY || '',
        'Content-Type': 'application/json',
      },
    });
  }

  async search(article: string, brand?: string): Promise<SupplierOffer[]> {
    const c = await resolveConfig(this.suppliers, this.code, this.envMap);
    const client = this.http(c);

    // Build brandName+productCode pairs. With a brand → one pair; otherwise
    // resolve candidate brands for the article first.
    let products: Array<{ brandName: string; productCode: string }>;
    if (brand) {
      products = [{ brandName: brand, productCode: article }];
    } else {
      const brands = await this.resolveBrands(client, article);
      products = brands.map((b) => ({ brandName: b, productCode: article }));
      if (!products.length) return [];
    }

    let data: any;
    try {
      // All filter fields are required by the API (nullable = "no filter").
      const res = await client.post(
        '/v1/product-offers/by-brand-and-product-code',
        {
          products,
          contractId: c.CONTRACT_ID,
          outletId: c.OUTLET_ID,
          priceFrom: null,
          priceTo: null,
          deliveryMinDays: null,
          deliveryMaxDays: null,
          offersMaxNum: Number(c.OFFERS_MAX_NUM) || 50,
          orderByPrice: true,
          enableAnalog: true,
          warehouses: [],
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

  /**
   * Flatten the offer items out of a Tabys response. The live endpoint returns
   * an object keyed by outletId → { items: [...] }; a bare array or a plain
   * { items: [...] } are also accepted (test/legacy shapes).
   */
  private extractItems(data: any): any[] {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (data && typeof data === 'object') {
      return Object.values(data).flatMap((v: any) =>
        Array.isArray(v?.items) ? v.items : [],
      );
    }
    return [];
  }

  /** Public for unit testing without a live HTTP call. */
  mapOffers(data: any, article: string, brand?: string): SupplierOffer[] {
    const items: any[] = this.extractItems(data);
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
        // Tabys emits a home-warehouse placeholder row per product with no price
        // and no stock (price/amount = 0). It is not orderable and, being the
        // cheapest, would steal the "best price" badge — skip it. A priced
        // out-of-stock line (amount 0, price > 0) is a real back-order offer.
        const price = this.toNumber(offer?.price);
        if (price <= 0) continue;

        // An offer is orderable either as a price template (marketplace) or from
        // an own warehouse. sourceType 1 = PriceTemplate, 0 = Warehouse.
        const priceTemplateId = offer?.priceTemplateId ?? null;
        const warehouseId = offer?.warehouseId ?? null;
        const usePriceTemplate = priceTemplateId != null;
        const sourceId = usePriceTemplate ? priceTemplateId : warehouseId;

        offers.push({
          supplierCode: this.code,
          article: itemArticle,
          brand: itemBrand,
          name,
          costPrice: price,
          currency: 'KZT',
          count: this.toNumber(offer?.amount),
          deliveryDays: this.toNumber(offer?.deliveryInfo?.workDays),
          multiplicity: this.toNumber(offer?.minPackSize) || 1,
          // Marketplace lines carry a priceTemplateId but no warehouseId. Fall back
          // to the orderable sourceId so the id stays non-empty and unique per offer
          // (matches raw.offerKey); an empty id breaks add-to-cart and collides offerIds.
          warehouseId: String(warehouseId ?? sourceId ?? ''),
          isAnalog,
          // Everything placeOrder needs back.
          raw: {
            // Stable offer identity: product + the orderable source line.
            offerKey: `${productId}|${sourceId ?? ''}`,
            // Original query, so the cart re-check reproduces the same response.
            queryArticle: article,
            queryBrand: brand ?? null,
            productId,
            sourceType: usePriceTemplate ? 1 : 0,
            sourceId,
            priceTemplateUniqueCode: offer?.priceTemplateUniqueCode ?? null,
            warehouseId,
            price,
          },
        });
      }
    }

    return offers;
  }

  async placeOrder(items: PlaceOrderItem[]): Promise<SupplierOrderResult> {
    const c = await resolveConfig(this.suppliers, this.code, this.envMap);
    const client = this.http(c);
    const body = {
      contractId: c.CONTRACT_ID,
      outletId: c.OUTLET_ID,
      deliveryType: c.DELIVERY_TYPE || 'ToOutlet',
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
    const c = await resolveConfig(this.suppliers, this.code, this.envMap);
    const client = this.http(c);
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
      // GET /v1/brands returns { item: [{ id, name }] } (note: singular "item").
      const rows: any[] = Array.isArray(res.data)
        ? res.data
        : res.data?.item ?? res.data?.items ?? [];
      // De-dupe: one physical brand often appears under several display names.
      const names = rows.map((b) => String(b?.name)).filter(Boolean);
      return [...new Set(names)];
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
