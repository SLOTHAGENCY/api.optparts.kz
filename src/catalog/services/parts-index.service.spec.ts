import { PartsIndexService } from './parts-index.service';

function fakeCache() {
  return { getOrFetch: jest.fn((_k: any, _ttl: number, fn: () => any) => fn()) } as any;
}
function fakeClient(data: any) {
  return { request: jest.fn(async () => ({ data, headers: {} })) } as any;
}

describe('PartsIndexService', () => {
  it('brandsByCode maps the list and stringifies ids', async () => {
    const client = fakeClient({ list: [{ id: 3799, name: 'Bosch' }, { id: '4460', name: 'Renault' }] });
    const svc = new PartsIndexService(client, fakeCache());
    const out = await svc.brandsByCode('0451103316');
    expect(out).toEqual([{ id: '3799', name: 'Bosch' }, { id: '4460', name: 'Renault' }]);
    expect(client.request).toHaveBeenCalledWith({ path: '/brands/by-part-code', query: { code: '0451103316' } });
  });

  it('analogs defaults types to all and normalizes relation rows', async () => {
    const client = fakeClient({ list: [{ id: 27805381, code: '17177', relation: 'analog', brand: { id: 5, name: 'Narva' } }] });
    const svc = new PartsIndexService(client, fakeCache());
    const out = await svc.analogs({ code: '17177', brand: 'Narva' });
    expect(out).toEqual([{ id: '27805381', code: '17177', brand: { id: '5', name: 'Narva' }, relation: 'analog' }]);
    expect(client.request).toHaveBeenCalledWith({
      path: '/relations',
      query: { id: undefined, code: '17177', brand: 'Narva', types: 'all' },
    });
  });

  it('applicability maps car fields and coerces numbers', async () => {
    const client = fakeClient({ list: [{ brand: 'Toyota', model: 'Camry', modif: '2.5', dateFrom: 2011, dateTo: 2017, kw: 133, hp: 181, cc: 2494, body: 'Sedan', engCode: '2AR-FE' }] });
    const svc = new PartsIndexService(client, fakeCache());
    const out = await svc.applicability('X', 'Toyota');
    expect(out[0]).toEqual({
      brand: 'Toyota', model: 'Camry', modif: '2.5', yearFrom: 2011, yearTo: 2017,
      kw: 133, hp: 181, cc: 2494, body: 'Sedan', engineCode: '2AR-FE',
    });
  });

  it('entity returns null on empty list', async () => {
    const svc = new PartsIndexService(fakeClient({ list: [] }), fakeCache());
    expect(await svc.entity('X')).toBeNull();
  });

  it('entity normalizes name, brand, images and grouped parameters', async () => {
    const client = fakeClient({
      list: [{
        id: 1, code: 'C1', name: { id: '1384', name: 'Halogen lamp' }, originalName: 'Ultinon',
        barcodes: ['111'], brand: { id: 4418, name: 'Philips' }, description: 'd', images: ['http://img/1.jpg'],
        parameters: [{ name: 'Электрика', params: [{ title: 'Напряжение', values: [{ value: '13.2' }] }] }],
      }],
    });
    const svc = new PartsIndexService(client, fakeCache());
    const e = await svc.entity('C1', 'Philips');
    expect(e).toEqual({
      id: '1', code: 'C1', name: 'Halogen lamp', originalName: 'Ultinon',
      brand: { id: '4418', name: 'Philips' }, description: 'd', barcodes: ['111'], images: ['http://img/1.jpg'],
      parameters: [{ group: 'Электрика', items: [{ title: 'Напряжение', value: '13.2', unit: null }] }],
    });
  });
});
