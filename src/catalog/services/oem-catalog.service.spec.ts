import { OemCatalogService } from './oem-catalog.service';

function fakeCache() {
  return { getOrFetch: jest.fn((_k: any, _ttl: number, fn: () => any) => fn()) } as any;
}
function fakeClient(data: any, headers: Record<string, string> = {}) {
  return { request: jest.fn(async () => ({ data, headers })) } as any;
}

describe('OemCatalogService', () => {
  it('listCatalogs maps fields and coerces booleans', async () => {
    const client = fakeClient([{ id: 'bmw', name: 'BMW', modelsCount: 20, actuality: '2025-3', hasVinCheck: true, hasFrameCheck: false }]);
    const svc = new OemCatalogService(client, fakeCache());
    expect(await svc.listCatalogs()).toEqual([
      { id: 'bmw', name: 'BMW', modelsCount: 20, actuality: '2025-3', hasVinCheck: true, hasFrameCheck: false },
    ]);
  });

  it('listCars returns total from the x-total-count header', async () => {
    const client = fakeClient([{ id: 'c1', name: '320i' }], { 'x-total-count': '42' });
    const svc = new OemCatalogService(client, fakeCache());
    const out = await svc.listCars('bmw', 'm1');
    expect(out.total).toBe(42);
    expect(out.items[0]).toMatchObject({ id: 'c1', catalogId: 'bmw', name: '320i' });
    expect(client.request.mock.calls[0][0].query).toEqual({ modelId: 'm1', parameter: undefined, page: undefined });
  });

  it('carsByVin maps CarInfo rows', async () => {
    const client = fakeClient([{ catalogId: 'bmw', carId: 'car9', title: 'BMW 320i', brand: 'BMW', modelId: 'm5', criteria: 'crit', vin: 'V1' }]);
    const svc = new OemCatalogService(client, fakeCache());
    const out = await svc.carsByVin('V1', 'bmw,audi');
    expect(out[0]).toEqual({
      catalogId: 'bmw', carId: 'car9', title: 'BMW 320i', brand: 'BMW', modelId: 'm5',
      modelName: null, criteria: 'crit', vin: 'V1', frame: null,
    });
    expect(client.request.mock.calls[0][0].query).toEqual({ q: 'V1', catalogs: 'bmw,audi' });
  });

  it('groups normalizes protocol-relative images and flags', async () => {
    const client = fakeClient([{ id: 'g1', parentId: null, name: 'Brakes', img: '//img/g.png', hasSubgroups: false, hasParts: true }]);
    const svc = new OemCatalogService(client, fakeCache());
    const out = await svc.groups('bmw', 'car1');
    expect(out[0]).toEqual({ id: 'g1', parentId: null, name: 'Brakes', img: 'https://img/g.png', hasSubgroups: false, hasParts: true });
  });

  it('parts maps hotspot coordinates and nested part groups', async () => {
    const client = fakeClient({
      img: '//img/x.png', imgDescription: 'd', brand: 'BMW',
      positions: [{ number: '1', coordinates: [10, 20, 30, 40] }],
      partGroups: [{ name: 'G', number: 'N', positionNumber: '1', description: '', parts: [{ id: 'p1', name: 'Bolt', number: 'B1', positionNumber: '1', notice: '', description: '' }] }],
    });
    const svc = new OemCatalogService(client, fakeCache());
    const out = await svc.parts('bmw', 'car1', 'grp1');
    expect(out.img).toBe('https://img/x.png');
    expect(out.positions[0]).toEqual({ number: '1', x: 10, y: 20, h: 30, w: 40 });
    expect(out.partGroups[0].parts[0]).toMatchObject({ id: 'p1', number: 'B1', name: 'Bolt' });
  });

  it('validateVin returns null on empty list', async () => {
    const svc = new OemCatalogService(fakeClient([]), fakeCache());
    expect(await svc.validateVin('X')).toBeNull();
  });
});
