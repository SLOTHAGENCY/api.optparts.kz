import {
  BadRequestException,
  Injectable,
  Logger,
  NotImplementedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import axios from 'axios';
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
 * Autotrade (api2.autotrade.su) connector.
 *
 * Transport: POST application/x-www-form-urlencoded, body "data=<json>" where
 * json = { auth_key, method, params }. auth_key = MD5(login + MD5(password) + SALT).
 * Search: getStocksAndPrices (needs a brand). Response is keyed by article with a
 * per-warehouse stocks map. Prices are in the account currency (KZT for KZ).
 *
 * placeOrder: createDocUnconfirmedOrder (from_basket=2, no balance debit).
 * getOrderStatus: getDocList by document_number, mapped from type_doc/real.
 */
@Injectable()
export class AutotradeConnector implements SupplierConnector {
  readonly code = 'autotrade';
  readonly name = 'Autotrade';

  private readonly logger = new Logger(AutotradeConnector.name);
  private static readonly SALT = '1>6)/MI~{J';

  private readonly envMap = {
    LOGIN: 'AUTOTRADE_LOGIN', PASSWORD: 'AUTOTRADE_PASSWORD',
    CONTRACT_ID: 'AUTOTRADE_CONTRACT_ID', PAYMENT_TYPE: 'AUTOTRADE_PAYMENT_TYPE',
    RECEIPT_TYPE: 'AUTOTRADE_RECEIPT_TYPE', API_URL: 'AUTOTRADE_API_URL',
  };

  constructor(private readonly suppliers: SuppliersService) {}

  async isConfigured(): Promise<boolean> {
    return hasKeys(await resolveConfig(this.suppliers, this.code, this.envMap),
      ['LOGIN', 'PASSWORD']);
  }

  private async authKey(c: Record<string, string>): Promise<string> {
    const login = c.LOGIN || '';
    const password = c.PASSWORD || '';
    const md5 = (s: string) => createHash('md5').update(s).digest('hex');
    return md5(login + md5(password) + AutotradeConnector.SALT);
  }

  private async call(method: string, params?: Record<string, unknown>): Promise<any> {
    const c = await resolveConfig(this.suppliers, this.code, this.envMap);
    const url = c.API_URL || 'https://api2.autotrade.su/';
    const payload: Record<string, unknown> = { auth_key: await this.authKey(c), method };
    if (params) payload.params = params;
    const body = 'data=' + JSON.stringify(payload);
    const res = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      timeout: 15000,
    });
    return res.data;
  }

  async search(article: string, brand?: string): Promise<SupplierOffer[]> {
    let data: any;
    try {
      // getItemsByQuery searches by string (no brand needed), returns exact +
      // crosses/replaces, and embeds stock/price when with_stocks_and_prices=1.
      data = await this.call('getItemsByQuery', {
        q: [article],
        strict: 0,
        cross: 1,
        replace: 1,
        with_stocks_and_prices: 1,
        with_delivery: 1,
      });
    } catch (err: any) {
      this.logger.error('Autotrade search failed', err?.message);
      throw new BadRequestException('External parts API is unavailable.');
    }
    if (data && data.code && Number(data.code) !== 0) return [];
    return this.mapOffers(data, article, brand);
  }

  /**
   * Public for unit testing. items is an array (getItemsByQuery) or an object
   * keyed by article (getStocksAndPrices); each entry carries a stocks map and
   * a price when prices were requested.
   */
  mapOffers(data: any, article: string, brand?: string): SupplierOffer[] {
    const raw = data?.items ?? [];
    const entries: any[] = Array.isArray(raw) ? raw : Object.values(raw);
    const wantArticle = this.normalize(article);
    const wantBrand = brand ? this.normalize(brand) : null;
    const offers: SupplierOffer[] = [];

    for (const entry of entries) {
      if (!entry) continue;
      const artCode = String(entry?.article ?? article);
      const artBrand = String(entry?.brand ?? entry?.brand_name ?? brand ?? '');
      const name = String(entry?.name ?? '');
      const insideId = entry?.inside_id_in ?? entry?.id ?? artCode;
      const price = this.toNumber(entry?.price);
      const currency = String(entry?.currency ?? '');
      // type: '' = the requested article; cross/replace/related/component = analog.
      const type = String(entry?.type ?? '');
      const isAnalog = !(
        type === '' &&
        this.normalize(artCode) === wantArticle &&
        (wantBrand === null || this.normalize(artBrand) === wantBrand)
      );

      const stocks = entry?.stocks ?? {};
      for (const stockId of Object.keys(stocks)) {
        const st = stocks[stockId] ?? {};
        const qty =
          this.toNumber(st?.quantity_unpacked) + this.toNumber(st?.quantity_packed);
        const deliveryPeriod = this.toNumber(st?.delivery_period);
        if (qty <= 0 && deliveryPeriod <= 0) continue;

        offers.push({
          supplierCode: this.code,
          article: artCode,
          brand: artBrand,
          name,
          costPrice: price,
          currency: String(entry?.currency ?? 'KZT'),
          count: qty,
          deliveryDays: qty > 0 ? 0 : deliveryPeriod,
          multiplicity: 1,
          warehouseId: String(stockId),
          isAnalog,
          raw: {
            offerKey: `${insideId}|${stockId}`,
            queryArticle: article,
            queryBrand: brand ?? null,
            insideId,
            stockId: String(stockId),
            price,
            currency,
          },
        });
      }
    }
    return offers;
  }

  private normalize(value: unknown): string {
    return String(value ?? '').trim().toUpperCase();
  }

  async placeOrder(items: PlaceOrderItem[]): Promise<SupplierOrderResult> {
    // createDocUnconfirmedOrder with from_basket=2 places without a basket and
    // WITHOUT debiting the balance/reserving (manager confirms later) — safer than
    // createDocRealization which charges immediately.
    const c = await resolveConfig(this.suppliers, this.code, this.envMap);
    const receiptType = Number(c.RECEIPT_TYPE) || 2; // 2=pickup,3=delivery
    try {
      const data = await this.call('createDocUnconfirmedOrder', {
        items: items.map((i) => ({
          article: i.article,
          brand: i.brand,
          quantity: i.quantity,
          id_group_stocks: Number((i.raw as any)?.stockId ?? i.warehouseId),
          type_receipt_item: receiptType,
        })),
        from_basket: 2,
        contract_id: c.CONTRACT_ID,
        payment_type: c.PAYMENT_TYPE || 'with_balance',
      });
      if (data && Number(data.code) !== 0) {
        return {
          externalOrderId: null,
          status: 'FAILED',
          errorMessage: data?.message || 'Autotrade order rejected.',
        };
      }
      // order_numbers: { <stockId>: "НРК..." } (or nested for under-order).
      const externalOrderId = this.flattenOrderNumbers(data?.order_numbers);
      return { externalOrderId, status: 'PLACED' };
    } catch (err: any) {
      this.logger.error('Autotrade placeOrder failed', err?.message);
      return {
        externalOrderId: null,
        status: 'FAILED',
        errorMessage: err?.message || 'Autotrade order failed.',
      };
    }
  }

  /** order_numbers can be { stockId: number } or { stockId: { deliveryId: number } }. */
  private flattenOrderNumbers(orderNumbers: any): string | null {
    if (!orderNumbers || typeof orderNumbers !== 'object') return null;
    const nums: string[] = [];
    for (const v of Object.values(orderNumbers)) {
      if (v && typeof v === 'object') nums.push(...Object.values(v).map(String));
      else nums.push(String(v));
    }
    return nums.length ? nums.join(',') : null;
  }

  async getOrderStatus(
    externalOrderId: string,
  ): Promise<SupplierOrderStatusValue> {
    const number = String(externalOrderId).split(',')[0].trim();
    // getDocList needs a date window; look back a year up to today.
    const now = new Date();
    const toDate = now.toISOString().slice(0, 10);
    const fromDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    let data: any;
    try {
      data = await this.call('getDocList', {
        fromDate,
        toDate,
        document_number: number,
        limit: 5,
      });
    } catch (err: any) {
      this.logger.error('Autotrade getOrderStatus failed', err?.message);
      throw new BadRequestException('External parts API is unavailable.');
    }
    const items: any[] = data?.items ?? [];
    const doc =
      items.find((d) => String(d?.number) === number) ?? items[0] ?? null;
    return this.mapStatus(doc);
  }

  /** Map an Autotrade document to our status (type_doc/real flags). */
  mapStatus(doc: any): SupplierOrderStatusValue {
    if (!doc) return 'PLACED';
    const type = String(doc?.type_doc ?? '').toLowerCase();
    const real = Number(doc?.real);
    if (type.includes('реализ') || real === 1) return 'DELIVERED';
    if (type.includes('отгру')) return 'SHIPPED';
    if (type.includes('заявк')) return 'PLACED';
    return 'PLACED';
  }

  async requestReturn(
    _externalOrderId: string,
    _items: ReturnItem[],
  ): Promise<ReturnResult> {
    throw new NotImplementedException(
      'Autotrade return is not wired — handle manually.',
    );
  }

  private toNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
}
