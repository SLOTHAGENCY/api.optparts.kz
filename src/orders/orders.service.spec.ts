import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrdersService, aggregateOrderStatus } from './orders.service';
import { DeliveryType, OrderStatus } from './entities/order.entity';
import { MockConnector } from '../suppliers/connectors/mock/mock.connector';

function makeCheckoutItem(over: Partial<any> = {}) {
  return {
    supplierCode: 'mock',
    article: 'A1',
    brand: 'BOSCH',
    productName: 'Filter',
    costPrice: 5000,
    sellPrice: 6000,
    currentPrice: 6000,
    priceAtAdd: 6000,
    warehouseId: 'w1',
    raw: { stockId: 'w1' },
    quantity: 1,
    available: true,
    priceChanged: false,
    ...over,
  };
}

function makeDeps(items: any[], connectorByCode: Record<string, MockConnector>) {
  const saved: any[] = [];
  const orderRepo = {
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (o: any) => {
      o.id = o.id ?? 'order-1';
      if (!saved.includes(o)) saved.push(o);
      return o;
    }),
    findOne: jest.fn(async () => saved[0] ?? null),
  };
  let subSeq = 0;
  const supplierOrderRepo = {
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (s: any) => {
      s.id = s.id ?? `sub-${++subSeq}`;
      return s;
    }),
    findOne: jest.fn(),
  };
  const cart = {
    getCheckoutItems: jest.fn(async () => items),
    clearCart: jest.fn(async () => undefined),
  };
  const registry = {
    getByCode: jest.fn(async (code: string) => connectorByCode[code]),
  };
  const partnerProducts = { recordOrder: jest.fn(async () => undefined) };
  const addresses = {
    findOne: jest.fn(async (id: string, userId: string) => ({ id, userId })),
  };
  const service = new OrdersService(
    orderRepo as any,
    supplierOrderRepo as any,
    cart as any,
    registry as any,
    partnerProducts as any,
    addresses as any,
  );
  return {
    service,
    orderRepo,
    supplierOrderRepo,
    cart,
    registry,
    partnerProducts,
    addresses,
  };
}

describe('aggregateOrderStatus', () => {
  it('all PLACED => PLACED', () => {
    expect(aggregateOrderStatus(['PLACED', 'PLACED'])).toBe(OrderStatus.PLACED);
  });
  it('any FAILED => PARTIALLY_PLACED', () => {
    expect(aggregateOrderStatus(['PLACED', 'FAILED'])).toBe(
      OrderStatus.PARTIALLY_PLACED,
    );
  });
});

