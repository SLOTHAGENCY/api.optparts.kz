import { Injectable, Optional } from '@nestjs/common';
import { RateLimiterRegistry } from '../../suppliers/rate-limiter.registry';
import { resolveCatalogConfig } from './catalog-config.util';
import { CatalogHttpClient, CatalogRequest, CatalogResponse } from './catalog-http.client';

@Injectable()
export class PartsIndexClient {
  private readonly http: CatalogHttpClient;
  private readonly rpm: number | null;

  constructor(
    private readonly rateLimiter: RateLimiterRegistry,
    @Optional() http?: CatalogHttpClient,
  ) {
    const cfg = resolveCatalogConfig('partsindex');
    this.rpm = cfg.rpm;
    this.http = http ?? new CatalogHttpClient({ provider: 'partsindex', ...cfg });
  }

  isConfigured(): boolean {
    return resolveCatalogConfig('partsindex').apiKey.trim() !== '';
  }

  request<T>(req: CatalogRequest): Promise<CatalogResponse<T>> {
    return this.rateLimiter.gate('partsindex', this.rpm, () => this.http.request<T>(req));
  }
}
