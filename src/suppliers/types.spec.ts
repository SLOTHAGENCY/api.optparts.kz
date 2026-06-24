import { SUPPLIERS } from './supplier-connector.interface';
import type { SupplierOffer, SupplierOrderStatusValue } from './types';

describe('suppliers types', () => {
  it('exposes the SUPPLIERS DI token as a symbol', () => {
    expect(typeof SUPPLIERS).toBe('symbol');
  });

  it('allows constructing a SupplierOffer object', () => {
    const offer: SupplierOffer = {
      supplierCode: 'rossko',
      article: '0451103316',
      brand: 'BOSCH',
      name: 'Filter',
      costPrice: 5200,
      count: 10,
      deliveryDays: 3,
      multiplicity: 1,
      warehouseId: 'wh-1',
      isAnalog: false,
      raw: { guid: 'g1' },
    };
    const status: SupplierOrderStatusValue = 'NEW';
    expect(offer.supplierCode).toBe('rossko');
    expect(status).toBe('NEW');
  });
});
