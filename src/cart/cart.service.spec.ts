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

  it('addItem dedups by (supplierCode, article, brand, warehouseId) and sums quantity', async () => {
    const existing = makeItem({ quantity: 1 });
    const { service, itemRepo } = makeService({ items: [existing] });
    await service.addItem('u1', {
      supplierCode: 'mock',
      article: 'A1',
      brand: 'BR',
      productName: 'Part',
      sellPrice: 130,
      costPrice: 110,
      warehouseId: 'W1',
      raw: {},
      quantity: 3,
    });
    expect(existing.quantity).toBe(4);
    expect(itemRepo.create).not.toHaveBeenCalled();
    expect(itemRepo.save).toHaveBeenCalledWith(existing);
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

  it('getCart marks available=false when stock is below requested quantity', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ costPrice: 100, count: 1, warehouseId: 'W1' }),
    ]);
    const { service } = makeService({
      items: [makeItem({ quantity: 5 })],
      connector,
      applyMarkup: async (c) => Math.round(c * 1.2), // 120, equals priceAtAdd
    });
    const res = await service.getCart('u1');
    expect(res.items[0].available).toBe(false);
    expect(res.items[0].currentPrice).toBe(120);
    expect(res.items[0].priceChanged).toBe(false);
  });

  it('rechecks multiple items (parallel) and re-checks each one', async () => {
    const connector = new MockConnector('mock', 'Mock Supplier').setOffers([
      makeOffer({ warehouseId: 'W1', costPrice: 100 }),
      makeOffer({ warehouseId: 'W2', costPrice: 200 }),
    ]);
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
    expect(registry.getByCode).toHaveBeenCalledTimes(2);
    expect(res.items).toHaveLength(2);
    expect(res.items.every((i: any) => i.available)).toBe(true);
    expect(res.totalAmount).toBe(120 * 2 + 240 * 2);
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
});
