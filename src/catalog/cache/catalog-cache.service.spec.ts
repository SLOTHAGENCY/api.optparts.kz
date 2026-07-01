import { CatalogCacheService } from './catalog-cache.service';

function repoMock(row: any = null) {
  return {
    findOne: jest.fn(async () => row),
    upsert: jest.fn(async () => ({})),
  } as any;
}

const key = { provider: 'partsindex' as const, endpoint: '/brands', params: { code: 'X' } };

describe('CatalogCacheService', () => {
  it('fetches and upserts on a cache miss', async () => {
    const repo = repoMock(null);
    const now = 1000;
    const svc = new CatalogCacheService(repo, () => now);
    const fetchFn = jest.fn(async () => ({ list: [1] }));

    const out = await svc.getOrFetch(key, 5000, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ list: [1] });
    const [entity, conflict] = repo.upsert.mock.calls[0];
    expect(entity.provider).toBe('partsindex');
    expect(entity.endpoint).toBe('/brands');
    expect(entity.paramsHash).toHaveLength(64);
    expect(new Date(entity.expiresAt).getTime()).toBe(6000);
    expect(conflict).toEqual(['provider', 'endpoint', 'paramsHash']);
  });

  it('returns cached payload without fetching when not expired', async () => {
    const repo = repoMock({ payload: { cached: true }, expiresAt: new Date(10_000) });
    const svc = new CatalogCacheService(repo, () => 5000);
    const fetchFn = jest.fn(async () => ({ cached: false }));

    const out = await svc.getOrFetch(key, 5000, fetchFn);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(out).toEqual({ cached: true });
  });

  it('refetches when the row is expired', async () => {
    const repo = repoMock({ payload: { cached: true }, expiresAt: new Date(4000) });
    const svc = new CatalogCacheService(repo, () => 5000);
    const fetchFn = jest.fn(async () => ({ fresh: true }));

    const out = await svc.getOrFetch(key, 5000, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ fresh: true });
  });

  it('hashes params order-independently', async () => {
    const repo = repoMock(null);
    const svc = new CatalogCacheService(repo, () => 0);
    await svc.getOrFetch({ ...key, params: { a: 1, b: 2 } }, 1, async () => 1);
    await svc.getOrFetch({ ...key, params: { b: 2, a: 1 } }, 1, async () => 1);
    expect(repo.upsert.mock.calls[0][0].paramsHash).toBe(repo.upsert.mock.calls[1][0].paramsHash);
  });
});
