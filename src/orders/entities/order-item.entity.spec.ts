import { OrderItem } from './order-item.entity';

describe('OrderItem snapshot fields', () => {
  it('holds aggregator offer snapshot fields', () => {
    const item = new OrderItem();
    item.productId = null;
    item.supplierCode = 'rossko';
    item.article = '0451103316';
    item.brand = 'BOSCH';
    item.costPrice = 5200;
    item.sellPrice = 6240;
    item.warehouseId = 's1';
    item.raw = { guid: 'g1', stockId: 's1' };
    item.quantity = 2;
    item.subtotal = 12480;

    expect(item.productId).toBeNull();
    expect(item.supplierCode).toBe('rossko');
    expect(item.raw).toMatchObject({ guid: 'g1' });
    expect(item.sellPrice).toBe(6240);
  });
});
