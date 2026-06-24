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

@Injectable()
export class RosskoConnector implements SupplierConnector {
  readonly code = 'rossko';
  readonly name = 'Rossko';

  private readonly logger = new Logger(RosskoConnector.name);
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    isArray: (name) => ['Part', 'stock'].includes(name),
  });

  async search(article: string, brand?: string): Promise<SupplierOffer[]> {
    const soap = this.buildSoapEnvelope(article);
    let rawXml: string;
    try {
      const response = await axios.post(
        `${process.env.ROSSKO_API_URL}/service/v2.1/GetSearch`,
        soap,
        {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: 'https://api.rossko.ru/service/v2.1/GetSearch',
          },
          timeout: 15000,
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
            costPrice: Number(stock.price),
            count: Number(stock.count),
            deliveryDays: Number(stock.delivery),
            multiplicity: Number(stock.multiplicity),
            warehouseId,
            isAnalog,
            raw: {
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

  async placeOrder(_items: PlaceOrderItem[]): Promise<SupplierOrderResult> {
    throw new NotImplementedException(
      'Rossko placeOrder is not yet implemented — order requires manual processing (see Spec C).',
    );
  }

  async getOrderStatus(_externalOrderId: string): Promise<SupplierOrderStatusValue> {
    throw new NotImplementedException(
      'Rossko getOrderStatus is not yet implemented.',
    );
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

  private buildSoapEnvelope(text: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <tns:GetSearch xmlns:tns="https://api.rossko.ru/">
      <tns:KEY1>${process.env.ROSSKO_KEY1}</tns:KEY1>
      <tns:KEY2>${process.env.ROSSKO_KEY2}</tns:KEY2>
      <tns:text>${this.escapeXml(text)}</tns:text>
      <tns:delivery_id>${process.env.ROSSKO_DELIVERY_ID}</tns:delivery_id>
      <tns:address_id>${process.env.ROSSKO_ADDRESS_ID}</tns:address_id>
    </tns:GetSearch>
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
