import { PartsIndexClient } from './parts-index.client';
import { PartsCatalogsClient } from './parts-catalogs.client';
import { RateLimiterRegistry } from '../../suppliers/rate-limiter.registry';

describe('provider clients', () => {
  it('PartsIndexClient gates through the rate limiter and delegates to http', async () => {
    const registry = new RateLimiterRegistry();
    const gate = jest.spyOn(registry, 'gate');
    const http = { request: jest.fn(async () => ({ data: { ok: 1 }, headers: {} })) } as any;
    const client = new PartsIndexClient(registry, http);

    const res = await client.request({ path: '/brands/by-part-code', query: { code: 'X' } });

    expect(gate).toHaveBeenCalledWith('partsindex', null, expect.any(Function));
    expect(http.request).toHaveBeenCalledWith({ path: '/brands/by-part-code', query: { code: 'X' } });
    expect(res.data).toEqual({ ok: 1 });
  });

  it('PartsCatalogsClient uses the partscatalogs limiter code', async () => {
    const registry = new RateLimiterRegistry();
    const gate = jest.spyOn(registry, 'gate');
    const http = { request: jest.fn(async () => ({ data: {}, headers: {} })) } as any;
    const client = new PartsCatalogsClient(registry, http);
    await client.request({ path: '/catalogs/' });
    expect(gate).toHaveBeenCalledWith('partscatalogs', null, expect.any(Function));
  });

  it('isConfigured reflects presence of the API key', () => {
    const prev = process.env.PARTSINDEX_API_KEY;
    process.env.PARTSINDEX_API_KEY = '';
    expect(new PartsIndexClient(new RateLimiterRegistry()).isConfigured()).toBe(false);
    process.env.PARTSINDEX_API_KEY = 'PI-KEY';
    expect(new PartsIndexClient(new RateLimiterRegistry()).isConfigured()).toBe(true);
    if (prev === undefined) delete process.env.PARTSINDEX_API_KEY;
    else process.env.PARTSINDEX_API_KEY = prev;
  });
});
