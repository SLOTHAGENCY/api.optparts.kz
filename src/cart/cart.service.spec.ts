import { CartService } from './cart.service';
import { MockConnector } from '../suppliers/connectors/mock/mock.connector';
import { SupplierOffer } from '../suppliers/types';

function makeOffer(partial: Partial<SupplierOffer> = {}): SupplierOffer {
  return {
    supplierCode: 'mock',
    article: 'A1',
    brand: 'BR',
    name: 'Part',
    costPrice: 100,
    currency: 'KZT',
    count: 10,
    deliveryDays: 3,
    multiplicity: 1,
    warehouseId: 'W1',
    isAnalog: false,
    raw: { offerId: 'raw-1' },
    ...partial,
  };
}

function makeItem(partial: Record<string, any> = {}) {
  return {
    id: 'i1',
    supplierCode: 'mock',
    article: 'A1',
    brand: 'BR',
    productName: 'Part',
    warehouseId: 'W1',
    quantity: 2,
    priceAtAdd: '120',
    costPrice: '100',
    raw: { offerId: 'snap' },
    ...partial,
  };
}

function makeService(opts: {
  items?: any[];
  connector?: MockConnector;
  applyMarkup?: (cost: number, code: string) => Promise<number>;
} = {}) {
  const cart = { id: 'cart-1', userId: 'u1', items: opts.items ?? [] };
  const cartRepo = {
    findOne: jest.fn(async () => cart),
    create: jest.fn((d: any) => ({ ...d, items: [] })),
    save: jest.fn(async (c: any) => c),
  };
  const itemRepo = {
    create: jest.fn((d: any) => ({ id: 'item-new', ...d })),
    save: jest.fn(async (i: any) => i),
    remove: jest.fn(async () => undefined),
  };
  const connector = opts.connector ?? new MockConnector('mock', 'Mock Supplier');
  const registry = {
    getByCode: jest.fn(async (code: string) => {
      if (code !== connector.code) throw new Error('inactive');
      return connector;
    }),
  };
  const pricing = {
    applyMarkup: jest.fn(
      opts.applyMarkup ?? (async (cost: number) => Math.round(cost * 1.2)),
    ),
  };
  const service = new CartService(
    cartRepo as any,
    itemRepo as any,
    registry as any,
    pricing as any,
  );
  return { service, cart, cartRepo, itemRepo, registry, pricing, connector };
}

