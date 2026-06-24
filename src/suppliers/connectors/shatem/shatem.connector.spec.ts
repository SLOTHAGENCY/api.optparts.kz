import { ShateMConnector } from './shatem.connector';

describe('ShateMConnector.mapOffers', () => {
  const connector = new ShateMConnector();

  const grouped = {
    items: [
      {
        article: { id: 'a-1', code: '0451103316', tradeMarkName: 'BOSCH', name: 'Oil Filter' },
        prices: [
          {
            id: 'price-1',
            locationCode: 'L1',
            price: { value: 4333, valueWithMargin: 5000 },
            quantity: { available: 12, multiplicity: 1 },
            deliveryDateTimes: [{ deliveryDateTime: '2999-01-01T00:00:00Z' }],
          },
        ],
      },
      {
        article: { id: 'a-2', code: 'W7015', tradeMarkName: 'MANN', name: 'Analog' },
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
    ],
  };

  it('maps grouped offers, flags analog, derives identity', () => {
    const offers = connector.mapOffers(grouped, '0451103316', 'BOSCH');
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
    expect(exact.raw).toMatchObject({ offerKey: 'price-1', priceId: 'price-1', queryArticle: '0451103316' });

    expect(offers[1].isAnalog).toBe(true);
    expect(offers[1].multiplicity).toBe(1);
  });

  it('handles empty and bare-array responses', () => {
    expect(connector.mapOffers([], 'X', 'Y')).toEqual([]);
    expect(connector.mapOffers({ items: [] }, 'X')).toEqual([]);
  });

  it('maps numeric status codes defensively', () => {
    expect(connector.mapStatus(95)).toBe('DELIVERED');
    expect(connector.mapStatus(75)).toBe('SHIPPED');
    expect(connector.mapStatus(45)).toBe('CONFIRMED');
    expect(connector.mapStatus(10)).toBe('PLACED');
    expect(connector.mapStatus(-1)).toBe('CANCELLED');
  });
});
