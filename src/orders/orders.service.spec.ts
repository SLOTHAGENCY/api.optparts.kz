import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrdersService, aggregateOrderStatus } from './orders.service';
import { DeliveryType, OrderStatus } from './entities/order.entity';
import { SupplierOrder } from './entities/supplier-order.entity';
import { MockConnector } from '../suppliers/connectors/mock/mock.connector';

/**
 * Deep clone that keeps Dates as Dates (structuredClone builds them in another realm, so
 * `instanceof Date` fails under Jest). The repo mocks below store clones, never the
 * caller's object: that is what lets a test assert what was actually WRITTEN at a given
 * moment, instead of reading live in-memory state the service is still mutating.
 */
function cloneRow<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as any;
  if (Array.isArray(value)) return value.map(cloneRow) as any;
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) out[k] = cloneRow(v);
    return out;
  }
  return value;
}

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
  // The supplier_orders "table": rows actually committed, so a test can assert what
  // survives a rolled-back transaction. Rows are COPIES, never the caller's entity — see
  // save()/findOne() below.
  const persistedSubs: any[] = [];
  // Ordered log of everything ever WRITTEN to the table, as deep clones. Reading the last
  // entry tells you what was on disk at that moment — unlike save.mock.calls, which hands
  // back the live object the service keeps mutating and would happily "prove" a write that
  // never happened.
  const subWrites: any[] = [];
  const supplierOrderRepo = {
    create: jest.fn((data: any) => ({ ...data })),
    // save() is an UNCONDITIONAL write-through (SQL: UPDATE ... WHERE id), like TypeORM's.
    // It stores a COPY and returns the caller's own object: a caller therefore never
    // magically observes a write made by somebody else, so an in-memory row it is holding
    // goes stale exactly as it does in production. That staleness is what gives the
    // compare-and-set in sendSupplierOrder() something real to catch.
    save: jest.fn(async (s: any) => {
      s.id = s.id ?? `sub-${++subSeq}`;
      const row = persistedSubs.find((r: any) => r.id === s.id);
      if (row) Object.assign(row, cloneRow(s));
      else persistedSubs.push(cloneRow(s));
      subWrites.push(cloneRow(s));
      return s;
    }),
    // Honest compare-and-set, like SQL `UPDATE ... WHERE id = ? AND status = ?`: only the
    // caller whose `where` status still matches the row gets affected: 1; everyone after
    // it gets 0. A mock that always returned affected: 1 would make every concurrency test
    // below vacuous.
    update: jest.fn(async (where: any, patch: any) => {
      const row = persistedSubs.find((r: any) => r.id === where.id);
      if (!row) return { affected: 0 };
      if (where.status !== undefined && row.status !== where.status) {
        return { affected: 0 };
      }
      Object.assign(row, patch);
      subWrites.push(cloneRow(row));
      return { affected: 1 };
    }),
    // A SELECT hands out a fresh object, never the table's row.
    findOne: jest.fn(async (opts: any = {}) => {
      const where = opts.where ?? {};
      const row = persistedSubs.find(
        (r: any) =>
          (where.id === undefined || r.id === where.id) &&
          (where.orderId === undefined || r.orderId === where.orderId),
      );
      return row ? cloneRow(row) : null;
    }),
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
      const subsSnapshot = persistedSubs.map((r: any) => ({ ...r }));
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
    subWrites,
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

  // A SENDING group is ambiguous — it is NOT at the supplier as far as we know. Letting it
  // read as PLACED would bury an order the customer has paid for.
  it('never returns PLACED while a sub-order is still SENDING', () => {
    expect(aggregateOrderStatus(['PLACED', 'SENDING'])).toBe(
      OrderStatus.PARTIALLY_PLACED,
    );
    expect(aggregateOrderStatus(['SENDING'])).toBe(
      OrderStatus.PARTIALLY_PLACED,
    );
    expect(aggregateOrderStatus(['SENDING', 'FAILED'])).toBe(
      OrderStatus.PARTIALLY_PLACED,
    );
  });

  // Same for an un-sent NEW group: paid for, never ordered, must stay visible.
  it('never returns PLACED while a sub-order is still NEW', () => {
    expect(aggregateOrderStatus(['PLACED', 'NEW'])).toBe(
      OrderStatus.PARTIALLY_PLACED,
    );
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
    const realSave = supplierOrderRepo.save.getMockImplementation()!;
    supplierOrderRepo.save.mockImplementation(async (s: any) => {
      if (s.status !== 'NEW') throw new Error('db died');
      return realSave(s);
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
    const realSave = supplierOrderRepo.save.getMockImplementation()!;
    supplierOrderRepo.save.mockImplementation(async (s: any) => {
      if (s.supplierCode === 'mock' && s.status !== 'NEW') {
        throw new Error('db died');
      }
      return realSave(s);
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

  // FINDING 1 — the SENDING claim + attempt marker must be ON DISK before the supplier
  // hears from us. If they were written afterwards, a lost outcome-write would leave a
  // bare NEW row and a manager could re-send an order the supplier already has.
  //
  // This asserts PERSISTENCE, not memory: subWrites holds deep CLONES taken at write time,
  // so a source that stamps `sub.status = 'SENDING'` in memory and only persists after the
  // connector returns fails here. (Reading save.mock.calls instead would hand back the
  // live object the service keeps mutating, and would pass either way — which is exactly
  // how the previous version of this test was hollow.)
  it('persists the SENDING claim + attemptedAt on the row BEFORE calling the connector', async () => {
    let rowAtContact: any = null;
    let writesAtContact = 0;
    const connector = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const { service, subWrites } = makeDeps([makeCheckoutItem()], {
      mock: connector,
    });
    jest.spyOn(connector, 'placeOrder').mockImplementation(async () => {
      // Snapshot what the table actually held at the moment of contact.
      rowAtContact = subWrites[subWrites.length - 1] ?? null;
      writesAtContact = subWrites.length;
      return { externalOrderId: 'EXT-1', status: 'PLACED' as const };
    });

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);
    await service.placeWithSuppliers(created.id);

    expect(rowAtContact).not.toBeNull();
    // The last thing written before the wire is the claim: SENDING + a real attemptedAt.
    expect(rowAtContact.status).toBe('SENDING');
    expect(rowAtContact.attemptedAt).toBeInstanceOf(Date);
    // Pre-create (NEW) + claim (SENDING) — and nothing else yet: no outcome is on disk.
    expect(writesAtContact).toBe(2);
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

  // D1, second half — a manager clicks "retry" on a NEW row while the placement loop is
  // still grinding through a slow EARLIER supplier. The loop sends from its in-memory
  // array and never re-reads the row; only the DB claim can stop it re-sending what the
  // manager just sent. The second supplier must hear from us exactly once.
  it('a manager retry racing the in-flight placement loop does not double-send', async () => {
    const slow = new MockConnector('mock', 'Mock');
    const second = new MockConnector('rossko', 'Rossko').setOrderResult({
      externalOrderId: 'EXT-2',
      status: 'PLACED',
    });
    const secondSpy = jest.spyOn(second, 'placeOrder');
    const { service, persistedSubs } = makeDeps(
      [
        makeCheckoutItem({ supplierCode: 'mock' }),
        makeCheckoutItem({ supplierCode: 'rossko', warehouseId: 'w2' }),
      ],
      { mock: slow, rossko: second },
    );

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);

    // While the loop is blocked on the slow first supplier, the manager retries the second
    // group's (still NEW) row through the normal endpoint.
    jest.spyOn(slow, 'placeOrder').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      const rossko = persistedSubs.find(
        (s: any) => s.supplierCode === 'rossko',
      );
      await service.retrySupplierOrder(created.id, rossko.id);
      return { externalOrderId: 'EXT-1', status: 'PLACED' as const };
    });

    const placed = await service.placeWithSuppliers(created.id);

    // The manager's retry placed it; the loop, holding a stale NEW row, lost the claim.
    expect(secondSpy).toHaveBeenCalledTimes(1);
    const rosskoRow = persistedSubs.find((s: any) => s.supplierCode === 'rossko');
    expect(rosskoRow.status).toBe('PLACED');
    expect(rosskoRow.externalOrderId).toBe('EXT-2');
    // The loop refreshed its stale copy from the DB, so the order still aggregates right.
    expect(placed.status).toBe(OrderStatus.PLACED);
  });

  // A row stuck in SENDING is NOT placed. If it let the order read as fully PLACED, nobody
  // would ever look at it again — and the customer paid for those goods.
  it('an order with a stuck SENDING sub-order does not aggregate to PLACED', async () => {
    const ok = new MockConnector('mock', 'Mock').setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const other = new MockConnector('rossko', 'Rossko').setOrderResult({
      externalOrderId: 'EXT-2',
      status: 'PLACED',
    });
    const otherSpy = jest.spyOn(other, 'placeOrder');
    const { service, supplierOrderRepo, persistedSubs } = makeDeps(
      [
        makeCheckoutItem({ supplierCode: 'mock' }),
        makeCheckoutItem({ supplierCode: 'rossko', warehouseId: 'w2' }),
      ],
      { mock: ok, rossko: other },
    );

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);

    // Somebody else claimed the rossko row first and then died mid-send: it is already
    // SENDING on disk, and our loop loses the compare-and-set on it.
    const realUpdate = supplierOrderRepo.update.getMockImplementation()!;
    supplierOrderRepo.update.mockImplementation(async (where: any, patch: any) => {
      const row = persistedSubs.find((r: any) => r.id === where.id);
      if (row?.supplierCode === 'rossko' && row.status === 'NEW') {
        row.status = 'SENDING';
        row.attemptedAt = new Date();
        return { affected: 0 };
      }
      return realUpdate(where, patch);
    });

    const placed = await service.placeWithSuppliers(created.id);

    expect(otherSpy).not.toHaveBeenCalled();
    const rossko = (placed.supplierOrders ?? []).find(
      (s: any) => s.supplierCode === 'rossko',
    );
    expect(rossko!.status).toBe('SENDING');
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
    // `sub` IS the row in the supplier_orders table. Every SELECT hands out a fresh copy
    // of it (as a real DB does), so two concurrent requests hold two independent objects
    // and neither can see the other's uncommitted intent; only writes go back to the row.
    // Without that, a shared object reference would smuggle information between the two
    // "requests" and hide the very double-send this suite exists to catch.
    const subWrites: any[] = [];
    const rows: any[] = [sub];
    const supplierOrderRepo = {
      findOne: jest.fn(async (opts: any = {}) => {
        const where = opts.where ?? {};
        const row = rows.find(
          (r: any) =>
            (where.id === undefined || r.id === where.id) &&
            (where.orderId === undefined || r.orderId === where.orderId),
        );
        return row ? cloneRow(row) : null;
      }),
      // Unconditional write-through (UPDATE ... WHERE id).
      save: jest.fn(async (s: any) => {
        const row = rows.find((r: any) => r.id === s.id);
        if (row) Object.assign(row, cloneRow(s));
        else rows.push(cloneRow(s));
        subWrites.push(cloneRow(s));
        return s;
      }),
      // Honest compare-and-set: the loser of a race gets affected: 0, never a free pass.
      update: jest.fn(async (where: any, patch: any) => {
        const row = rows.find((r: any) => r.id === where.id);
        if (!row) return { affected: 0 };
        if (where.status !== undefined && row.status !== where.status) {
          return { affected: 0 };
        }
        Object.assign(row, patch);
        subWrites.push(cloneRow(row));
        return { affected: 1 };
      }),
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
    return { service, order, orderRepo, supplierOrderRepo, rateLimiter, subWrites };
  }

  const ITEM = {
    supplierCode: 'mock',
    article: 'A1',
    brand: 'BOSCH',
    warehouseId: 'w1',
    quantity: 1,
    raw: {},
  };

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

  // D1 — THE reproduction. A double-clicked retry button (or two managers) fires two
  // retries at once against a supplier that takes real time to answer. The supplier must
  // hear from us EXACTLY ONCE: the DB-arbitrated claim in sendSupplierOrder() lets only one
  // of them through, and the loser either sees affected: 0 or is refused as SENDING.
  it('two CONCURRENT retries call placeOrder exactly once', async () => {
    const sub = {
      id: 'sub-1',
      orderId: 'order-1',
      supplierCode: 'mock',
      externalOrderId: null,
      status: 'FAILED',
      attemptedAt: null,
      errorMessage: 'previous error',
      isTest: false,
    };
    const connector = new MockConnector();
    const placeSpy = jest
      .spyOn(connector, 'placeOrder')
      .mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 20));
        return { externalOrderId: 'EXT-1', status: 'PLACED' as const };
      });
    const { service } = makeServiceWithSub(sub, connector, [ITEM]);

    const results = await Promise.allSettled([
      service.retrySupplierOrder('order-1', 'sub-1'),
      service.retrySupplierOrder('order-1', 'sub-1'),
    ]);

    expect(placeSpy).toHaveBeenCalledTimes(1);
    expect(sub.status).toBe('PLACED');
    expect(sub.externalOrderId).toBe('EXT-1');
    // At least one call did the work; the other is allowed to succeed as a no-op or to be
    // refused (409) — but it must not have touched the supplier, which is asserted above.
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
  });

  // D2 — the lost outcome write. The connector was called, the result never reached the
  // DB. The row must be left in SENDING (ambiguous), NOT in a retryable status: a second
  // retry must be refused, or we would order the same goods twice.
  it('a row whose outcome write is lost stays SENDING and is no longer retryable', async () => {
    const sub = {
      id: 'sub-1',
      orderId: 'order-1',
      supplierCode: 'mock',
      externalOrderId: null,
      status: 'FAILED',
      attemptedAt: null,
      errorMessage: 'previous error',
      isTest: false,
    };
    const connector = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-1',
      status: 'PLACED',
    });
    const placeSpy = jest.spyOn(connector, 'placeOrder');
    const { service, supplierOrderRepo } = makeServiceWithSub(sub, connector, [
      ITEM,
    ]);

    // The outcome write (the only save() in the send path) never lands.
    const realSave = supplierOrderRepo.save.getMockImplementation()!;
    supplierOrderRepo.save.mockImplementation(async () => {
      throw new Error('db died');
    });
    await expect(
      service.retrySupplierOrder('order-1', 'sub-1'),
    ).rejects.toThrow('db died');

    expect(placeSpy).toHaveBeenCalledTimes(1);
    // The claim IS on disk — the row is ambiguous, not FAILED and not NEW.
    expect(sub.status).toBe('SENDING');
    expect(sub.attemptedAt).toBeInstanceOf(Date);

    // The DB is back. The manager clicks retry again: refused, supplier untouched.
    supplierOrderRepo.save.mockImplementation(realSave);
    await expect(
      service.retrySupplierOrder('order-1', 'sub-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(placeSpy).toHaveBeenCalledTimes(1);
  });

  // A SENDING row is ambiguous by definition — the retry button must never touch it.
  it('retry refuses a SENDING sub-order and points at resolve-attempt', async () => {
    const sub = {
      id: 'sub-1',
      orderId: 'order-1',
      supplierCode: 'mock',
      externalOrderId: null,
      status: 'SENDING',
      attemptedAt: new Date('2026-07-14T10:00:00Z'),
      errorMessage: null,
      isTest: false,
    };
    const connector = new MockConnector();
    const placeSpy = jest.spyOn(connector, 'placeOrder');
    const { service } = makeServiceWithSub(sub, connector, [ITEM]);

    await expect(
      service.retrySupplierOrder('order-1', 'sub-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    // The refusal must name a capability that actually exists, not a dead end.
    await expect(
      service.retrySupplierOrder('order-1', 'sub-1'),
    ).rejects.toThrow(/resolve-attempt/);
    expect(placeSpy).not.toHaveBeenCalled();
    expect(sub.status).toBe('SENDING');
  });

  // D3 — a test-mode sub-order is created NEW and deliberately never sent. Retrying it
  // would place a REAL order with a REAL partner off the back of a test run.
  it('retry refuses a test-mode sub-order', async () => {
    const sub = {
      id: 'sub-1',
      orderId: 'order-1',
      supplierCode: 'mock',
      externalOrderId: null,
      status: 'NEW',
      attemptedAt: null,
      errorMessage: null,
      isTest: true,
    };
    const connector = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-9',
      status: 'PLACED',
    });
    const placeSpy = jest.spyOn(connector, 'placeOrder');
    const { service } = makeServiceWithSub(sub, connector, [ITEM]);

    await expect(
      service.retrySupplierOrder('order-1', 'sub-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.retrySupplierOrder('order-1', 'sub-1'),
    ).rejects.toThrow(/test/i);
    expect(placeSpy).not.toHaveBeenCalled();
    expect(sub.status).toBe('NEW');
  });

  // D4 — the way OUT of the ambiguous state: the admin phoned the supplier.
  it('resolve-attempt marks a SENDING row PLACED when the supplier does have the order', async () => {
    const sub = {
      id: 'sub-1',
      orderId: 'order-1',
      supplierCode: 'mock',
      externalOrderId: null,
      status: 'SENDING',
      attemptedAt: new Date('2026-07-14T10:00:00Z'),
      errorMessage: 'x',
      isTest: false,
    };
    const connector = new MockConnector();
    const placeSpy = jest.spyOn(connector, 'placeOrder');
    const { service } = makeServiceWithSub(sub, connector, [ITEM]);

    await service.resolveSupplierAttempt(
      'order-1',
      'sub-1',
      { delivered: true, externalOrderId: 'EXT-77' },
      'admin-1',
    );

    expect(sub.status).toBe('PLACED');
    expect(sub.externalOrderId).toBe('EXT-77');
    expect(sub.errorMessage).toBeNull();
    // Resolving is bookkeeping about a call that already happened — never a new send.
    expect(placeSpy).not.toHaveBeenCalled();
  });

  it('resolve-attempt marks a SENDING row FAILED and re-opens the retry', async () => {
    const sub = {
      id: 'sub-1',
      orderId: 'order-1',
      supplierCode: 'mock',
      externalOrderId: null,
      status: 'SENDING',
      attemptedAt: new Date('2026-07-14T10:00:00Z'),
      errorMessage: null,
      isTest: false,
    };
    const connector = new MockConnector().setOrderResult({
      externalOrderId: 'EXT-8',
      status: 'PLACED',
    });
    const placeSpy = jest.spyOn(connector, 'placeOrder');
    const { service } = makeServiceWithSub(sub, connector, [ITEM]);

    await service.resolveSupplierAttempt(
      'order-1',
      'sub-1',
      { delivered: false, comment: 'Supplier has no such order.' },
      'admin-1',
    );
    expect(sub.status).toBe('FAILED');
    expect(placeSpy).not.toHaveBeenCalled();

    // FAILED is retryable again — the customer's goods finally get ordered.
    await service.retrySupplierOrder('order-1', 'sub-1');
    expect(placeSpy).toHaveBeenCalledTimes(1);
    expect(sub.status).toBe('PLACED');
    expect(sub.externalOrderId).toBe('EXT-8');
  });

  it('resolve-attempt refuses a row that is not ambiguous', async () => {
    const sub = {
      id: 'sub-1',
      orderId: 'order-1',
      supplierCode: 'mock',
      externalOrderId: 'EXT-1',
      status: 'PLACED',
      attemptedAt: new Date('2026-07-14T10:00:00Z'),
      isTest: false,
    };
    const { service } = makeServiceWithSub(sub, new MockConnector());
    await expect(
      service.resolveSupplierAttempt(
        'order-1',
        'sub-1',
        { delivered: false },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(sub.status).toBe('PLACED');
  });

  // A legacy row from before SENDING existed (NEW + attemptedAt) is ambiguous too, and
  // must be resolvable the same way — otherwise it is stuck forever.
  it('resolve-attempt also settles a legacy NEW + attemptedAt row', async () => {
    const sub = {
      id: 'sub-1',
      orderId: 'order-1',
      supplierCode: 'mock',
      externalOrderId: null,
      status: 'NEW',
      attemptedAt: new Date('2026-07-14T10:00:00Z'),
      errorMessage: null,
      isTest: false,
    };
    const { service } = makeServiceWithSub(sub, new MockConnector());
    await service.resolveSupplierAttempt(
      'order-1',
      'sub-1',
      { delivered: false },
      'admin-1',
    );
    expect(sub.status).toBe('FAILED');
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
