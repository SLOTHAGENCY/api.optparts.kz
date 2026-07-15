import {
  BadRequestException,
  Injectable,
  Logger,
  NotImplementedException,
} from '@nestjs/common';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
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
import {
  IndeterminateSupplierError,
  isIndeterminateSupplierError,
} from '../../indeterminate';
import { SuppliersService } from '../../suppliers.service';

@Injectable()
export class RosskoConnector implements SupplierConnector {
  readonly code = 'rossko';
  readonly name = 'Rossko';

  private readonly logger = new Logger(RosskoConnector.name);

  private readonly envMap = {
    KEY1: 'ROSSKO_KEY1', KEY2: 'ROSSKO_KEY2',
    DELIVERY_ID: 'ROSSKO_DELIVERY_ID', ADDRESS_ID: 'ROSSKO_ADDRESS_ID',
    API_URL: 'ROSSKO_API_URL',
  };

  constructor(private readonly suppliers: SuppliersService) {}

  async isConfigured(): Promise<boolean> {
    return hasKeys(await resolveConfig(this.suppliers, this.code, this.envMap),
      ['KEY1', 'KEY2', 'DELIVERY_ID', 'ADDRESS_ID']);
  }

  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    isArray: (name) => ['Part', 'stock'].includes(name),
  });

  async search(article: string, brand?: string): Promise<SupplierOffer[]> {
    const c = await resolveConfig(this.suppliers, this.code, this.envMap);
    const soap = this.buildSoapEnvelope(article, c);
    let rawXml: string;
    try {
      const baseUrl = c.API_URL || 'https://api.rossko.ru';
      const response = await axios.post(
        `${baseUrl}/service/v2.1/GetSearch`,
        soap,
        {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: 'https://api.rossko.ru/service/v2.1/GetSearch',
          },
          timeout: Number(c.TIMEOUT_MS) || 15000,
        },
      );
      rawXml = response.data;
    } catch (err) {
      this.logger.error('Rossko API request failed', err?.message);
      throw new BadRequestException('External parts API is unavailable.');
    }
    return this.parseOffers(rawXml, article, brand);
  }

  /** Public for unit testing without a live SOAP call. */
  parseOffers(xml: string, article: string, brand?: string): SupplierOffer[] {
    const parsed = this.parser.parse(xml);
    const searchResult = parsed?.Envelope?.Body?.GetSearchResponse?.SearchResult;
    if (!searchResult) {
      throw new BadRequestException('Invalid response from parts API.');
    }

    const rawParts: any[] = searchResult?.PartsList?.Part ?? [];
    const wantArticle = this.normalize(article);
    const wantBrand = brand ? this.normalize(brand) : null;

    const seen = new Set<string>();
    const offers: SupplierOffer[] = [];

    for (const part of rawParts) {
      const crosses: any[] = part?.crosses?.Part ?? [];
      for (const cross of crosses) {
        const stocks: any[] = Array.isArray(cross?.stocks?.stock)
          ? cross.stocks.stock
          : [];
        const crossArticle = String(cross.partnumber ?? '');
        const crossBrand = String(cross.brand ?? '');
        const guid = String(cross.guid ?? '');
        const isAnalog = !(
          this.normalize(crossArticle) === wantArticle &&
          (wantBrand === null || this.normalize(crossBrand) === wantBrand)
        );

        for (const stock of stocks) {
          const warehouseId = String(stock.id);
          const dedupeKey = `${guid}|${warehouseId}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          offers.push({
            supplierCode: this.code,
            article: crossArticle,
            brand: crossBrand,
            name: String(cross.name ?? ''),
            costPrice: this.toNumber(stock.price),
            currency: 'RUB',
            count: this.toNumber(stock.count),
            deliveryDays: this.toNumber(stock.delivery),
            multiplicity: this.toNumber(stock.multiplicity),
            warehouseId,
            isAnalog,
            raw: {
              // Stable offer identity: a Rossko stock id is a WAREHOUSE shared by
              // many products, so guid (the cross/product) must be part of the key.
              offerKey: `${guid}|${warehouseId}`,
              // The offer only exists as a cross under THIS parent query — store it
              // so the cart re-check reproduces the same response (Spec B).
              queryArticle: article,
              queryBrand: brand ?? null,
              guid,
              partnumber: crossArticle,
              brand: crossBrand,
              stockId: warehouseId,
            },
          });
        }
      }
    }

    return offers;
  }

  async placeOrder(items: PlaceOrderItem[]): Promise<SupplierOrderResult> {
    const c = await resolveConfig(this.suppliers, this.code, this.envMap);
    const soap = this.buildCheckoutEnvelope(items, c);
    let rawXml: string;
    try {
      const baseUrl = c.API_URL || 'https://api.rossko.ru';
      const response = await axios.post(
        `${baseUrl}/service/v2.1/GetCheckout`,
        soap,
        {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: 'https://api.rossko.ru/service/v2.1/GetCheckout',
          },
          timeout: Number(c.TIMEOUT_MS) || 20000,
        },
      );
      rawXml = response.data;
    } catch (err: any) {
      this.logger.error('Rossko GetCheckout failed', err?.message);
      if (isIndeterminateSupplierError(err)) {
        // Timeout / reset / 5xx: Rossko may already hold this order. Do NOT mark it FAILED
        // (retryable) — surface it so the sub-order is left SENDING for an admin to resolve.
        throw new IndeterminateSupplierError(
          'Rossko order request outcome unknown (transport failure).',
          err,
        );
      }
      return {
        externalOrderId: null,
        status: 'FAILED',
        errorMessage: 'Rossko order request failed.',
      };
    }
    return this.parseCheckout(rawXml);
  }

  /** Public for unit testing without a live SOAP call. */
  parseCheckout(xml: string): SupplierOrderResult {
    const parsed = this.parser.parse(xml);
    const result =
      parsed?.Envelope?.Body?.GetCheckoutResponse?.CheckoutResult ?? {};
    const success =
      result.success === true || result.success === 'true';
    // Order number(s) can live under a few shapes; collect what we find.
    const orderNumbers: string[] = [];
    const orders = result?.orders?.order ?? result?.order ?? null;
    if (Array.isArray(orders)) {
      for (const o of orders) orderNumbers.push(String(o?.number ?? o?.id ?? o));
    } else if (orders) {
      orderNumbers.push(String(orders?.number ?? orders?.id ?? orders));
    }
    const externalOrderId =
      orderNumbers.filter(Boolean).join(',') ||
      (result.number != null ? String(result.number) : null);

    if (!success && !externalOrderId) {
      return {
        externalOrderId: null,
        status: 'FAILED',
        errorMessage: String(result.message ?? 'Rossko order rejected.'),
      };
    }
    return { externalOrderId, status: 'PLACED' };
  }

  async getOrderStatus(externalOrderId: string): Promise<SupplierOrderStatusValue> {
    const c = await resolveConfig(this.suppliers, this.code, this.envMap);
    // placeOrder may join several order numbers with commas; check the first.
    const id = String(externalOrderId).split(',')[0].trim();
    const soap = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <tns:GetOrders xmlns:tns="https://api.rossko.ru/">
      <tns:KEY1>${c.KEY1}</tns:KEY1>
      <tns:KEY2>${c.KEY2}</tns:KEY2>
      <tns:order_ids><tns:id>${this.escapeXml(id)}</tns:id></tns:order_ids>
    </tns:GetOrders>
  </soap:Body>
</soap:Envelope>`;
    let rawXml: string;
    try {
      const baseUrl = c.API_URL || 'https://api.rossko.ru';
      const response = await axios.post(
        `${baseUrl}/service/v2.1/GetOrders`,
        soap,
        {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: 'https://api.rossko.ru/service/v2.1/GetOrders',
          },
          timeout: Number(c.TIMEOUT_MS) || 15000,
        },
      );
      rawXml = response.data;
    } catch (err: any) {
      this.logger.error('Rossko GetOrders failed', err?.message);
      throw new BadRequestException('External parts API is unavailable.');
    }
    return this.parseOrderStatus(rawXml);
  }

  /** Public for unit testing. Maps the GetOrders response to our status. */
  parseOrderStatus(xml: string): SupplierOrderStatusValue {
    const parsed = this.parser.parse(xml);
    const result = parsed?.Envelope?.Body?.GetOrdersResponse?.OrdersResult ?? {};
    const ordersRaw = result?.orders?.order ?? result?.order ?? null;
    const order = Array.isArray(ordersRaw) ? ordersRaw[0] : ordersRaw;
    return this.mapStatus(order?.status ?? order?.state ?? result?.status);
  }

  /** Map a Rossko portal status string to our internal status. */
  mapStatus(status: unknown): SupplierOrderStatusValue {
    const s = String(status ?? '').toLowerCase();
    if (!s) return 'PLACED';
    if (s.includes('отмен') || s.includes('cancel')) return 'CANCELLED';
    if (s.includes('выдан') || s.includes('доставлен') || s.includes('получен') || s.includes('deliver')) return 'DELIVERED';
    if (s.includes('отгруж') || s.includes('собран') || s.includes('путь') || s.includes('ship')) return 'SHIPPED';
    if (s.includes('подтвержд') || s.includes('укомплект') || s.includes('confirm')) return 'CONFIRMED';
    return 'PLACED';
  }

  async requestReturn(
    _externalOrderId: string,
    _items: ReturnItem[],
  ): Promise<ReturnResult> {
    throw new NotImplementedException(
      'Rossko requestReturn is not yet implemented — handle return manually.',
    );
  }

  private normalize(value: string): string {
    return String(value ?? '').trim().toUpperCase();
  }

  private toNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  private buildSoapEnvelope(text: string, c: Record<string, string>): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <tns:GetSearch xmlns:tns="https://api.rossko.ru/">
      <tns:KEY1>${c.KEY1}</tns:KEY1>
      <tns:KEY2>${c.KEY2}</tns:KEY2>
      <tns:text>${this.escapeXml(text)}</tns:text>
      <tns:delivery_id>${c.DELIVERY_ID}</tns:delivery_id>
      <tns:address_id>${c.ADDRESS_ID}</tns:address_id>
    </tns:GetSearch>
  </soap:Body>
</soap:Envelope>`;
  }

  /** Build the GetCheckout SOAP envelope (order placement). */
  buildCheckoutEnvelope(items: PlaceOrderItem[], c: Record<string, string> = {}): string {
    const parts = items
      .map((i) => {
        const raw = (i.raw ?? {}) as Record<string, unknown>;
        const partnumber = String(raw.partnumber ?? i.article);
        const stock = String(raw.stockId ?? i.warehouseId);
        return `      <tns:Part>
        <tns:partnumber>${this.escapeXml(partnumber)}</tns:partnumber>
        <tns:brand>${this.escapeXml(i.brand)}</tns:brand>
        <tns:stock>${this.escapeXml(stock)}</tns:stock>
        <tns:count>${this.toNumber(i.quantity)}</tns:count>
      </tns:Part>`;
      })
      .join('\n');
    const requisite = process.env.ROSSKO_REQUISITE_ID
      ? `<tns:requisite_id>${process.env.ROSSKO_REQUISITE_ID}</tns:requisite_id>`
      : '';
    const deliveryParts = process.env.ROSSKO_DELIVERY_PARTS === 'false' ? 'false' : 'true';
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <tns:GetCheckout xmlns:tns="https://api.rossko.ru/">
      <tns:KEY1>${c.KEY1 ?? ''}</tns:KEY1>
      <tns:KEY2>${c.KEY2 ?? ''}</tns:KEY2>
      <tns:delivery>
        <tns:delivery_id>${c.DELIVERY_ID ?? ''}</tns:delivery_id>
        <tns:address_id>${c.ADDRESS_ID ?? ''}</tns:address_id>
      </tns:delivery>
      <tns:payment>
        <tns:payment_id>${process.env.ROSSKO_PAYMENT_ID || '2'}</tns:payment_id>
        ${requisite}
      </tns:payment>
      <tns:contact>
        <tns:name>${this.escapeXml(process.env.ROSSKO_CONTACT_NAME || '')}</tns:name>
        <tns:phone>${this.escapeXml(process.env.ROSSKO_CONTACT_PHONE || '')}</tns:phone>
      </tns:contact>
      <tns:delivery_parts>${deliveryParts}</tns:delivery_parts>
      <tns:PARTS>
${parts}
      </tns:PARTS>
    </tns:GetCheckout>
  </soap:Body>
</soap:Envelope>`;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
