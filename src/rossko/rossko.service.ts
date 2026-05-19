import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';

export interface NormalizedStock {
  id: string;
  price: number;
  count: number;
  multiplicity: number;
  delivery: number;
  description: string;
  deliveryStart: string | null;
  deliveryEnd: string | null;
}

export interface NormalizedProduct {
  guid: string;
  sku: string;
  name: string;
  brand: string;
  price: number;         // lowest price across all stocks
  images: [];            // external API has no images
  properties: [];        // external API has no properties
  category: null;
  stocks: NormalizedStock[];
}

export interface RosskoSearchResult {
  success: boolean;
  text: string;
  total: number;
  results: NormalizedProduct[];
}

@Injectable()
export class RosskoService {
  private readonly logger = new Logger(RosskoService.name);
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    isArray: (name) => ['Part', 'stock'].includes(name),
  });

  async search(text: string): Promise<RosskoSearchResult> {
    const soap = this.buildSoapEnvelope(text);

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

    return this.parseResponse(rawXml);
  }

  // ─── Build SOAP envelope ──────────────────────────────────────────────────

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

  // ─── Parse & normalize ────────────────────────────────────────────────────

  private parseResponse(xml: string): RosskoSearchResult {
    const parsed = this.parser.parse(xml);

    const searchResult =
      parsed?.Envelope?.Body?.GetSearchResponse?.SearchResult;

    if (!searchResult) {
      throw new BadRequestException('Invalid response from parts API.');
    }

    const success = searchResult.success === true || searchResult.success === 'true';
    const text    = searchResult.text ?? '';
    const rawParts: any[] = searchResult?.PartsList?.Part ?? [];

    // Each top-level Part has crosses — the crosses are the actual
    // orderable products with stocks. We flatten all crosses into
    // a single deduplicated list normalized to product entity shape.
    const seen = new Set<string>();
    const results: NormalizedProduct[] = [];

    for (const part of rawParts) {
      const crosses: any[] = part?.crosses?.Part ?? [];

      for (const cross of crosses) {
        // Deduplicate by guid — same cross can appear under multiple parts
        if (seen.has(cross.guid)) continue;
        seen.add(cross.guid);

        const stocks = this.parseStocks(cross.stocks?.stock ?? []);

        // Use the lowest available price as the product price
        const price = stocks.length
          ? Math.min(...stocks.map((s) => s.price))
          : 0;

        results.push({
          guid:       cross.guid,
          sku:        cross.partnumber,
          name:       cross.name ?? '',
          brand:      cross.brand ?? '',
          price,
          images:     [],
          properties: [],
          category:   null,
          stocks,
        });
      }
    }

    return { success, text, total: results.length, results };
  }

  private parseStocks(rawStocks: any[]): NormalizedStock[] {
    if (!Array.isArray(rawStocks)) return [];

    return rawStocks.map((s: any) => ({
      id:            String(s.id),
      price:         Number(s.price),
      count:         Number(s.count),
      multiplicity:  Number(s.multiplicity),
      delivery:      Number(s.delivery),
      description:   s.description ?? '',
      deliveryStart: s.deliveryStart ?? null,
      deliveryEnd:   s.deliveryEnd   ?? null,
    }));
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