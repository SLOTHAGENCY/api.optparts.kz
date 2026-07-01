import { classifyQuery, GlobalSearchService } from './global-search.service';

describe('classifyQuery', () => {
  it('detects a 17-char VIN', () => {
    expect(classifyQuery('WBAAV33403FD12345')).toBe('vin');
  });
  it('treats an OE/article number as article', () => {
    expect(classifyQuery('0451103316')).toBe('article');
    expect(classifyQuery('04465-33450')).toBe('article');
  });
  it('treats free text / cyrillic as name', () => {
    expect(classifyQuery('тормозные колодки')).toBe('name');
    expect(classifyQuery('oil filter')).toBe('name');
  });
});

function services(over: any = {}) {
  return {
    oem: { carsByVin: jest.fn(async () => [{ catalogId: 'bmw', carId: 'c1' }]) },
    search: { search: jest.fn(async () => ({ query: {}, exact: [], analogs: [] })) },
    parts: { brandsByCode: jest.fn(async () => [{ id: '1', name: 'Bosch' }]) },
    catalog: { listCategories: jest.fn(async () => [{ id: 'lamps', name: 'Лампы', image: null }, { id: 'oils', name: 'Масла', image: null }]) },
    ...over,
  };
}

function make(over: any = {}) {
  const s = services(over);
  return { svc: new GlobalSearchService(s.oem as any, s.search as any, s.parts as any, s.catalog as any), s };
}

describe('GlobalSearchService', () => {
  it('routes VIN queries to OEM carsByVin only', async () => {
    const { svc, s } = make();
    const res = await svc.search('WBAAV33403FD12345', { catalogs: 'bmw' });
    expect(res.mode).toBe('vin');
    expect(res.vin).toHaveLength(1);
    expect(s.oem.carsByVin).toHaveBeenCalledWith('WBAAV33403FD12345', 'bmw', undefined);
    expect(s.search.search).not.toHaveBeenCalled();
  });

  it('routes article queries to SearchService + PartsIndex brands', async () => {
    const { svc, s } = make();
    const res = await svc.search('0451103316');
    expect(res.mode).toBe('article');
    expect(s.oem.carsByVin).not.toHaveBeenCalled();
    expect(res.article?.brands).toEqual([{ id: '1', name: 'Bosch' }]);
    expect(res.article?.search).toBeDefined();
  });

  it('routes name queries to filtered categories', async () => {
    const { svc, s } = make();
    const res = await svc.search('масл');
    expect(res.mode).toBe('name');
    expect(s.parts.brandsByCode).not.toHaveBeenCalled();
    expect(res.name?.categories).toEqual([{ id: 'oils', name: 'Масла', image: null }]);
  });

  it('degrades gracefully when a provider throws', async () => {
    const { svc } = make({ parts: { brandsByCode: jest.fn(async () => { throw new Error('quota'); }) } });
    const res = await svc.search('0451103316');
    expect(res.article?.brands).toEqual([]);
    expect(res.article?.search).toBeDefined();
  });
});
