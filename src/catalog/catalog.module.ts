import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogCache } from './cache/catalog-cache.entity';
import { CatalogNameIndex } from './entities/catalog-name-index.entity';
import { CatalogCacheService } from './cache/catalog-cache.service';
import { PartsIndexClient } from './clients/parts-index.client';
import { PartsCatalogsClient } from './clients/parts-catalogs.client';
import { RateLimiterRegistry } from '../suppliers/rate-limiter.registry';
import { PartsIndexService } from './services/parts-index.service';
import { ProductCardService } from './services/product-card.service';
import { PartsCatalogService } from './services/parts-catalog.service';
import { OemCatalogService } from './services/oem-catalog.service';
import { GlobalSearchService } from './services/global-search.service';
import { NameSearchIndex } from './name-search/name-search-index.service';
import { NameIndexBuilder } from './name-search/name-index.builder';
import { PartsController } from './controllers/parts.controller';
import { CatalogController } from './controllers/catalog.controller';
import { OemController } from './controllers/oem.controller';
import { GlobalSearchController } from './controllers/global-search.controller';
import { SearchModule } from '../search/search.module';
import { isPartInfoEnabled } from './clients/catalog-config.util';

// PartsController (/parts/*) is the "информация о детали" surface — registered only when
// PARTSINDEX_PARTINFO_ENABLED !== 'false'. Read at module-decoration time (dotenv is loaded first
// in main.ts, same pattern as SERVE_TEST_FRONTEND in app.module.ts).
const partInfoControllers = isPartInfoEnabled() ? [PartsController] : [];

@Module({
  imports: [TypeOrmModule.forFeature([CatalogCache, CatalogNameIndex]), SearchModule],
  controllers: [...partInfoControllers, CatalogController, OemController, GlobalSearchController],
  providers: [
    RateLimiterRegistry,
    PartsIndexClient,
    PartsCatalogsClient,
    CatalogCacheService,
    PartsIndexService,
    ProductCardService,
    PartsCatalogService,
    OemCatalogService,
    GlobalSearchService,
    NameSearchIndex,
    NameIndexBuilder,
  ],
  exports: [
    PartsIndexClient,
    PartsCatalogsClient,
    CatalogCacheService,
    PartsIndexService,
    PartsCatalogService,
    OemCatalogService,
    NameSearchIndex,
  ],
})
export class CatalogModule {}
