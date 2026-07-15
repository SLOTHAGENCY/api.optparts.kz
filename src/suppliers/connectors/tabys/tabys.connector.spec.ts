import axios from 'axios';
import { TabysConnector } from './tabys.connector';
import { IndeterminateSupplierError } from '../../indeterminate';

describe('TabysConnector.mapOffers', () => {
  const connector = new TabysConnector({ findByCode: async () => null } as any);

  const sample = {
    items: [
      {
        productId: 'p-1',
        productCode: '0451103316',
        brandName: 'BOSCH',
        productName: 'Oil Filter',
        offeringBlockType: 'RequestedProduct',
        offers: [
          {
            warehouseId: 'wh-1',
            warehouseName: 'Main',
            price: 4333,
            amount: 12,
            minPackSize: 1,
            deliveryInfo: { workDays: 3 },
            priceTemplateId: 'pt-1',
            priceTemplateUniqueCode: 'UC1',
          },
        ],
      },
      {
        productId: 'p-2',
        productCode: 'W7015',
        brandName: 'MANN',
        productName: 'Oil Filter analog',
        offeringBlockType: 'AnalogProduct',
        offers: [
          {
            warehouseId: 'wh-2',
            price: 3900,
            amount: 0,
            deliveryInfo: { workDays: 5 },
            priceTemplateId: 'pt-2',
          },
        ],
      },
    ],
  };

  it('maps offers and flags exact vs analog', () => {
    const offers = connector.mapOffers(sample, '0451103316', 'BOSCH');
    expect(offers).toHaveLength(2);

    const exact = offers[0];
    expect(exact.supplierCode).toBe('tabys');
    expect(exact.article).toBe('0451103316');
    expect(exact.brand).toBe('BOSCH');
    expect(exact.costPrice).toBe(4333);
    expect(exact.count).toBe(12);
    expect(exact.deliveryDays).toBe(3);
    expect(exact.warehouseId).toBe('wh-1');
    expect(exact.isAnalog).toBe(false);
    // raw carries what placeOrder needs
    expect(exact.raw).toMatchObject({ productId: 'p-1', sourceType: 1, sourceId: 'pt-1', price: 4333 });

    const analog = offers[1];
    expect(analog.isAnalog).toBe(true);
    expect(analog.multiplicity).toBe(1); // default when minPackSize missing
  });

  it('skips phantom zero-price offers but keeps priced back-order (amount 0) offers', () => {
    const data = {
      items: [
        {
          productId: 'p-3',
          productCode: '3623',
          brandName: 'NGK',
          productName: 'Spark plug',
          offeringBlockType: 'RequestedProduct',
          offers: [
            // Tabys home-warehouse placeholder: no price, no stock — not orderable.
            { warehouseId: 'wh-phantom', price: 0, amount: 0, deliveryInfo: null },
            // Real back-order line: priced but out of stock — must be kept.
            { warehouseId: 'wh-real', price: 1674, amount: 0, deliveryInfo: { workDays: 10 } },
          ],
        },
      ],
    };
    const offers = connector.mapOffers(data, '3623', 'NGK');
    expect(offers).toHaveLength(1);
    expect(offers[0].costPrice).toBe(1674);
    expect(offers[0].warehouseId).toBe('wh-real');
  });

  it('falls back to the price-template sourceId when a marketplace offer has no warehouseId', () => {
    // Tabys marketplace lines (sourceType 1) arrive with a priceTemplateId but no
    // warehouseId. warehouseId must still be non-empty and unique per offer, else
    // the cart DTO rejects it and every such offer collides on one offerId.
    const data = {
      items: [
        {
          productId: 'p-9',
          productCode: '0451103316',
          brandName: 'BOSCH',
          productName: 'Oil Filter',
          offeringBlockType: 'RequestedProduct',
          offers: [
            { price: 5200, amount: 3, deliveryInfo: { workDays: 4 }, priceTemplateId: 'pt-A' },
            { price: 5300, amount: 1, deliveryInfo: { workDays: 6 }, priceTemplateId: 'pt-B' },
          ],
        },
      ],
    };
    const offers = connector.mapOffers(data, '0451103316', 'BOSCH');
    expect(offers.map((o) => o.warehouseId)).toEqual(['pt-A', 'pt-B']);
  });

  it('accepts a bare array response and empty offers', () => {
    expect(connector.mapOffers([], 'X', 'Y')).toEqual([]);
    expect(connector.mapOffers({ items: [{ productCode: 'A', offers: [] }] }, 'A')).toEqual([]);
  });

  it('maps Tabys statuses defensively', () => {
    expect(connector.mapStatus({ name: 'Shipped' })).toBe('SHIPPED');
    expect(connector.mapStatus({ value: 'Delivered' })).toBe('DELIVERED');
    expect(connector.mapStatus('Cancelled')).toBe('CANCELLED');
    expect(connector.mapStatus(null)).toBe('PLACED');
  });
});

// A transport failure on the order POST leaves the outcome unknown — Tabys may already hold
// the order, so it must surface as indeterminate, never as retryable FAILED.
describe('TabysConnector.placeOrder failure classification', () => {
  function make(postImpl: () => Promise<any>) {
    const connector = new TabysConnector({ findByCode: async () => null } as any);
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
          response: { status: 400, data: { message: 'declined' } },
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
    ['a 5xx with no usable body', { response: { status: 500, data: '' }, request: {} }],
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