describe('OrdersService.create', () => {
  it('throws 409 when an item is unavailable or price changed', async () => {
    const { service } = makeDeps([makeCheckoutItem({ available: false })], {
      mock: new MockConnector(),
    });
    await expect(service.create('u1', { deliveryType: DeliveryType.PICKUP })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('places all sub-orders and sets Order.PLACED, upserts analytics, clears cart', async () => {
    const mock = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const { service, cart, partnerProducts } = makeDeps([makeCheckoutItem()], {
      mock,
    });
    const order = await service.create('u1', { deliveryType: DeliveryType.PICKUP });
    expect(order.status).toBe(OrderStatus.PLACED);
    expect(order.supplierOrders).toHaveLength(1);
    expect(order.supplierOrders[0].externalOrderId).toBe('EXT-1');
    expect(partnerProducts.recordOrder).toHaveBeenCalledTimes(1);
    expect(cart.clearCart).toHaveBeenCalledWith('u1');
  });

  it('marks Order.PARTIALLY_PLACED when one partner has no order API', async () => {
    const ok = new MockConnector('mock', 'Mock').setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const failing = new MockConnector('rossko', 'Rossko').failWith(
      new Error('No order API'),
    );
    const { service } = makeDeps(
      [
        makeCheckoutItem({ supplierCode: 'mock' }),
        makeCheckoutItem({ supplierCode: 'rossko', warehouseId: 'w2' }),
      ],
      { mock: ok, rossko: failing },
    );
    const order = await service.create('u1', { deliveryType: DeliveryType.PICKUP });
    expect(order.status).toBe(OrderStatus.PARTIALLY_PLACED);
    const failed = order.supplierOrders.find(
      (s: any) => s.supplierCode === 'rossko',
    );
    expect(failed.status).toBe('FAILED');
    expect(failed.errorMessage).toBeTruthy();
  });

  it('snapshots order items independent of live offers', async () => {
    const mock = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const { service } = makeDeps([makeCheckoutItem()], { mock });
    const order = await service.create('u1', { deliveryType: DeliveryType.PICKUP });
    const item = order.items[0];
    expect(item.supplierCode).toBe('mock');
    expect(item.article).toBe('A1');
    expect(item.sellPrice).toBe(6000);
    expect(item.subtotal).toBe(6000);
    expect(item.productId).toBeNull();
  });

  it('requires an addressId for delivery', async () => {
    const { service, addresses } = makeDeps([makeCheckoutItem()], {
      mock: new MockConnector(),
    });
    await expect(
      service.create('u1', { deliveryType: DeliveryType.DELIVERY }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(addresses.findOne).not.toHaveBeenCalled();
  });

  it('validates address ownership and stores it for delivery', async () => {
    const mock = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const { service, addresses } = makeDeps([makeCheckoutItem()], { mock });
    const order = await service.create('u1', {
      deliveryType: DeliveryType.DELIVERY,
      addressId: 'addr-1',
    });
    expect(addresses.findOne).toHaveBeenCalledWith('addr-1', 'u1');
    expect(order.deliveryType).toBe(DeliveryType.DELIVERY);
    expect(order.addressId).toBe('addr-1');
  });

  it('ignores address for pickup orders', async () => {
    const mock = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const { service, addresses } = makeDeps([makeCheckoutItem()], { mock });
    const order = await service.create('u1', {
      deliveryType: DeliveryType.PICKUP,
    });
    expect(addresses.findOne).not.toHaveBeenCalled();
    expect(order.deliveryType).toBe(DeliveryType.PICKUP);
    expect(order.addressId).toBeNull();
  });
});

describe('OrdersService manager controls', () => {
  function makeServiceWithSub(
    sub: any,
    connector: MockConnector,
    items: any[] = [],
  ) {
    const order = {
      id: 'order-1',
      supplierOrders: [sub],
      items,
      status: OrderStatus.PARTIALLY_PLACED,
    };
    const orderRepo = {
      findOne: jest.fn(async () => order),
      save: jest.fn(async (o: any) => o),
    };
    const supplierOrderRepo = {
      findOne: jest.fn(async () => sub),
      save: jest.fn(async (s: any) => s),
    };
    const service = new OrdersService(
      orderRepo as any,
      supplierOrderRepo as any,
      { getCheckoutItems: jest.fn(), clearCart: jest.fn() } as any,
      { getByCode: jest.fn(async () => connector) } as any,
      { recordOrder: jest.fn() } as any,
      { findOne: jest.fn() } as any,
    );
    return { service, order, orderRepo, supplierOrderRepo };
  }

  it('refresh-status updates the sub-order status from the connector', async () => {
    const sub = {
      id: 'sub-1',
      orderId: 'order-1',
      supplierCode: 'mock',
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    };
    const connector = new MockConnector().setStatus('SHIPPED');
    const { service, supplierOrderRepo } = makeServiceWithSub(sub, connector);
    await service.refreshSupplierStatus('order-1', 'sub-1');
    expect(sub.status).toBe('SHIPPED');
    expect(supplierOrderRepo.save).toHaveBeenCalled();
  });

  it('retry re-places a FAILED sub-order and flips it to PLACED', async () => {
    const sub = {
      id: 'sub-1',
      orderId: 'order-1',
      supplierCode: 'mock',
      externalOrderId: null,
      status: 'FAILED',
      errorMessage: 'x',
    };
    const items = [
      {
        supplierCode: 'mock',
        article: 'A1',
        brand: 'BOSCH',
        warehouseId: 'w1',
        quantity: 1,
        raw: {},
      },
    ];
    const connector = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-2',
      status: 'PLACED',
    });
    const { service } = makeServiceWithSub(sub, connector, items);
    await service.retrySupplierOrder('order-1', 'sub-1');
    expect(sub.status).toBe('PLACED');
    expect(sub.externalOrderId).toBe('EXT-2');
  });

  it('return via connector API sets returnStatus from the result', async () => {
    const sub = {
      id: 'sub-1',
      orderId: 'order-1',
      supplierCode: 'mock',
      externalOrderId: 'EXT-1',
      status: 'PLACED',
      returnStatus: null,
    };
    const connector = new MockConnector().setReturnResult({
      returnStatus: 'IN_PROGRESS',
      externalReturnId: 'RET-1',
    });
    const { service } = makeServiceWithSub(sub, connector);
    await service.requestSupplierReturn('order-1', 'sub-1', {
      items: [{ article: 'A1', quantity: 1 }],
    });
    expect(sub.returnStatus).toBe('IN_PROGRESS');
    expect((sub as any).externalReturnId).toBe('RET-1');
  });

  it('return without API falls back to manual REQUESTED', async () => {
    const sub = {
      id: 'sub-1',
      orderId: 'order-1',
      supplierCode: 'rossko',
      externalOrderId: 'EXT-1',
      status: 'PLACED',
      returnStatus: null,
    };
    const connector = new MockConnector('rossko', 'Rossko');
    jest
      .spyOn(connector, 'requestReturn')
      .mockRejectedValue(
        new (require('@nestjs/common').NotImplementedException)('no api'),
      );
    const { service } = makeServiceWithSub(sub, connector);
    await service.requestSupplierReturn('order-1', 'sub-1', {
      items: [{ article: 'A1', quantity: 1 }],
    });
    expect(sub.returnStatus).toBe('REQUESTED');
  });
});

describe('OrdersService cost-price exposure', () => {
  it('public order view strips costPrice from items; manager view keeps it', () => {
    const { service } = makeDeps([], {});
    const svc: any = service;
    const order = {
      status: OrderStatus.PLACED,
      items: [{ article: 'A1', sellPrice: 6000, costPrice: 5000 }],
    };
    const pub = svc.withLabelPublic(order);
    expect(pub.items[0]).not.toHaveProperty('costPrice');
    expect(pub.items[0].sellPrice).toBe(6000);
    const mgr = svc.withLabel(order);
    expect(mgr.items[0].costPrice).toBe(5000);
  });
});
