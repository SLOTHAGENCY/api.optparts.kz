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

function makeDeps(
  items: any[],
  connectorByCode: Record<string, MockConnector>,
  mode: 'test' | 'prod' = 'prod',
) {
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
  const suppliersService = { findByCode: jest.fn(async () => ({ rateLimitRpm: null })) };
  const rateLimiter = { gate: jest.fn(async (_code: any, _rpm: any, fn: () => any) => fn()) };
  const addresses = {
    findOne: jest.fn(async (id: string, userId: string) => ({ id, userId })),
  };
  const settings = { getOrderMode: jest.fn(async () => mode) };
  const service = new OrdersService(
    orderRepo as any,
    supplierOrderRepo as any,
    cart as any,
    registry as any,
    partnerProducts as any,
    suppliersService as any,
    rateLimiter as any,
    addresses as any,
    settings as any,
  );
  return {
    service,
    orderRepo,
    supplierOrderRepo,
    cart,
    registry,
    partnerProducts,
    addresses,
    settings,
  };
}

describe('aggregateOrderStatus', () => {
  it('returns PLACED when every sub-order was placed', () => {
    expect(aggregateOrderStatus(['PLACED', 'PLACED'])).toBe(OrderStatus.PLACED);
  });

  it('returns PARTIALLY_PLACED when some placed and some failed', () => {
    expect(aggregateOrderStatus(['PLACED', 'FAILED'])).toBe(
      OrderStatus.PARTIALLY_PLACED,
    );
  });

  // Money is on the line: nothing was placed, so the order is dead and the manager
  // must see it as a refund candidate — not as "partially placed".
  it('returns CANCELLED when every sub-order failed', () => {
    expect(aggregateOrderStatus(['FAILED', 'FAILED'])).toBe(
      OrderStatus.CANCELLED,
    );
  });

  it('returns CANCELLED for an empty list', () => {
    expect(aggregateOrderStatus([])).toBe(OrderStatus.CANCELLED);
  });
});

