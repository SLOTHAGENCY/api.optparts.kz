import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogCache } from './cache/catalog-cache.entity';
import { CatalogCacheService } from './cache/catalog-cache.service';
import { PartsIndexClient } from './clients/parts-index.client';
import { PartsCatalogsClient } from './clients/parts-catalogs.client';
import { RateLimiterRegistry } from '../suppliers/rate-limiter.registry';
import { PartsIndexService } from './services/parts-index.service';
import { ProductCardService } from './services/product-card.service';
import { PartsCatalogService } from './services/parts-catalog.service';
import { PartsController } from './controllers/parts.controller';
import { CatalogController } from './controllers/catalog.controller';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [TypeOrmModule.forFeature([CatalogCache]), SearchModule],
  controllers: [PartsController, CatalogController],
  providers: [
    RateLimiterRegistry,
    PartsIndexClient,
    PartsCatalogsClient,
    CatalogCacheService,
    PartsIndexService,
    ProductCardService,
    PartsCatalogService,
  ],
  exports: [
    PartsIndexClient,
    PartsCatalogsClient,
    CatalogCacheService,
    PartsIndexService,
    PartsCatalogService,
  ],
})
export class CatalogModule {}
