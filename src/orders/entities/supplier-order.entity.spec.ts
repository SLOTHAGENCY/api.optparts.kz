import { SupplierOrder } from './supplier-order.entity';
import { OrderStatus } from './order.entity';

describe('SupplierOrder entity', () => {
  it('can hold a placed sub-order', () => {
    const sub = new SupplierOrder();
    sub.supplierCode = 'rossko';
    sub.externalOrderId = 'EXT-1';
    sub.status = 'PLACED';
    sub.errorMessage = null;
    sub.returnStatus = null;
    expect(sub.supplierCode).toBe('rossko');
    expect(sub.status).toBe('PLACED');
  });

  it('OrderStatus exposes PLACED and PARTIALLY_PLACED', () => {
    expect(OrderStatus.PLACED).toBe('placed');
    expect(OrderStatus.PARTIALLY_PLACED).toBe('partially_placed');
  });
});