describe('OrdersService.create — payment first', () => {
  it('throws 409 when an item is unavailable or price changed', async () => {
    const { service } = makeDeps([makeCheckoutItem({ available: false })], {
      mock: new MockConnector(),
    });
    await expect(service.create('u1', { deliveryType: DeliveryType.PICKUP })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('creates the order in awaiting_payment and does NOT contact suppliers', async () => {
    const connector = new MockConnector();
    const placeSpy = jest.spyOn(connector, 'placeOrder');
    const { service, supplierOrderRepo } = makeDeps([makeCheckoutItem()], {
      mock: connector,
    });

    const order = await service.create('user-1', {
      deliveryType: DeliveryType.DELIVERY,
      addressId: 'addr-1',
    } as any);

    expect(order.status).toBe(OrderStatus.AWAITING_PAYMENT);
    expect(placeSpy).not.toHaveBeenCalled();
    expect(supplierOrderRepo.save).not.toHaveBeenCalled();
  });

  // The customer may close the tab before paying — their cart must survive.
  it('does not clear the cart at creation time', async () => {
    const { service, cart, partnerProducts } = makeDeps([makeCheckoutItem()], {
      mock: new MockConnector(),
    });

    await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);

    expect(cart.clearCart).not.toHaveBeenCalled();
    expect(partnerProducts.recordOrder).not.toHaveBeenCalled();
  });

  it('snapshots order items independent of live offers', async () => {
    const { service } = makeDeps([makeCheckoutItem()], {
      mock: new MockConnector(),
    });
    const order = await service.create('u1', { deliveryType: DeliveryType.PICKUP });
    const item = order.items[0];
    expect(item.supplierCode).toBe('mock');
    expect(item.article).toBe('A1');
    expect(item.sellPrice).toBe(6000);
    expect(item.subtotal).toBe(6000);
    expect(item.productId).toBeNull();
  });

  it('flags the order as isTest in test mode', async () => {
    const { service } = makeDeps(
      [makeCheckoutItem()],
      { mock: new MockConnector() },
      'test',
    );
    const order = await service.create('u1', {
      deliveryType: DeliveryType.PICKUP,
    });
    expect(order.isTest).toBe(true);
    expect(order.status).toBe(OrderStatus.AWAITING_PAYMENT);
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

  it('persists recipientName, recipientPhone and customerComment for delivery orders', async () => {
    const mock = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const { service } = makeDeps([makeCheckoutItem()], { mock });
    const order = await service.create('u1', {
      deliveryType: DeliveryType.DELIVERY,
      addressId: 'addr-1',
      recipientName: 'Ivan Ivanov',
      recipientPhone: '+7 700 123 45 67',
      customerComment: 'Call before delivery',
    } as any);
    expect(order.recipientName).toBe('Ivan Ivanov');
    expect(order.recipientPhone).toBe('+7 700 123 45 67');
    expect(order.customerComment).toBe('Call before delivery');
  });

  it('defaults recipient fields to null when not provided', async () => {
    const mock = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const { service } = makeDeps([makeCheckoutItem()], { mock });
    const order = await service.create('u1', {
      deliveryType: DeliveryType.PICKUP,
    });
    expect(order.recipientName).toBeNull();
    expect(order.recipientPhone).toBeNull();
    expect(order.customerComment).toBeNull();
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

describe('OrdersService.placeWithSuppliers', () => {
  it('places every supplier group, clears the cart and marks the order placed', async () => {
    const connector = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const { service, cart, supplierOrderRepo, partnerProducts } = makeDeps(
      [makeCheckoutItem()],
      { mock: connector },
    );

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);

    const placed = await service.placeWithSuppliers(created.id);

    expect(supplierOrderRepo.save).toHaveBeenCalled();
    expect(placed.status).toBe(OrderStatus.PLACED);
    expect(placed.supplierOrders).toHaveLength(1);
    expect(placed.supplierOrders[0].externalOrderId).toBe('EXT-1');
    expect(cart.clearCart).toHaveBeenCalledWith('user-1');
    expect(partnerProducts.recordOrder).toHaveBeenCalledTimes(1);
  });

  it('marks the order PARTIALLY_PLACED when one partner has no order API', async () => {
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

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);
    const placed = await service.placeWithSuppliers(created.id);

    expect(placed.status).toBe(OrderStatus.PARTIALLY_PLACED);
    const failed = (placed.supplierOrders ?? []).find(
      (s: any) => s.supplierCode === 'rossko',
    );
    expect(failed!.status).toBe('FAILED');
    expect(failed!.errorMessage).toBeTruthy();
  });

  it('cancels the order when every supplier fails', async () => {
    const connector = new MockConnector();
    jest
      .spyOn(connector, 'placeOrder')
      .mockRejectedValue(new Error('supplier down'));
    const { service } = makeDeps([makeCheckoutItem()], { mock: connector });

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);

    const placed = await service.placeWithSuppliers(created.id);

    expect(placed.status).toBe(OrderStatus.CANCELLED);
  });

  it('is a no-op when the order was already placed (webhook retry)', async () => {
    const connector = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const placeSpy = jest.spyOn(connector, 'placeOrder');
    const { service, cart } = makeDeps([makeCheckoutItem()], {
      mock: connector,
    });

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);

    await service.placeWithSuppliers(created.id);
    const callsAfterFirst = placeSpy.mock.calls.length;
    await service.placeWithSuppliers(created.id);

    expect(placeSpy.mock.calls.length).toBe(callsAfterFirst);
    expect(cart.clearCart).toHaveBeenCalledTimes(1);
  });

  it('skips suppliers in test mode', async () => {
    const connector = new MockConnector();
    const placeSpy = jest.spyOn(connector, 'placeOrder');
    const { service } = makeDeps(
      [makeCheckoutItem()],
      { mock: connector },
      'test',
    );

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);
    const placed = await service.placeWithSuppliers(created.id);

    expect(placeSpy).not.toHaveBeenCalled();
    expect(placed.status).toBe(OrderStatus.PAID);
    expect(placed.supplierOrders).toHaveLength(1);
    expect(placed.supplierOrders[0].status).toBe('NEW');
    expect(placed.supplierOrders[0].externalOrderId).toBeNull();
    expect(placed.supplierOrders[0].isTest).toBe(true);
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
    const rateLimiter = { gate: jest.fn(async (_code: any, _rpm: any, fn: () => any) => fn()) };
    const service = new OrdersService(
      orderRepo as any,
      supplierOrderRepo as any,
      { getCheckoutItems: jest.fn(), clearCart: jest.fn() } as any,
      { getByCode: jest.fn(async () => connector) } as any,
      { recordOrder: jest.fn() } as any,
      { findByCode: jest.fn(async () => ({ rateLimitRpm: null })) } as any,
      rateLimiter as any,
      { findOne: jest.fn() } as any,
      { getOrderMode: jest.fn(async () => 'prod') } as any,
    );
    return { service, order, orderRepo, supplierOrderRepo, rateLimiter };
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

  it('retry routes placeOrder through the rate limiter gate', async () => {
    const sub = {
      id: 'sub-1',
      orderId: 'order-1',
      supplierCode: 'mock',
      externalOrderId: null,
      status: 'FAILED',
      errorMessage: 'previous error',
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
      externalOrderId: 'EXT-3',
      status: 'PLACED',
    });
    const { service, rateLimiter } = makeServiceWithSub(sub, connector, items);
    await service.retrySupplierOrder('order-1', 'sub-1');
    expect(rateLimiter.gate).toHaveBeenCalledWith('mock', null, expect.any(Function));
    expect(sub.status).toBe('PLACED');
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

describe('OrdersService.pollActiveSupplierStatuses', () => {
  function makePollDeps(
    subs: any[],
    connectorByCode: Record<string, MockConnector>,
  ) {
    const supplierOrderRepo = {
      find: jest.fn(async () => subs),
      save: jest.fn(async (s: any) => s),
    };
    const orderRepo = {
      findOne: jest.fn(async ({ where }: any) => ({
        id: where.id,
        supplierOrders: [],
        status: OrderStatus.PLACED,
      })),
      save: jest.fn(async (o: any) => o),
    };
    const registry = {
      getByCode: jest.fn(async (code: string) => connectorByCode[code]),
    };
    const service = new OrdersService(
      orderRepo as any,
      supplierOrderRepo as any,
      { getCheckoutItems: jest.fn(), clearCart: jest.fn() } as any,
      registry as any,
      { recordOrder: jest.fn() } as any,
      { findByCode: jest.fn() } as any,
      { gate: jest.fn() } as any,
      { findOne: jest.fn() } as any,
      { getOrderMode: jest.fn() } as any,
    );
    return { service, supplierOrderRepo, orderRepo, registry };
  }

  it('persists changed statuses and re-aggregates only the orders that moved', async () => {
    const subs = [
      {
        id: 'sub-1',
        orderId: 'order-1',
        supplierCode: 'mock',
        externalOrderId: 'EXT-1',
        status: 'PLACED',
      },
      {
        id: 'sub-2',
        orderId: 'order-2',
        supplierCode: 'rossko',
        externalOrderId: 'EXT-2',
        status: 'CONFIRMED',
      },
    ];
    const { service, supplierOrderRepo, orderRepo } = makePollDeps(subs, {
      mock: new MockConnector('mock').setStatus('SHIPPED'),
      rossko: new MockConnector('rossko').setStatus('CONFIRMED'), // unchanged
    });
    const res = await service.pollActiveSupplierStatuses();
    expect(res).toEqual({ checked: 2, updated: 1, failed: 0 });
    expect(subs[0].status).toBe('SHIPPED');
    expect(subs[1].status).toBe('CONFIRMED');
    expect(supplierOrderRepo.save).toHaveBeenCalledTimes(1);
    // Only order-1 moved, so only it is re-aggregated.
    expect(orderRepo.findOne).toHaveBeenCalledWith({ where: { id: 'order-1' } });
    expect(orderRepo.findOne).not.toHaveBeenCalledWith({
      where: { id: 'order-2' },
    });
  });

  it('skips sub-orders with no externalOrderId', async () => {
    const subs = [
      {
        id: 'sub-1',
        orderId: 'order-1',
        supplierCode: 'mock',
        externalOrderId: null,
        status: 'PLACED',
      },
    ];
    const { service, registry, supplierOrderRepo } = makePollDeps(subs, {
      mock: new MockConnector('mock').setStatus('SHIPPED'),
    });
    const res = await service.pollActiveSupplierStatuses();
    expect(res).toEqual({ checked: 1, updated: 0, failed: 0 });
    expect(registry.getByCode).not.toHaveBeenCalled();
    expect(supplierOrderRepo.save).not.toHaveBeenCalled();
  });

  it('one failing supplier does not abort the batch', async () => {
    const failing = new MockConnector('rossko');
    jest
      .spyOn(failing, 'getOrderStatus')
      .mockRejectedValue(new Error('supplier down'));
    const subs = [
      {
        id: 'sub-1',
        orderId: 'order-1',
        supplierCode: 'rossko',
        externalOrderId: 'EXT-1',
        status: 'PLACED',
      },
      {
        id: 'sub-2',
        orderId: 'order-2',
        supplierCode: 'mock',
        externalOrderId: 'EXT-2',
        status: 'PLACED',
      },
    ];
    const { service } = makePollDeps(subs, {
      rossko: failing,
      mock: new MockConnector('mock').setStatus('DELIVERED'),
    });
    const res = await service.pollActiveSupplierStatuses();
    expect(res).toEqual({ checked: 2, updated: 1, failed: 1 });
    expect(subs[1].status).toBe('DELIVERED');
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
