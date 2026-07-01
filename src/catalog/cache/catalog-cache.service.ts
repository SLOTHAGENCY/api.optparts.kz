import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { CatalogCache } from './catalog-cache.entity';
import { CatalogProvider } from '../clients/catalog-config.util';

export interface CatalogCacheKey {
  provider: CatalogProvider;
  endpoint: string;
  params: Record<string, unknown>;
}

@Injectable()
export class CatalogCacheService {
  constructor(
    @InjectRepository(CatalogCache)
    private readonly repo: Repository<CatalogCache>,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async getOrFetch<T>(
    key: CatalogCacheKey,
    ttlMs: number,
    fetchFn: () => Promise<T>,
  ): Promise<T> {
    const paramsHash = this.hash(key.params);
    const now = this.clock();
    const row = await this.repo.findOne({
      where: { provider: key.provider, endpoint: key.endpoint, paramsHash },
    });
    if (row && new Date(row.expiresAt).getTime() > now) {
      return row.payload as T;
    }
    const value = await fetchFn();
    await this.repo.upsert(
      {
        provider: key.provider,
        endpoint: key.endpoint,
        paramsHash,
        payload: value as unknown,
        expiresAt: new Date(now + ttlMs),
      },
      ['provider', 'endpoint', 'paramsHash'],
    );
    return value;
  }

  private hash(params: Record<string, unknown>): string {
    const stable = JSON.stringify(params, Object.keys(params).sort());
    return createHash('sha256').update(stable).digest('hex');
  }
}
