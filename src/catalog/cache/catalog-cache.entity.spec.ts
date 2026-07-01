import { CatalogCache } from './catalog-cache.entity';
import { getMetadataArgsStorage } from 'typeorm';

describe('CatalogCache entity', () => {
  it('maps to the catalog_cache table', () => {
    const table = getMetadataArgsStorage().tables.find((t) => t.target === CatalogCache);
    expect(table?.name).toBe('catalog_cache');
  });

  it('declares the expected columns', () => {
    const cols = getMetadataArgsStorage()
      .columns.filter((c) => c.target === CatalogCache)
      .map((c) => c.propertyName);
    expect(cols).toEqual(
      expect.arrayContaining(['id', 'provider', 'endpoint', 'paramsHash', 'payload', 'createdAt', 'expiresAt']),
    );
  });
});
