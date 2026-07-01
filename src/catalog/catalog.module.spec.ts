import { CatalogModule } from './catalog.module';
import { CatalogCacheService } from './cache/catalog-cache.service';
import { PartsIndexClient } from './clients/parts-index.client';
import { PartsCatalogsClient } from './clients/parts-catalogs.client';
import { RateLimiterRegistry } from '../suppliers/rate-limiter.registry';

// The repo unit-tests services by direct instantiation, not by compiling Nest
// modules (which would require a live DataSource). So we assert the module's
// declared wiring via its metadata instead of booting TypeORM.
describe('CatalogModule', () => {
  it('provides the clients, cache service and a rate limiter', () => {
    const providers = (Reflect.getMetadata('providers', CatalogModule) ?? []) as unknown[];
    expect(providers).toEqual(
      expect.arrayContaining([
        RateLimiterRegistry,
        PartsIndexClient,
        PartsCatalogsClient,
        CatalogCacheService,
      ]),
    );
  });

  it('exports the clients and cache service for other modules', () => {
    const exported = (Reflect.getMetadata('exports', CatalogModule) ?? []) as unknown[];
    expect(exported).toEqual(
      expect.arrayContaining([PartsIndexClient, PartsCatalogsClient, CatalogCacheService]),
    );
  });
});
