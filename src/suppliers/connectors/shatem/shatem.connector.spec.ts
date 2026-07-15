import axios from 'axios';
import { ShateMConnector } from './shatem.connector';
import { IndeterminateSupplierError } from '../../indeterminate';

describe('ShateMConnector.mapOffers', () => {
  const connector = new ShateMConnector({ findByCode: async () => null } as any);

  // Response shape per the live spec: array of ArticlePriceCard { article, prices[] }.
  const sample = [
    {
      article: { id: 1248288, code: '0451103316', tradeMarkName: 'BOSCH', name: 'Oil Filter' },
      prices: [
        {
          id: 'price-1',
          locationCode: 'L1',
          price: { value: 4333, valueWithMargin: 5000 },
          quantity: { available: 12, multiplicity: 1 },
          deliveryDateTimes: [{ deliveryDateTime: '2999-01-01T00:00:00Z' }],
          addInfo: { isReturnAllowed: true },
        },
      ],
    },
    {
      article: { id: 999, code: 'W7015', tradeMarkName: 'MANN', name: 'Analog' },
      prices: [
        {
          id: 'price-2',
          locationCode: 'L2',
          price: { value: 3900 },
          quantity: { available: 0 },
          deliveryDateTimes: [],
        },
      ],
    },
  ];

  it('maps ArticlePriceCard offers, flags analog, uses price.value as cost', () => {
    const offers = connector.mapOffers(sample, '0451103316', 'BOSCH');
    expect(offers).toHaveLength(2);

    const exact = offers[0];
    expect(exact.supplierCode).toBe('shatem');
    expect(exact.article).toBe('0451103316');
    expect(exact.brand).toBe('BOSCH');
    expect(exact.costPrice).toBe(4333); // value, not valueWithMargin
    expect(exact.count).toBe(12);
    expect(exact.warehouseId).toBe('L1');
    expect(exact.isAnalog).toBe(false);
    expect(exact.deliveryDays).toBeGreaterThan(0);
    expect(exact.raw).toMatchObject({
      offerKey: 'price-1',
      priceId: 'price-1',
      queryArticle: '0451103316',
      valueWithMargin: 5000,
    });

    expect(offers[1].isAnalog).toBe(true);
    expect(offers[1].multiplicity).toBe(1);
  });

  it('handles empty responses', () => {
    expect(connector.mapOffers([], 'X', 'Y')).toEqual([]);
    expect(connector.mapOffers([{ article: { code: 'A' }, prices: [] }], 'A')).toEqual([]);
  });

  it('maps numeric status codes defensively', () => {
    expect(connector.mapStatus(95)).toBe('DELIVERED');
    expect(connector.mapStatus(75)).toBe('SHIPPED');
    expect(connector.mapStatus(45)).toBe('CONFIRMED');
    expect(connector.mapStatus(10)).toBe('PLACED');
    expect(connector.mapStatus(-1)).toBe('CANCELLED');
  });
});

// A transport failure on the order POST leaves the outcome unknown — SHATE-M may already hold
// the order, so it must surface as indeterminate, never as retryable FAILED.
describe('ShateMConnector.placeOrder failure classification', () => {
  function make(postImpl: () => Promise<any>) {
    const connector = new ShateMConnector({ findByCode: async () => null } as any);
    // Skip auth: pre-seed the token cache so placeOrder goes straight to the order POST.
    (connector as any).token = 'cached-token';
    (connector as any).tokenExpiresAt = Date.now() + 3600_000;
    jest
      .spyOn(axios, 'create')
      .mockReturnValue({ post: jest.fn(postImpl) } as any);
    return connector;
  }
  afterEach(() => jest.restoreAllMocks());

  it('returns FAILED on a definite supplier decline (4xx)', async () => {
    const connector = make(() =>
      Promise.reject(
        Object.assign(new Error('400'), {
          response: { status: 400, data: { description: 'declined' } },
          request: {},
        }),
      ),
    );
    const res = await connector.placeOrder([]);
    expect(res.status).toBe('FAILED');
  });

  it.each([
    ['a timeout', { code: 'ECONNABORTED', request: {} }],
    ['a connection reset', { code: 'ECONNRESET', request: {} }],
    ['a 5xx with no usable body', { response: { status: 503, data: '' }, request: {} }],
  ])(
    'throws IndeterminateSupplierError on %s',
    async (_label, shape) => {
      const connector = make(() =>
        Promise.reject(Object.assign(new Error('boom'), shape)),
      );
      await expect(connector.placeOrder([])).rejects.toBeInstanceOf(
        IndeterminateSupplierError,
      );
    },
  );
});