describe('CartService', () => {
  it('addItem stores offer snapshot with priceAtAdd and null productId', async () => {
    const { service, itemRepo } = makeService({ items: [] });
    await service.addItem('u1', {
      supplierCode: 'mock',
      article: 'A1',
      brand: 'BR',
      productName: 'Part',
      sellPrice: 120,
      costPrice: 100,
      warehouseId: 'W1',
      raw: { offerId: 'r' },
      quantity: 2,
    });
    expect(itemRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        supplierCode: 'mock',
        article: 'A1',
        brand: 'BR',
        productName: 'Part',
        priceAtAdd: 120,
        costPrice: 100,
        warehouseId: 'W1',
        quantity: 2,
        productId: null,
        raw: { offerId: 'r' },
      }),
    );
    expect(itemRepo.save).toHaveBeenCalled();
  });

  it('addItem merges the same offer at the same price and sums quantity', async () => {
    const existing = makeItem({
      quantity: 1,
      priceAtAdd: '120',
      raw: { offerKey: 'price-A|W1' },
    });
    const { service, itemRepo } = makeService({ items: [existing] });
    await service.addItem('u1', {
      supplierCode: 'mock',
      article: 'A1',
      brand: 'BR',
      productName: 'Part',
      sellPrice: 120,
      costPrice: 100,
      warehouseId: 'W1',
      raw: { offerKey: 'price-A|W1' },
      quantity: 3,
    });
    expect(existing.quantity).toBe(4);
    expect(itemRepo.create).not.toHaveBeenCalled();
    expect(itemRepo.save).toHaveBeenCalledWith(existing);
  });

  it('addItem does NOT merge distinct offers sharing a warehouseId (different offerKey)', async () => {
    // One warehouse can hold several distinct offers (price lines) of the same
    // article — e.g. SHATE-M returns multiple price lines per locationCode.
    // They must stay separate lines, keyed by offerKey, not summed.
    const existing = makeItem({ quantity: 1, raw: { offerKey: 'price-A|W1' } });
    const { service, itemRepo } = makeService({ items: [existing] });
    await service.addItem('u1', {
      supplierCode: 'mock',
      article: 'A1',
      brand: 'BR',
      productName: 'Part',
      sellPrice: 130,
      costPrice: 110,
      warehouseId: 'W1',
      raw: { offerKey: 'price-B|W1' },
      quantity: 3,
    });
    expect(existing.quantity).toBe(1); // untouched
    expect(itemRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ raw: { offerKey: 'price-B|W1' }, quantity: 3 }),
    );
  });

  it('addItem does NOT merge the same offer at a different price (separate line)', async () => {
    // Same offerKey but a different price (delivery tier / price drift) is a
    // distinct cart line, per product rule "разная цена — разные строки".
    const existing = makeItem({
      quantity: 1,
      priceAtAdd: '120',
      raw: { offerKey: 'price-A|W1' },
    });
    const { service, itemRepo } = makeService({ items: [existing] });
    await service.addItem('u1', {
      supplierCode: 'mock',
      article: 'A1',
      brand: 'BR',
      productName: 'Part',
      sellPrice: 140,
      costPrice: 110,
      warehouseId: 'W1',
      raw: { offerKey: 'price-A|W1' },
      quantity: 3,
    });
    expect(existing.quantity).toBe(1); // untouched
    expect(itemRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ priceAtAdd: 140, quantity: 3 }),
    );
  });

  it('getCart marks priceChanged and uses fresh price for subtotal when price rose', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ costPrice: 125, count: 10, warehouseId: 'W1' }),
    ]);
    const { service } = makeService({
      items: [makeItem()],
      connector,
      applyMarkup: async (c) => Math.round(c * 1.2), // 125 -> 150
    });
    const res = await service.getCart('u1');
    expect(res.items[0].currentPrice).toBe(150);
    expect(res.items[0].priceAtAdd).toBe(120);
    expect(res.items[0].priceChanged).toBe(true);
    expect(res.items[0].available).toBe(true);
    expect(res.items[0].subtotal).toBe(300);
    expect(res.items[0].supplierName).toBe('Mock Supplier');
    expect(res.totalAmount).toBe(300);
    expect(res.hasChanges).toBe(true);
    expect(res.items[0]).not.toHaveProperty('costPrice');
  });

  it('re-check matches by offerKey, not warehouseId (Rossko stock id is shared)', async () => {
    // Both offers share warehouseId 'W1' but are different products (offerKey).
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ warehouseId: 'W1', costPrice: 500, raw: { offerKey: 'g2|W1' } }),
      makeOffer({ warehouseId: 'W1', costPrice: 100, raw: { offerKey: 'g1|W1' } }),
    ]);
    const { service } = makeService({
      items: [makeItem({ raw: { offerKey: 'g1|W1' } })],
      connector,
      applyMarkup: async (c) => Math.round(c * 1.2),
    });
    const res = await service.getCart('u1');
    // Must pick the g1 offer (100 -> 120), NOT the g2 offer sharing the warehouse.
    expect(res.items[0].currentPrice).toBe(120);
    expect(res.items[0].available).toBe(true);
  });

  it('getCart treats partner failure as unavailable with currentPrice = priceAtAdd', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').failWith(
      new Error('partner down'),
    );
    const { service } = makeService({ items: [makeItem()], connector });
    const res = await service.getCart('u1');
    expect(res.items[0].available).toBe(false);
    expect(res.items[0].currentPrice).toBe(120);
    expect(res.items[0].priceChanged).toBe(false);
    expect(res.items[0].subtotal).toBe(240);
    expect(res.hasChanges).toBe(true);
  });

  it('getCart treats a disappeared offer as unavailable', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ warehouseId: 'OTHER' }),
    ]);
    const { service } = makeService({ items: [makeItem()], connector });
    const res = await service.getCart('u1');
    expect(res.items[0].available).toBe(false);
    expect(res.items[0].currentPrice).toBe(120);
  });

  it('getCart clamps quantity to stock (still available) when supplier has fewer than requested', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ costPrice: 100, count: 1, warehouseId: 'W1' }),
    ]);
    const { service, itemRepo } = makeService({
      items: [makeItem({ quantity: 5 })],
      connector,
      applyMarkup: async (c) => Math.round(c * 1.2), // 120, equals priceAtAdd
    });
    const res = await service.getCart('u1');
    expect(res.items[0].available).toBe(true);
    expect(res.items[0].quantity).toBe(1);
    expect(res.items[0].quantityAdjusted).toBe(true);
    expect(res.hasChanges).toBe(true);
    expect(res.items[0].priceChanged).toBe(false);
    expect(itemRepo.save).toHaveBeenCalled(); // reduced quantity is persisted
  });

  it('getCart rounds a clamped quantity down to the offer multiplicity', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ count: 3, multiplicity: 2, warehouseId: 'W1' }),
    ]);
    const { service } = makeService({
      items: [makeItem({ quantity: 10, raw: { offerId: 'snap', multiplicity: 2 } })],
      connector,
    });
    const res = await service.getCart('u1');
    expect(res.items[0].available).toBe(true);
    expect(res.items[0].quantity).toBe(2); // floor(3/2)*2
    expect(res.items[0].quantityAdjusted).toBe(true);
  });

  it('getCart marks available=false when the offer is completely out of stock', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ count: 0, warehouseId: 'W1' }),
    ]);
    const { service } = makeService({
      items: [makeItem({ quantity: 2 })],
      connector,
    });
    const res = await service.getCart('u1');
    expect(res.items[0].available).toBe(false);
    expect(res.items[0].quantityAdjusted).toBe(false);
  });

  it('rechecks multiple items and dedups the partner search per (supplier, query)', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ warehouseId: 'W1', costPrice: 100 }),
      makeOffer({ warehouseId: 'W2', costPrice: 200 }),
    ]);
    const searchSpy = jest.spyOn(connector, 'search');
    // Two lines share the same (supplier, article, brand) — e.g. two distinct
    // offers of one article. They must resolve from ONE shared search, not two.
    const items = [
      makeItem({ id: 'i1', warehouseId: 'W1' }),
      makeItem({ id: 'i2', warehouseId: 'W2', priceAtAdd: '240' }),
    ];
    const { service, registry } = makeService({
      items,
      connector,
      applyMarkup: async (c) => Math.round(c * 1.2),
    });
    const res = await service.getCart('u1');
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(registry.getByCode).toHaveBeenCalledTimes(1);
    expect(res.items).toHaveLength(2);
    expect(res.items.every((i: any) => i.available)).toBe(true);
    expect(res.totalAmount).toBe(120 * 2 + 240 * 2);
  });

  it('getCart returns items in stable createdAt order regardless of DB row order', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ warehouseId: 'W1' }),
      makeOffer({ warehouseId: 'W2' }),
      makeOffer({ warehouseId: 'W3' }),
    ]);
    // DB hands rows back in heap order (here: shuffled). getCart must reorder by
    // createdAt so the lines don't reshuffle on reload / quantity change.
    const items = [
      makeItem({ id: 'i2', warehouseId: 'W2', createdAt: new Date(2000) }),
      makeItem({ id: 'i3', warehouseId: 'W3', createdAt: new Date(3000) }),
      makeItem({ id: 'i1', warehouseId: 'W1', createdAt: new Date(1000) }),
    ];
    const { service } = makeService({ items, connector });
    const res = await service.getCart('u1');
    expect(res.items.map((i: any) => i.id)).toEqual(['i1', 'i2', 'i3']);
  });

  it('runs a separate search per distinct article of the same supplier', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ warehouseId: 'W1', costPrice: 100 }),
    ]);
    const searchSpy = jest.spyOn(connector, 'search');
    const items = [
      makeItem({ id: 'i1', article: 'A1', warehouseId: 'W1' }),
      makeItem({ id: 'i2', article: 'A2', warehouseId: 'W1' }),
    ];
    const { service } = makeService({ items, connector });
    await service.getCart('u1');
    expect(searchSpy).toHaveBeenCalledTimes(2);
  });

  it('getCheckoutItems returns the checkout contract including costPrice and sellPrice', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ costPrice: 125, count: 10, warehouseId: 'W1', raw: { offerId: 'fresh' } }),
    ]);
    const { service } = makeService({
      items: [makeItem()],
      connector,
      applyMarkup: async (c) => Math.round(c * 1.2), // 150
    });
    const res = await service.getCheckoutItems('u1');
    expect(res[0]).toEqual({
      supplierCode: 'mock',
      article: 'A1',
      brand: 'BR',
      productName: 'Part',
      costPrice: 125,
      sellPrice: 150,
      currentPrice: 150,
      priceAtAdd: 120,
      warehouseId: 'W1',
      raw: { offerId: 'fresh' },
      quantity: 2,
      available: true,
      priceChanged: true,
    });
  });

  it('getCheckoutItems falls back to snapshot cost/price when the partner fails', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').failWith(
      new Error('down'),
    );
    const { service } = makeService({ items: [makeItem()], connector });
    const res = await service.getCheckoutItems('u1');
    expect(res[0].available).toBe(false);
    expect(res[0].costPrice).toBe(100);
    expect(res[0].currentPrice).toBe(120);
    expect(res[0].sellPrice).toBe(120);
    expect(res[0].raw).toEqual({ offerId: 'snap' });
  });

  it('getCart exposes maxQuantity and deliveryDays from the live count', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ count: 7, deliveryDays: 10, warehouseId: 'W1', raw: { offerKey: 'g|W1' } }),
    ]);
    const { service } = makeService({ items: [makeItem({ raw: { offerKey: 'g|W1' } })], connector });
    const res = await service.getCart('u1');
    expect(res.items[0].maxQuantity).toBe(7);
    expect(res.items[0].deliveryDays).toBe(10);
  });

  it('getCart reports deliveryDays=null for an unavailable line', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').failWith(
      new Error('down'),
    );
    const { service } = makeService({ items: [makeItem()], connector });
    const res = await service.getCart('u1');
    expect(res.items[0].available).toBe(false);
    expect(res.items[0].deliveryDays).toBeNull();
  });

  it('updateItem rejects quantity above maxQuantity', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ count: 3, warehouseId: 'W1', raw: { offerKey: 'g|W1' } }),
    ]);
    const { service } = makeService({ items: [makeItem({ id: 'i1', raw: { offerKey: 'g|W1' } })], connector });
    await expect(service.updateItem('u1', 'i1', 5)).rejects.toThrow(/доступно|available/i);
  });

  it('getCart exposes the live offer multiplicity for each line', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ count: 12, multiplicity: 4, warehouseId: 'W1', raw: { offerKey: 'g|W1' } }),
    ]);
    const { service } = makeService({
      items: [makeItem({ quantity: 4, raw: { offerKey: 'g|W1' } })],
      connector,
    });
    const res = await service.getCart('u1');
    expect(res.items[0].multiplicity).toBe(4);
  });

  it('updateItem rejects a quantity that is not a multiple of the live offer multiplicity', async () => {
    // The stored raw carries NO multiplicity — the value must come from the live
    // recheck, exactly the case that let the cart step by 1 for a pack-of-4 offer.
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ count: 12, multiplicity: 4, warehouseId: 'W1', raw: { offerKey: 'g|W1' } }),
    ]);
    const { service } = makeService({
      items: [makeItem({ id: 'i1', quantity: 4, raw: { offerKey: 'g|W1' } })],
      connector,
    });
    await expect(service.updateItem('u1', 'i1', 5)).rejects.toThrow(/кратно/i);
  });

  it('updateItem accepts a valid multiple of the live offer multiplicity', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ count: 12, multiplicity: 4, warehouseId: 'W1', raw: { offerKey: 'g|W1' } }),
    ]);
    const { service } = makeService({
      items: [makeItem({ id: 'i1', quantity: 4, raw: { offerKey: 'g|W1' } })],
      connector,
    });
    const res = await service.updateItem('u1', 'i1', 8);
    expect(res.items[0].quantity).toBe(8);
  });
});
