import { PartsCatalogService } from './parts-catalog.service';

function fakeCache() {
  return { getOrFetch: jest.fn((_k: any, _ttl: number, fn: () => any) => fn()) } as any;
}
function fakeClient(data: any) {
  return { request: jest.fn(async () => ({ data, headers: {} })) } as any;
}

describe('PartsCatalogService', () => {
  it('listCategories maps id/name/image', async () => {
    const svc = new PartsCatalogService(fakeClient({ list: [{ id: 'lamps', name: 'Лампы', image: 'x.png' }] }), fakeCache());
    expect(await svc.listCategories('ru')).toEqual([{ id: 'lamps', name: 'Лампы', image: 'x.png' }]);
  });

  it('groups normalizes nested trees regardless of child key name', async () => {
    const client = fakeClient({ list: [{ id: 1, name: 'A', subGroups: [{ id: 2, name: 'B', groups: [{ id: 3, name: 'C' }] }] }] });
    const svc = new PartsCatalogService(client, fakeCache());
    const tree = await svc.groups('lamps');
    expect(tree).toEqual([
      { id: '1', name: 'A', children: [{ id: '2', name: 'B', children: [{ id: '3', name: 'C', children: [] }] }] },
    ]);
  });

  it('suggest returns flat text list', async () => {
    const svc = new PartsCatalogService(fakeClient({ list: [{ text: 'lukoil' }, { text: 'liqui moly' }] }), fakeCache());
    expect(await svc.suggest('oils', 'g1', 'lu')).toEqual(['lukoil', 'liqui moly']);
  });

  it('params builds bracketed scope query and normalizes facets', async () => {
    const client = fakeClient({ list: [{ id: 120, code: 'visc', name: 'Вязкость', type: 'select', values: [{ value: '5W-30', title: '5W-30', available: true, selected: false }] }] });
    const svc = new PartsCatalogService(client, fakeCache());
    const out = await svc.params('oils', { groupId: 'g1', generationId: 'gen9', filters: { '55': 'x' }, lang: 'ru' });

    const query = client.request.mock.calls[0][0].query;
    expect(query).toEqual({ groupId: 'g1', 'car[generationId]': 'gen9', 'params[55]': 'x', lang: 'ru' });
    expect(out[0]).toEqual({ id: '120', code: 'visc', name: 'Вязкость', type: 'select', values: [{ value: '5W-30', title: '5W-30', available: true, selected: false }] });
  });

  it('products maps pagination and items and passes page/limit', async () => {
    const client = fakeClient({
      pagination: { limit: 25, page: { prev: null, current: 2, next: 3 } },
      list: [{ id: 7, code: 'P7', name: { name: 'Масло' }, originalName: 'X', brand: { id: 9, name: 'Lukoil' }, images: ['i.jpg'] }],
    });
    const svc = new PartsCatalogService(client, fakeCache());
    const out = await svc.products('oils', { groupId: 'g1' }, 2, 25);
    expect(client.request.mock.calls[0][0].query).toMatchObject({ groupId: 'g1', page: 2, limit: 25 });
    expect(out.page).toEqual({ prev: null, current: 2, next: 3 });
    expect(out.items[0]).toEqual({ id: '7', code: 'P7', name: 'Масло', originalName: 'X', brand: { id: '9', name: 'Lukoil' }, images: ['i.jpg'] });
  });

  it('car tree endpoints hit the right paths', async () => {
    const client = fakeClient({ list: [{ id: 1, name: 'Toyota', yearBegin: 2011, yearEnd: 2017, code: '2AR', hp: 181, kw: 133, cc: 2494 }] });
    const svc = new PartsCatalogService(client, fakeCache());
    await svc.carBrands('toy');
    await svc.carModels('73');
    await svc.carGenerations('73', '512', 'ru');
    await svc.carEngines('73', '512', 'g50');
    const paths = client.request.mock.calls.map((c: any[]) => c[0].path);
    expect(paths).toEqual([
      '/car/brands',
      '/car/brands/73/models',
      '/car/brands/73/models/512/generations',
      '/car/brands/73/models/512/generations/g50/engines',
    ]);
  });
});
