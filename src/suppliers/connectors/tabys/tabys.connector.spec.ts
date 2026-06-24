import { TabysConnector } from './tabys.connector';

describe('TabysConnector.mapOffers', () => {
  const connector = new TabysConnector();

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
