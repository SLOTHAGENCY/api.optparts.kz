import { MockConnector } from './mock.connector';
import { SupplierOffer } from '../../types';

const offer: SupplierOffer = {
  supplierCode: 'mock',
  article: 'A1',
  brand: 'B',
  name: 'thing',
  costPrice: 1000,
  count: 5,
  deliveryDays: 2,
  multiplicity: 1,
  warehouseId: 'w1',
  isAnalog: false,
  raw: {},
};

describe('MockConnector (contract)', () => {
  it('implements the connector shape', () => {
    const c = new MockConnector();
    expect(c.code).toBe('mock');
    expect(typeof c.search).toBe('function');
    expect(typeof c.placeOrder).toBe('function');
    expect(typeof c.getOrderStatus).toBe('function');
    expect(typeof c.requestReturn).toBe('function');
  });

  it('returns configured offers from search', async () => {
    const c = new MockConnector();
    c.setOffers([offer]);
    await expect(c.search('A1', 'B')).resolves.toEqual([offer]);
  });

  it('search rejects when failWith is set', async () => {
    const c = new MockConnector();
    c.failWith(new Error('partner down'));
    await expect(c.search('A1')).rejects.toThrow('partner down');
  });

  it('placeOrder returns the configured result', async () => {
    const c = new MockConnector();
    c.setOrderResult({ externalOrderId: 'EXT-1', status: 'PLACED' });
    await expect(c.placeOrder([])).resolves.toEqual({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
  });

  it('getOrderStatus returns the configured status', async () => {
    const c = new MockConnector();
    c.setStatus('SHIPPED');
    await expect(c.getOrderStatus('EXT-1')).resolves.toBe('SHIPPED');
  });
});
