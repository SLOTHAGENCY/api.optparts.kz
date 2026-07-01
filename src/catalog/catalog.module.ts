import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogCache } from './cache/catalog-cache.entity';
import { CatalogCacheService } from './cache/catalog-cache.service';
import { PartsIndexClient } from './clients/parts-index.client';
import { PartsCatalogsClient } from './clients/parts-catalogs.client';
import { RateLimiterRegistry } from '../suppliers/rate-limiter.registry';

@Module({
  imports: [TypeOrmModule.forFeature([CatalogCache])],
  providers: [RateLimiterRegistry, PartsIndexClient, PartsCatalogsClient, CatalogCacheService],
  exports: [PartsIndexClient, PartsCatalogsClient, CatalogCacheService],
})
export class CatalogModule {}
