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
 * SHATE-M (api.shate-m.kz) REST connector. Mapping verified against the live
 * OpenAPI spec (swagger v1).
 *
 * Auth: Bearer token from an API key (form-urlencoded), cached until expiry.
 * Search: GET /articles/search (filtered by tradeMarkNames) -> articleId(s),
 * then POST /prices/search/with_article_info with [{articleId, includeAnalogs}].
 * Order: POST /orders/byPriceItems with priceItems[{priceId, quantity}].
 * Returns: GET-only return endpoints exist, but creating a return is not exposed
 * -> requestReturn stays NotImplemented (handle manually).
 *
 * NOTE: NODE: api.shate-m.kz requires the corporate VPN; verify live there.
 */
@Injectable()
export class ShateMConnector implements SupplierConnector {
  readonly code = 'shatem';
  readonly name = 'SHATE-M';

  private readonly logger = new Logger(ShateMConnector.name);
  private token: string | null = null;
  private tokenExpiresAt = 0;

  private client(): AxiosInstance {
    return axios.create({
      baseURL: process.env.SHATE_API_URL || 'https://api.shate-m.kz',
      timeout: 15000,
    });
  }

  private async getToken(client: AxiosInstance): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.token;
    }
    const form = new URLSearchParams();
    const apikey = process.env.SHATE_API_KEY;
    let path: string;
    if (apikey) {
      path = '/api/v1/auth/loginbyapikey';
      form.set('ApiKey', apikey);
    } else {
      path = '/api/v1/auth/login';
      form.set('Login', process.env.SHATE_LOGIN || '');
      form.set('Password', process.env.SHATE_PASSWORD || '');
    }
    const res = await client.post(path, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    this.token = res.data?.access_token ?? null;
    this.tokenExpiresAt =
      Date.now() + (Number(res.data?.expires_in) || 3600) * 1000;
    if (!this.token) throw new Error('SHATE-M auth returned no access_token.');
    return this.token;
  }

  async search(article: string, brand?: string): Promise<SupplierOffer[]> {
    const client = this.client();
    let bearer: string;
    try {
      bearer = await this.getToken(client);
    } catch (err: any) {
      this.logger.error('SHATE-M auth failed', err?.message);
      throw new BadRequestException('External parts API is unavailable.');
    }
    const auth = { headers: { Authorization: `Bearer ${bearer}` } };

    try {
      // 1) Resolve article string -> article id(s), filtered by brand if given.
      const ares = await client.get('/api/v1/articles/search', {
        ...auth,
        params: {
          searchString: article,
          ...(brand ? { tradeMarkNames: brand } : {}),
        },
      });
      const cards: any[] = Array.isArray(ares.data) ? ares.data : [];
      const ids = [
        ...new Set(cards.map((c) => c?.article?.id).filter((v) => v != null)),
      ];
      if (!ids.length) return [];

      // 2) One price call for all article ids (with analogs).
      const pres = await client.post(
        '/api/v1/prices/search/with_article_info',
        ids.map((articleId) => ({ articleId, includeAnalogs: true })),
        {
          ...auth,
          params: {
            AgreementCode: process.env.SHATE_AGREEMENT_CODE || undefined,
            DeliveryAddressCode:
              process.env.SHATE_DELIVERY_ADDRESS_CODE || undefined,
          },
        },
      );
      return this.mapOffers(pres.data, article, brand);
    } catch (err: any) {
      this.logger.error('SHATE-M search failed', err?.message);
      throw new BadRequestException('External parts API is unavailable.');
    }
  }

  /** Public for unit testing. Response = array of ArticlePriceCard. */
  mapOffers(data: any, article: string, brand?: string): SupplierOffer[] {
    const cards: any[] = Array.isArray(data) ? data : data?.items ?? [];
    const wantArticle = this.normalize(article);
    const wantBrand = brand ? this.normalize(brand) : null;
    const offers: SupplierOffer[] = [];

    for (const card of cards) {
      const art = card?.article ?? {};
      const artCode = String(art?.code ?? article);
      const artBrand = String(art?.tradeMarkName ?? brand ?? '');
      const name = String(art?.name ?? '');
      const isAnalog = !(
        this.normalize(artCode) === wantArticle &&
        (wantBrand === null || this.normalize(artBrand) === wantBrand)
      );

      for (const line of card?.prices ?? []) {
        if (!line) continue;
        const priceId = line?.id ?? null;
        const locationCode = String(
          line?.locationCode ?? line?.locationCodeReal ?? '',
        );
        offers.push({
          supplierCode: this.code,
          article: artCode,
          brand: artBrand,
          name,
          // price.value = base (cost); price.valueWithMargin includes our own
          // configured margin and is kept in raw for reference.
          costPrice: this.toNumber(line?.price?.value),
          currency: 'KZT',
          count: this.toNumber(line?.quantity?.available),
          deliveryDays: this.deliveryDays(line),
          multiplicity: this.toNumber(line?.quantity?.multiplicity) || 1,
          warehouseId: locationCode,
          isAnalog,
          raw: {
            // ArticlePrice.id is the orderable price line id (byPriceItems).
            offerKey: `${priceId ?? `${art?.id}|${locationCode}`}`,
            queryArticle: article,
            queryBrand: brand ?? null,
            priceId,
            articleId: art?.id,
            locationCode,
            price: this.toNumber(line?.price?.value),
            valueWithMargin: this.toNumber(line?.price?.valueWithMargin),
            isReturnAllowed: line?.addInfo?.isReturnAllowed ?? null,
          },
        });
      }
    }
    return offers;
  }

  async placeOrder(items: PlaceOrderItem[]): Promise<SupplierOrderResult> {
    const client = this.client();
    let bearer: string;
    try {
      bearer = await this.getToken(client);
    } catch (err: any) {
      return { externalOrderId: null, status: 'FAILED', errorMessage: err?.message };
    }
    try {
      const res = await client.post(
        '/api/v1/orders/byPriceItems',
        {
          agreementCode: process.env.SHATE_AGREEMENT_CODE,
          deliveryInfo: {
            deliveryType: process.env.SHATE_DELIVERY_TYPE || undefined,
            deliveryAddressCode:
              process.env.SHATE_DELIVERY_ADDRESS_CODE || undefined,
          },
          agreeWithTermsOfDelivery: true,
          agreeWithPersonalDataProcessingPolicyAndUserAgreement: true,
          priceItems: items.map((i) => ({
            priceId: (i.raw as any)?.priceId,
            quantity: i.quantity,
          })),
        },
        { headers: { Authorization: `Bearer ${bearer}` } },
      );
      const externalOrderId =
        res.data?.id ?? res.data?.orderId ?? (typeof res.data === 'string' ? res.data : null);
      return { externalOrderId, status: 'PLACED' };
    } catch (err: any) {
      this.logger.error('SHATE-M placeOrder failed', err?.message);
      return {
        externalOrderId: null,
        status: 'FAILED',
        errorMessage:
          err?.response?.data?.description || err?.message || 'SHATE-M order failed.',
      };
    }
  }

  async getOrderStatus(
    externalOrderId: string,
  ): Promise<SupplierOrderStatusValue> {
    const client = this.client();
    try {
      const bearer = await this.getToken(client);
      const res = await client.get('/api/v1/orders', {
        headers: { Authorization: `Bearer ${bearer}` },
        params: { orderId: externalOrderId },
      });
      const items: any[] = Array.isArray(res.data) ? res.data : res.data?.items ?? [];
      const row = items.find(
        (o) => String(o?.id ?? o?.orderId) === String(externalOrderId),
      );
      return this.mapStatus(row?.status?.code ?? row?.statusCode);
    } catch (err: any) {
      this.logger.error('SHATE-M getOrderStatus failed', err?.message);
      throw new BadRequestException('External parts API is unavailable.');
    }
  }

  async requestReturn(
    _externalOrderId: string,
    _items: ReturnItem[],
  ): Promise<ReturnResult> {
    throw new NotImplementedException(
      'SHATE-M return creation is not exposed via API — handle manually.',
    );
  }

  /** Map SHATE-M numeric order-item status code (provisional — refine via /orderitemstatuscodes). */
  mapStatus(code: any): SupplierOrderStatusValue {
    const c = Number(code);
    if (!Number.isFinite(c)) return 'PLACED';
    if (c >= 90) return 'DELIVERED';
    if (c >= 70) return 'SHIPPED';
    if (c >= 40) return 'CONFIRMED';
    if (c < 0) return 'CANCELLED';
    return 'PLACED';
  }

  private deliveryDays(line: any): number {
    const arr = line?.deliveryDateTimes;
    const first = Array.isArray(arr) ? arr[0] : null;
    const dt = first?.deliveryDateTime ?? first ?? line?.shippingDateTime;
    if (!dt) return 0;
    const days = Math.ceil(
      (new Date(dt).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    );
    return Number.isFinite(days) && days > 0 ? days : 0;
  }

  private normalize(value: unknown): string {
    return String(value ?? '').trim().toUpperCase();
  }

  private toNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
}
