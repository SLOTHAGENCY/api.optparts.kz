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
 * SHATE-M (api-doc.shate-m.by) REST connector.
 *
 * Auth: Bearer token obtained from an API key (or login/password), cached until
 * just before expiry. Search is two-step: resolve the article string to article
 * id(s), then fetch prices. Account-scoped AgreementCode / DeliveryAddressCode
 * come from env.
 *
 * NOTE: response field mapping follows the published docs; verify/adjust against
 * a live response once credentials are available.
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
      baseURL: process.env.SHATE_API_URL || 'https://api.shate-m.by',
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async getToken(client: AxiosInstance): Promise<string> {
    // Reuse the cached token until 60s before expiry.
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.token;
    }
    const apikey = process.env.SHATE_API_KEY;
    const res = apikey
      ? await client.post('/api/v1/auth/loginByapiKey', { apikey })
      : await client.post('/api/v1/auth/login', {
          login: process.env.SHATE_LOGIN,
          password: process.env.SHATE_PASSWORD,
        });
    this.token = res.data?.access_token ?? null;
    this.tokenExpiresAt =
      Date.now() + (Number(res.data?.expires_in) || 3600) * 1000;
    if (!this.token) throw new Error('SHATE-M auth returned no access_token.');
    return this.token;
  }

  async search(article: string, brand?: string): Promise<SupplierOffer[]> {
    const client = this.client();
    let auth: { headers: { Authorization: string } };
    try {
      const token = await this.getToken(client);
      auth = { headers: { Authorization: `Bearer ${token}` } };
    } catch (err: any) {
      this.logger.error('SHATE-M auth failed', err?.message);
      throw new BadRequestException('External parts API is unavailable.');
    }

    try {
      // 1) Resolve the article string to article id(s).
      const ares = await client.get(
        `/api/v1/articles/search/${encodeURIComponent(article)}`,
        auth,
      );
      const articles: any[] = Array.isArray(ares.data)
        ? ares.data
        : ares.data?.items ?? ares.data?.result ?? [];
      const wantBrand = brand ? this.normalize(brand) : null;
      const wanted = wantBrand
        ? articles.filter((a) => this.normalize(a?.tradeMarkName) === wantBrand)
        : articles;
      const ids = [...new Set(wanted.map((a) => a?.id).filter(Boolean))];
      if (!ids.length) return [];

      // 2) Fetch prices per article id (with analogs).
      const offers: SupplierOffer[] = [];
      for (const articleId of ids) {
        const pres = await client.post(
          '/api/v1/prices/search/with_article_info',
          {
            ArticleId: articleId,
            IncludeAnalogs: true,
            AgreementCode: process.env.SHATE_AGREEMENT_CODE,
            DeliveryAddressCode: process.env.SHATE_DELIVERY_ADDRESS_CODE,
          },
          auth,
        );
        offers.push(...this.mapOffers(pres.data, article, brand));
      }
      return offers;
    } catch (err: any) {
      this.logger.error('SHATE-M search failed', err?.message);
      throw new BadRequestException('External parts API is unavailable.');
    }
  }

  /** Public for unit testing without a live HTTP call. */
  mapOffers(data: any, article: string, brand?: string): SupplierOffer[] {
    const groups: any[] = Array.isArray(data)
      ? data
      : data?.items ?? data?.result ?? [];
    const wantArticle = this.normalize(article);
    const wantBrand = brand ? this.normalize(brand) : null;
    const offers: SupplierOffer[] = [];

    for (const group of groups) {
      // A group is either a price line, or { article, prices:[...] }.
      const art = group?.article ?? group;
      const lines: any[] = group?.prices ?? group?.items ?? [group];
      const artCode = String(art?.code ?? article);
      const artBrand = String(art?.tradeMarkName ?? brand ?? '');
      const name = String(art?.name ?? art?.description ?? '');
      const articleId = art?.id;
      const isAnalog = !(
        this.normalize(artCode) === wantArticle &&
        (wantBrand === null || this.normalize(artBrand) === wantBrand)
      );

      for (const line of lines) {
        if (!line) continue;
        const priceId = line?.id ?? line?.priceId ?? null;
        const locationCode = String(line?.locationCode ?? line?.locationCodeReal ?? '');
        offers.push({
          supplierCode: this.code,
          article: artCode,
          brand: artBrand,
          name,
          // price.value is the cost; valueWithMargin is the supplier's own margin.
          costPrice: this.toNumber(line?.price?.value ?? line?.price),
          count: this.toNumber(line?.quantity?.available ?? line?.quantity),
          deliveryDays: this.deliveryDays(line?.deliveryDateTimes),
          multiplicity: this.toNumber(line?.quantity?.multiplicity) || 1,
          warehouseId: locationCode,
          isAnalog,
          raw: {
            // Stable orderable identity (byPriceItems needs priceId).
            offerKey: `${priceId ?? `${articleId}|${locationCode}`}`,
            queryArticle: article,
            queryBrand: brand ?? null,
            priceId,
            articleId,
            locationCode,
            price: this.toNumber(line?.price?.value ?? line?.price),
          },
        });
      }
    }
    return offers;
  }

  async placeOrder(items: PlaceOrderItem[]): Promise<SupplierOrderResult> {
    const client = this.client();
    let auth: { headers: { Authorization: string } };
    try {
      const token = await this.getToken(client);
      auth = { headers: { Authorization: `Bearer ${token}` } };
    } catch (err: any) {
      return { externalOrderId: null, status: 'FAILED', errorMessage: err?.message };
    }
    try {
      const res = await client.post(
        '/api/v1/orders/byPriceItems',
        {
          agreementCode: process.env.SHATE_AGREEMENT_CODE,
          priceItems: items.map((i) => ({
            priceId: (i.raw as any)?.priceId,
            quantity: i.quantity,
          })),
        },
        auth,
      );
      const externalOrderId =
        res.data?.id ?? res.data?.orderId ?? (typeof res.data === 'string' ? res.data : null);
      return { externalOrderId, status: 'PLACED' };
    } catch (err: any) {
      this.logger.error('SHATE-M placeOrder failed', err?.message);
      return {
        externalOrderId: null,
        status: 'FAILED',
        errorMessage: err?.response?.data?.message || err?.message || 'SHATE-M order failed.',
      };
    }
  }

  async getOrderStatus(
    externalOrderId: string,
  ): Promise<SupplierOrderStatusValue> {
    const client = this.client();
    try {
      const token = await this.getToken(client);
      const res = await client.get('/api/v1/orders', {
        headers: { Authorization: `Bearer ${token}` },
        params: { orderId: externalOrderId },
      });
      const orders: any[] = Array.isArray(res.data)
        ? res.data
        : res.data?.items ?? [];
      const order = orders.find(
        (o) => String(o?.id ?? o?.orderId) === String(externalOrderId),
      );
      return this.mapStatus(order?.statusCode ?? order?.items?.[0]?.statusCode);
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
      'SHATE-M has no return API — handle the return manually.',
    );
  }

  /** Map SHATE-M numeric statusCode to our internal status (provisional). */
  mapStatus(code: any): SupplierOrderStatusValue {
    const c = Number(code);
    // Provisional mapping; refine against /api/v1/orderItemStatusCodes.
    if (!Number.isFinite(c)) return 'PLACED';
    if (c >= 90) return 'DELIVERED';
    if (c >= 70) return 'SHIPPED';
    if (c >= 40) return 'CONFIRMED';
    if (c < 0) return 'CANCELLED';
    return 'PLACED';
  }

  private deliveryDays(deliveryDateTimes: any): number {
    const first = Array.isArray(deliveryDateTimes) ? deliveryDateTimes[0] : null;
    const dt = first?.deliveryDateTime ?? first;
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
