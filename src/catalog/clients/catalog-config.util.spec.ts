import { resolveCatalogConfig } from './catalog-config.util';

describe('resolveCatalogConfig', () => {
  it('uses defaults when env is empty', () => {
    const cfg = resolveCatalogConfig('partsindex', {});
    expect(cfg.baseUrl).toBe('https://api.parts-index.com/v1');
    expect(cfg.apiKey).toBe('');
    expect(cfg.timeoutMs).toBe(15000);
    expect(cfg.rpm).toBeNull();
  });

  it('reads PartsIndex env overrides', () => {
    const cfg = resolveCatalogConfig('partsindex', {
      PARTSINDEX_API_URL: 'http://local/v1',
      PARTSINDEX_API_KEY: 'PI-KEY',
      PARTSINDEX_TIMEOUT_MS: '5000',
      PARTSINDEX_RPM: '60',
    });
    expect(cfg).toEqual({ baseUrl: 'http://local/v1', apiKey: 'PI-KEY', timeoutMs: 5000, rpm: 60 });
  });

  it('reads parts-catalogs env and defaults its base', () => {
    const cfg = resolveCatalogConfig('partscatalogs', { PARTSCATALOGS_API_KEY: 'OEM-KEY' });
    expect(cfg.baseUrl).toBe('https://api.parts-catalogs.com/v1');
    expect(cfg.apiKey).toBe('OEM-KEY');
  });
});
