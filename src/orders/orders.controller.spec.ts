import { OrdersController } from './orders.controller';

describe('OrdersController sub-order endpoints', () => {
  const service = {
    refreshSupplierStatus: jest.fn(async () => ({ id: 'o1' })),
    retrySupplierOrder: jest.fn(async () => ({ id: 'o1' })),
    requestSupplierReturn: jest.fn(async () => ({ id: 'o1' })),
  };
  const controller = new OrdersController(service as any);

  it('refresh-status delegates with order + sub ids', async () => {
    await controller.refreshSupplierStatus('o1', 's1');
    expect(service.refreshSupplierStatus).toHaveBeenCalledWith('o1', 's1');
  });

  it('retry delegates with order + sub ids', async () => {
    await controller.retrySupplierOrder('o1', 's1');
    expect(service.retrySupplierOrder).toHaveBeenCalledWith('o1', 's1');
  });

  it('return delegates with order id, sub id, and dto', async () => {
    const dto = { items: [{ article: 'A1', quantity: 1 }] };
    await controller.requestSupplierReturn('o1', 's1', dto as any);
    expect(service.requestSupplierReturn).toHaveBeenCalledWith('o1', 's1', dto);
  });
});
