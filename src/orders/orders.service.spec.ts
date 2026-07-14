import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrdersService, aggregateOrderStatus } from './orders.service';
import { DeliveryType, OrderStatus } from './entities/order.entity';
import { SupplierOrder } from './entities/supplier-order.entity';
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
    // Honest compare-and-set, like SQL `UPDATE ... WHERE id = ? AND status = ?`:
    // the row is matched and mutated in one indivisible step, so only the FIRST caller
    // whose `where` status still matches gets affected: 1. Everyone after it gets 0.
    // A mock that always returned affected: 1 would make the concurrency test vacuous.
    update: jest.fn(async (where: any, patch: any) => {
      const row = saved.find((o: any) => o.id === where.id);
      if (!row) return { affected: 0 };
      if (where.status !== undefined && row.status !== where.status) {
        return { affected: 0 };
      }
      Object.assign(row, patch);
      return { affected: 1 };
    }),
  };
  let subSeq = 0;
  // Rows actually committed to supplier_orders, so a test can assert what survives a
  // rolled-back transaction.
  const persistedSubs: any[] = [];
  const supplierOrderRepo = {
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (s: any) => {
      s.id = s.id ?? `sub-${++subSeq}`;
      if (!persistedSubs.includes(s)) persistedSubs.push(s);
      return s;
    }),
    findOne: jest.fn(),
  };
  // A transaction fake with real rollback semantics: on throw, the order rows' fields and
  // the supplier_orders table are restored to their pre-transaction state. Without that,
  // the "rollback un-claims the order" test would be vacuous.
  const txManager = {
    getRepository: jest.fn((entity: any) =>
      entity === SupplierOrder ? supplierOrderRepo : orderRepo,
    ),
  };
  (orderRepo as any).manager = {
    transaction: jest.fn(async (cb: (m: any) => Promise<any>) => {
      const orderSnapshot = saved.map((o: any) => ({ row: o, ...o }));
      const subsSnapshot = [...persistedSubs];
      try {
        return await cb(txManager);
      } catch (err) {
        for (const snap of orderSnapshot) {
          const { row, ...fields } = snap;
          Object.assign(row, fields);
        }
        persistedSubs.length = 0;
        persistedSubs.push(...subsSnapshot);
        throw err;
      }
    }),
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
    persistedSubs,
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
    const { service, cart, partnerProducts } = makeDeps(
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
    // Test mode still books the analytics and empties the paid-out cart.
    expect(partnerProducts.recordOrder).toHaveBeenCalledTimes(1);
    expect(cart.clearCart).toHaveBeenCalledWith('user-1');
  });

  // Two `Pay` deliveries can land at the same instant. The order must be CLAIMED before
  // any supplier is contacted, so exactly one of them does the placing.
  it('places exactly once when two Pay webhooks arrive concurrently', async () => {
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

    await Promise.all([
      service.placeWithSuppliers(created.id),
      service.placeWithSuppliers(created.id),
    ]);

    expect(placeSpy).toHaveBeenCalledTimes(1);
    expect(cart.clearCart).toHaveBeenCalledTimes(1);
  });

  // A crash (or a failing save) mid-loop must not leave the order re-placeable: the
  // supplier has already been contacted, and the webhook WILL be retried.
  it('does not contact a supplier again after a crash mid-placement', async () => {
    const connector = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const placeSpy = jest.spyOn(connector, 'placeOrder');
    const { service, supplierOrderRepo } = makeDeps([makeCheckoutItem()], {
      mock: connector,
    });

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);

    // The supplier is contacted, then persisting the placement outcome blows up. (The
    // NEW row pre-created before any contact still persists fine — the crash is on the
    // save that carries the result back.)
    supplierOrderRepo.save.mockImplementation(async (s: any) => {
      if (s.status !== 'NEW') throw new Error('db died');
      s.id = s.id ?? 'sub-1';
      return s;
    });
    await expect(service.placeWithSuppliers(created.id)).rejects.toThrow(
      'db died',
    );
    expect(placeSpy).toHaveBeenCalledTimes(1);

    // TipTopPay retries the webhook. The supplier must NOT hear from us twice.
    await service.placeWithSuppliers(created.id);
    expect(placeSpy).toHaveBeenCalledTimes(1);
  });

  // Analytics / cart are not the money path: they must never fail the webhook, because a
  // retry would (correctly) no-op on the idempotency claim and never clear the cart.
  it('still resolves when the post-placement side effects throw', async () => {
    const connector = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const { service, partnerProducts, cart } = makeDeps([makeCheckoutItem()], {
      mock: connector,
    });
    partnerProducts.recordOrder.mockRejectedValue(new Error('analytics down'));

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);
    const placed = await service.placeWithSuppliers(created.id);

    expect(placed.status).toBe(OrderStatus.PLACED);
    expect(placed.supplierOrders[0].externalOrderId).toBe('EXT-1');
    // The whole point: a failing analytics write must not swallow the cart clear. The
    // customer has paid; a webhook retry no-ops on the claim, so this is the only chance
    // to empty their cart — otherwise they keep the paid-for items and re-buy them.
    expect(cart.clearCart).toHaveBeenCalledWith('user-1');
  });

  // A cart failure is equally non-fatal, and must not hide the analytics write either.
  it('still resolves when clearCart throws', async () => {
    const connector = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const { service, cart, partnerProducts } = makeDeps([makeCheckoutItem()], {
      mock: connector,
    });
    cart.clearCart.mockRejectedValue(new Error('redis down'));

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);
    const placed = await service.placeWithSuppliers(created.id);

    expect(placed.status).toBe(OrderStatus.PLACED);
    expect(partnerProducts.recordOrder).toHaveBeenCalledTimes(1);
  });

  // Every supplier group must have a persisted, visible row BEFORE anyone is contacted —
  // otherwise a crash mid-loop leaves the un-reached groups with no row at all, and the
  // manager has nothing to retry on an order the customer has already paid for.
  it('persists a NEW sub-order row for every supplier group before contacting any supplier', async () => {
    let codesPersistedAtFirstContact: string[] = [];
    const ok = new MockConnector('mock', 'Mock').setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const other = new MockConnector('rossko', 'Rossko').setOrderResult({
      externalOrderId: 'EXT-2',
      status: 'PLACED',
    });
    const { service, supplierOrderRepo } = makeDeps(
      [
        makeCheckoutItem({ supplierCode: 'mock' }),
        makeCheckoutItem({ supplierCode: 'rossko', warehouseId: 'w2' }),
      ],
      { mock: ok, rossko: other },
    );
    jest.spyOn(ok, 'placeOrder').mockImplementation(async () => {
      codesPersistedAtFirstContact = supplierOrderRepo.save.mock.calls.map(
        (c: any[]) => c[0].supplierCode,
      );
      return { externalOrderId: 'EXT-1', status: 'PLACED' as const };
    });

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);
    await service.placeWithSuppliers(created.id);

    expect(codesPersistedAtFirstContact).toContain('mock');
    expect(codesPersistedAtFirstContact).toContain('rossko');
  });

  // The crash the pre-created rows exist for: the DB blows up while persisting the first
  // group's placement result. The second group was never contacted — but its row must
  // already be there, in NEW, for the manager to retry.
  it('leaves a retryable row for a supplier group never reached because of a crash', async () => {
    const failing = new MockConnector('mock', 'Mock').failWith(
      new Error('supplier down'),
    );
    const other = new MockConnector('rossko', 'Rossko').setOrderResult({
      externalOrderId: 'EXT-2',
      status: 'PLACED',
    });
    const { service, supplierOrderRepo } = makeDeps(
      [
        makeCheckoutItem({ supplierCode: 'mock' }),
        makeCheckoutItem({ supplierCode: 'rossko', warehouseId: 'w2' }),
      ],
      { mock: failing, rossko: other },
    );

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);

    // Persisting the *outcome* of the first group (status FAILED, already contacted)
    // dies. Pre-created NEW rows still save fine.
    supplierOrderRepo.save.mockImplementation(async (s: any) => {
      if (s.supplierCode === 'mock' && s.status !== 'NEW') {
        throw new Error('db died');
      }
      s.id = s.id ?? `sub-${s.supplierCode}`;
      return s;
    });

    await expect(service.placeWithSuppliers(created.id)).rejects.toThrow(
      'db died',
    );

    // Both groups have a persisted supplier_orders row; the un-reached one is NEW, so
    // retrySupplierOrder() can pick it up.
    const persisted = supplierOrderRepo.save.mock.calls.map((c: any[]) => c[0]);
    const rossko = persisted.find((s: any) => s.supplierCode === 'rossko');
    expect(rossko).toBeDefined();
    expect(rossko.status).toBe('NEW');
    expect(rossko.externalOrderId).toBeNull();
  });

  // FINDING 1 — the attempt marker must be on disk BEFORE the supplier hears from us.
  // If it were written afterwards, a lost outcome-write would leave a bare NEW row and a
  // manager could re-send an order the supplier already has.
  it('persists attemptedAt on the row BEFORE calling the connector', async () => {
    let rowAtContact: any = null;
    const connector = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const { service, supplierOrderRepo } = makeDeps([makeCheckoutItem()], {
      mock: connector,
    });
    jest.spyOn(connector, 'placeOrder').mockImplementation(async () => {
      // Snapshot what the LAST save() actually committed at the moment of contact.
      const calls = supplierOrderRepo.save.mock.calls;
      const last = calls[calls.length - 1][0];
      rowAtContact = { status: last.status, attemptedAt: last.attemptedAt };
      return { externalOrderId: 'EXT-1', status: 'PLACED' as const };
    });

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);
    await service.placeWithSuppliers(created.id);

    expect(rowAtContact).not.toBeNull();
    expect(rowAtContact.attemptedAt).toBeInstanceOf(Date);
    // Still NEW at that point: only the marker is committed, not an outcome.
    expect(rowAtContact.status).toBe('NEW');
  });

  // FINDING 2 — claim + sub-order inserts are one transaction. A rollback must un-claim
  // the order (back to AWAITING_PAYMENT, zero rows) so the redelivered webhook can place
  // it for the first time. Safe precisely because no supplier is contacted inside the tx.
  it('rolls the claim back when the sub-order insert fails, and a later webhook places normally', async () => {
    const connector = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const placeSpy = jest.spyOn(connector, 'placeOrder');
    const { service, supplierOrderRepo, persistedSubs, orderRepo } = makeDeps(
      [makeCheckoutItem()],
      { mock: connector },
    );

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);

    // The pre-create insert (the only save with a null attemptedAt) blows up.
    const realSave = supplierOrderRepo.save.getMockImplementation()!;
    supplierOrderRepo.save.mockImplementation(async (s: any) => {
      if (s.attemptedAt == null) throw new Error('db died');
      return realSave(s);
    });

    await expect(service.placeWithSuppliers(created.id)).rejects.toThrow(
      'db died',
    );

    // No supplier was contacted inside the transaction, so un-claiming is safe.
    expect(placeSpy).not.toHaveBeenCalled();
    const row = await orderRepo.findOne();
    expect(row.status).toBe(OrderStatus.AWAITING_PAYMENT);
    expect(persistedSubs).toHaveLength(0);

    // TipTopPay redelivers the webhook. The order is still claimable — place normally.
    supplierOrderRepo.save.mockImplementation(realSave);
    const placed = await service.placeWithSuppliers(created.id);

    expect(placed.status).toBe(OrderStatus.PLACED);
    expect(placeSpy).toHaveBeenCalledTimes(1);
    expect(placed.supplierOrders).toHaveLength(1);
    expect(placed.supplierOrders[0].externalOrderId).toBe('EXT-1');
  });

  // Sanity: a connector that throws is caught per-group and never costs the other group
  // its row.
  it('persists a row for both groups when the first connector throws', async () => {
    const failing = new MockConnector('mock', 'Mock').failWith(
      new Error('supplier down'),
    );
    const other = new MockConnector('rossko', 'Rossko').setOrderResult({
      externalOrderId: 'EXT-2',
      status: 'PLACED',
    });
    const { service } = makeDeps(
      [
        makeCheckoutItem({ supplierCode: 'mock' }),
        makeCheckoutItem({ supplierCode: 'rossko', warehouseId: 'w2' }),
      ],
      { mock: failing, rossko: other },
    );

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);
    const placed = await service.placeWithSuppliers(created.id);

    expect(placed.supplierOrders).toHaveLength(2);
    expect(placed.status).toBe(OrderStatus.PARTIALLY_PLACED);
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

  // A NEW row is a group that was pre-created but never reached (crash mid-placement).
  // The customer has paid for it, so the manager must be able to send it to the supplier.
  it('retry places a NEW sub-order that was never reached', async () => {
    const sub = {
      id: 'sub-1',
      orderId: 'order-1',
      supplierCode: 'mock',
      externalOrderId: null,
      status: 'NEW',
      errorMessage: null,
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
      externalOrderId: 'EXT-4',
      status: 'PLACED',
    });
    const { service } = makeServiceWithSub(sub, connector, items);
    await service.retrySupplierOrder('order-1', 'sub-1');
    expect(sub.status).toBe('PLACED');
    expect(sub.externalOrderId).toBe('EXT-4');
  });

  // FINDING 1 — a NEW row that carries attemptedAt means "we started talking to this
  // supplier and never saved the outcome". They may already have the order. The retry
  // button must refuse it: a human has to phone the supplier first.
  it('retry refuses a NEW sub-order that was already attempted (ambiguous)', async () => {
    const sub = {
      id: 'sub-1',
      orderId: 'order-1',
      supplierCode: 'mock',
      externalOrderId: null,
      status: 'NEW',
      attemptedAt: new Date('2026-07-14T10:00:00Z'),
      errorMessage: null,
    };
    const connector = new MockConnector();
    const placeSpy = jest.spyOn(connector, 'placeOrder');
    const { service } = makeServiceWithSub(sub, connector, [
      {
        supplierCode: 'mock',
        article: 'A1',
        brand: 'BOSCH',
        warehouseId: 'w1',
        quantity: 1,
        raw: {},
      },
    ]);
    await expect(
      service.retrySupplierOrder('order-1', 'sub-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.retrySupplierOrder('order-1', 'sub-1'),
    ).rejects.toThrow(/supplier/i);
    expect(placeSpy).not.toHaveBeenCalled();
    expect(sub.status).toBe('NEW');
  });

  // ...while a NEW row with no attemptedAt was demonstrably never sent, and stays retryable.
  it('retry still places a NEW sub-order with no attemptedAt', async () => {
    const sub = {
      id: 'sub-1',
      orderId: 'order-1',
      supplierCode: 'mock',
      externalOrderId: null,
      status: 'NEW',
      attemptedAt: null,
      errorMessage: null,
    };
    const connector = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-5',
      status: 'PLACED',
    });
    const { service } = makeServiceWithSub(sub, connector, [
      {
        supplierCode: 'mock',
        article: 'A1',
        brand: 'BOSCH',
        warehouseId: 'w1',
        quantity: 1,
        raw: {},
      },
    ]);
    await service.retrySupplierOrder('order-1', 'sub-1');
    expect(sub.status).toBe('PLACED');
    expect(sub.externalOrderId).toBe('EXT-5');
    // The retry itself stamps the attempt before contacting the supplier.
    expect(sub.attemptedAt).toBeInstanceOf(Date);
  });

  // FINDING 3 — awaiting_payment / paid are the payment flow's idempotency token. A
  // manager who could set awaiting_payment back would re-arm placeWithSuppliers() for any
  // later webhook delivery and double-order from every supplier.
  it('updateStatus rejects payment-owned statuses and still accepts the rest', async () => {
    const sub = { id: 'sub-1', orderId: 'order-1', supplierCode: 'mock', status: 'PLACED' };
    const { service, orderRepo } = makeServiceWithSub(sub, new MockConnector());

    await expect(
      service.updateStatus('order-1', OrderStatus.AWAITING_PAYMENT),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateStatus('order-1', OrderStatus.PAID),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(orderRepo.save).not.toHaveBeenCalled();

    const updated = await service.updateStatus('order-1', OrderStatus.DELIVERED);
    expect(updated.status).toBe(OrderStatus.DELIVERED);
    expect(orderRepo.save).toHaveBeenCalled();
  });

  // Still no re-placing of a sub-order that is already at the supplier.
  it('retry refuses a sub-order that is already PLACED', async () => {
    const sub = {
      id: 'sub-1',
      orderId: 'order-1',
      supplierCode: 'mock',
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    };
    const connector = new MockConnector();
    const placeSpy = jest.spyOn(connector, 'placeOrder');
    const { service } = makeServiceWithSub(sub, connector);
    await expect(
      service.retrySupplierOrder('order-1', 'sub-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(placeSpy).not.toHaveBeenCalled();
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

  // aggregateOrderStatus([]) is CANCELLED; re-aggregation must never apply that to a
  // live order whose sub-orders simply are not in the loaded relation.
  it('re-aggregation never cancels an order with no sub-orders loaded', async () => {
    const subs = [
      {
        id: 'sub-1',
        orderId: 'order-1',
        supplierCode: 'mock',
        externalOrderId: 'EXT-1',
        status: 'PLACED',
      },
    ];
    const { service, orderRepo } = makePollDeps(subs, {
      mock: new MockConnector('mock').setStatus('SHIPPED'),
    });
    await service.pollActiveSupplierStatuses();
    // makePollDeps loads orders with supplierOrders: [] — the status must be left alone.
    expect(orderRepo.save).not.toHaveBeenCalled();
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
