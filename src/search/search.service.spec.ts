import { SearchService } from './search.service';
import { MockConnector } from '../suppliers/connectors/mock/mock.connector';
import { SupplierOffer } from '../suppliers/types';
import { decodeOfferId } from './offer-id.util';

function offer(over: Partial<SupplierOffer>): SupplierOffer {
  return {
    supplierCode: 'mock',
    article: 'A1',
    brand: 'B',
    name: 'Thing',
    costPrice: 1000,
    currency: 'KZT',
    count: 5,
    deliveryDays: 3,
    multiplicity: 1,
    warehouseId: 'w1',
    isAnalog: false,
    raw: {},
    ...over,
  };
}

function makeService(connectors: any[], saveImpl?: jest.Mock) {
  const registry = { getActive: jest.fn(async () => connectors) };
  // Default markup: +20% rounded.
  const pricing = {
    applyMarkup: jest.fn(async (cost: number) => Math.round(cost * 1.2)),
  };
  const repo = { save: saveImpl ?? jest.fn(async (e: any) => e) };
  const service = new SearchService(registry as any, pricing as any, repo as any);
  return { service, registry, pricing, repo };
}

describe('SearchService.search', () => {
  const OLD_TIMEOUT = process.env.SEARCH_TIMEOUT_MS;
  afterEach(() => {
    process.env.SEARCH_TIMEOUT_MS = OLD_TIMEOUT;
    jest.useRealTimers();
  });

  it('ranks offers within a group by price, then delivery, then count', async () => {
    const c = new MockConnector('mock', 'Mock').setOffers([
      offer({ warehouseId: 'expensive', costPrice: 2000 }),
      offer({ warehouseId: 'cheap-slow', costPrice: 1000, deliveryDays: 9 }),
      offer({ warehouseId: 'cheap-fast', costPrice: 1000, deliveryDays: 1 }),
    ]);
    const { service } = makeService([c]);
    const res = await service.search('A1', 'B');
    expect(res.exact).toHaveLength(1);
    expect(res.exact[0].offers.map((o) => o.warehouseId)).toEqual([
      'cheap-fast',
      'cheap-slow',
      'expensive',
    ]);
  });

  it('separates exact from analogs and prices both with markup, hiding costPrice', async () => {
    const c = new MockConnector('mock', 'Mock').setOffers([
      offer({ warehouseId: 'x', isAnalog: false, costPrice: 1000 }),
      offer({ warehouseId: 'a', isAnalog: true, article: 'A1-ANALOG', costPrice: 500 }),
    ]);
    const { service } = makeService([c]);
    const res = await service.search('A1', 'B');
    expect(res.exact).toHaveLength(1);
    expect(res.analogs).toHaveLength(1);
    expect(res.exact[0].offers[0].sellPrice).toBe(1200); // 1000 * 1.2
    expect(res.analogs[0].offers[0].sellPrice).toBe(600); // 500 * 1.2
    expect(res.exact[0].offers[0]).not.toHaveProperty('costPrice');
    expect(res.exact[0].offers[0].supplierName).toBe('Mock');
  });

  it('embeds a decodable offerId carrying supplier/article/brand/warehouse', async () => {
    const c = new MockConnector('mock', 'Mock').setOffers([
      offer({ warehouseId: 'w7', article: 'A1', brand: 'B' }),
    ]);
    const { service } = makeService([c]);
    const res = await service.search('A1', 'B');
    const { offerId } = res.exact[0].offers[0];
    expect(decodeOfferId(offerId)).toEqual({
      supplierCode: 'mock',
      article: 'A1',
      brand: 'B',
      warehouseId: 'w7',
    });
  });

  it('does not drop the feed when a supplier fails; counts it in suppliersFailed', async () => {
    const ok = new MockConnector('ok', 'Ok').setOffers([offer({ supplierCode: 'ok' })]);
    const bad = new MockConnector('bad', 'Bad').failWith(new Error('partner down'));
    const { service, repo } = makeService([ok, bad]);
    const res = await service.search('A1', 'B');
    expect(res.exact).toHaveLength(1);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ suppliersQueried: 2, suppliersFailed: 1, totalResults: 1 }),
    );
  });

  it('counts a timed-out supplier as failed without dropping results', async () => {
    jest.useFakeTimers();
    process.env.SEARCH_TIMEOUT_MS = '100';
    const fast = new MockConnector('fast', 'Fast').setOffers([offer({ supplierCode: 'fast' })]);
    const slow = new MockConnector('slow', 'Slow').setOffers([offer({ supplierCode: 'slow' })]).timeoutMs(5000);
    const { service } = makeService([fast, slow]);
    const promise = service.search('A1', 'B');
    await jest.advanceTimersByTimeAsync(200);
    const res = await promise;
    const failed = res.analogs.length + res.exact.length; // only 'fast' contributed a group
    expect(failed).toBe(1);
    expect(res.exact[0].offers[0].supplierCode).toBe('fast');
  });

  it('writes search_log with the resolved userId', async () => {
    const c = new MockConnector('mock', 'Mock').setOffers([offer({})]);
    const { service, repo } = makeService([c]);
    await service.search('A1', 'B', 'user-123');
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-123', article: 'A1', brand: 'B' }),
    );
  });

  it('still returns results when the search_log write rejects', async () => {
    const c = new MockConnector('mock', 'Mock').setOffers([offer({})]);
    const failingSave = jest.fn(async () => {
      throw new Error('db down');
    });
    const { service } = makeService([c], failingSave);
    await expect(service.search('A1', 'B')).resolves.toMatchObject({ exact: expect.any(Array) });
    // allow the swallowed rejection's microtask to settle
    await new Promise((r) => setImmediate(r));
    expect(failingSave).toHaveBeenCalled();
  });

  it('merges same article+brand of different casing into one group', () => {
    const { service } = makeService([]);
    const svc: any = service;
    const offers = [
      { article: '0451103316', brand: 'BOSCH', name: 'Filter', isAnalog: false,
        dto: { sellPrice: 200, deliveryDays: 1, count: 5 } },
      { article: '0451103316', brand: 'Bosch', name: 'Filter', isAnalog: false,
        dto: { sellPrice: 100, deliveryDays: 2, count: 9 } },
    ];
    const { exact } = svc.groupAndRank(offers);
    expect(exact).toHaveLength(1);
    expect(exact[0].offers).toHaveLength(2);
    expect(exact[0].offers[0].sellPrice).toBe(100); // cheapest first
  });
});
