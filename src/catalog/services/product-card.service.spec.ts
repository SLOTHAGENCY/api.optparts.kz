import { ProductCardService } from './product-card.service';

const entity = {
  id: '1', code: 'C1', name: 'Oil Filter', originalName: 'Pro', brand: { id: '9', name: 'Bosch' },
  description: 'd', barcodes: [], images: ['i.jpg'], parameters: [],
};
const analog = { id: '2', code: 'A2', brand: { id: '3', name: 'Mann' }, relation: 'analog' };
const applic = { brand: 'Toyota', model: 'Camry', modif: '2.5', yearFrom: 2011, yearTo: 2017, kw: null, hp: null, cc: null, body: null, engineCode: null };
const offer = { offerId: 'o1', supplierCode: 'rossko', supplierName: 'Rossko', sellPrice: 100, deliveryDays: 3, count: 5, multiplicity: 1, warehouseId: 's1', raw: {} };

function parts(over: any = {}) {
  return {
    entity: jest.fn(async () => entity),
    analogs: jest.fn(async () => [analog]),
    applicability: jest.fn(async () => [applic]),
    ...over,
  } as any;
}
function search(over: any = {}) {
  return { search: jest.fn(async () => ({ exact: [{ offers: [offer] }], analogs: [] })), ...over } as any;
}

describe('ProductCardService', () => {
  it('assembles entity + analogs + applicability + offers', async () => {
    const svc = new ProductCardService(parts(), search());
    const card = await svc.getCard('C1', 'Bosch');
    expect(card.code).toBe('C1');
    expect(card.name).toBe('Oil Filter');
    expect(card.brand).toEqual({ id: '9', name: 'Bosch' });
    expect(card.analogs).toEqual([analog]);
    expect(card.applicability).toEqual([applic]);
    expect(card.offers).toEqual([offer]);
  });

  it('skips applicability when brand is not provided', async () => {
    const p = parts();
    const svc = new ProductCardService(p, search());
    const card = await svc.getCard('C1');
    expect(p.applicability).not.toHaveBeenCalled();
    expect(card.applicability).toEqual([]);
    // brand still resolved from the found entity even though it was not queried
    expect(card.brand).toEqual({ id: '9', name: 'Bosch' });
  });

  it('degrades gracefully when PartsIndex entity throws (still returns offers)', async () => {
    const p = parts({ entity: jest.fn(async () => { throw new Error('quota'); }), analogs: jest.fn(async () => { throw new Error('quota'); }) });
    const svc = new ProductCardService(p, search());
    const card = await svc.getCard('C1', 'Bosch');
    expect(card.name).toBe('');
    expect(card.analogs).toEqual([]);
    expect(card.offers).toEqual([offer]);
    expect(card.brand).toEqual({ id: '', name: 'Bosch' });
  });

  it('returns empty offers when the price search fails', async () => {
    const s = search({ search: jest.fn(async () => { throw new Error('down'); }) });
    const svc = new ProductCardService(parts(), s);
    const card = await svc.getCard('C1', 'Bosch');
    expect(card.offers).toEqual([]);
    expect(card.name).toBe('Oil Filter');
  });
});
