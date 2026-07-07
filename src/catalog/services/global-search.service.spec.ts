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
    search: { search: jest.fn(async () => ({ query: {}, exact: [], analogs: [] })), logVinSearch: jest.fn() },
    parts: {
      brandsByCode: jest.fn(async () => [{ id: '1', name: 'Bosch' }]),
      entity: jest.fn(async () => ({ images: ['https://img.example.com/part.jpg'] })),
    },
    catalog: { listCategories: jest.fn(async () => [{ id: 'lamps', name: 'Лампы', image: null }, { id: 'oils', name: 'Масла', image: null }]) },
    ...over,
  };
}

function group(article: string, brand: string) {
  return { article, brand, name: 'Part', offers: [] };
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

  it('logs the VIN search with the matched-car count', async () => {
    const { svc, s } = make();
    await svc.search('WBAAV33403FD12345', { catalogs: 'bmw', userId: 'user-9' });
    expect(s.search.logVinSearch).toHaveBeenCalledWith({
      userId: 'user-9',
      vin: 'WBAAV33403FD12345',
      catalogs: 'bmw',
      matchedCars: 1,
    });
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
    const { svc } = make({
      parts: {
        brandsByCode: jest.fn(async () => { throw new Error('quota'); }),
        entity: jest.fn(async () => null),
      },
    });
    const res = await svc.search('0451103316');
    expect(res.article?.brands).toEqual([]);
    expect(res.article?.search).toBeDefined();
  });
});

describe('GlobalSearchService image enrichment', () => {
  it('attaches images[0] to exact groups only, leaving analogs untouched', async () => {
    const exact = [group('0451103316', 'BOSCH')];
    const analogs = [group('123456', 'MANN')];
    const { svc, s } = make({
      search: { search: jest.fn(async () => ({ query: {}, exact, analogs })) },
    });
    const res = await svc.search('0451103316');
    expect(s.parts.entity).toHaveBeenCalledTimes(1);
    expect(s.parts.entity).toHaveBeenCalledWith('0451103316', 'BOSCH');
    expect(res.article?.search.exact[0].image).toBe('https://img.example.com/part.jpg');
    expect(res.article?.search.analogs[0].image).toBeUndefined();
  });

  it('sets image=null when entity() resolves without images', async () => {
    const exact = [group('AAA1', 'X')];
    const { svc } = make({
      search: { search: jest.fn(async () => ({ query: {}, exact, analogs: [] })) },
      parts: { brandsByCode: jest.fn(async () => []), entity: jest.fn(async () => ({ images: [] })) },
    });
    const res = await svc.search('AAA1');
    expect(res.article?.search.exact[0].image).toBeNull();
  });

  it('sets image=null and still returns the full response when entity() throws', async () => {
    const exact = [group('AAA1', 'X'), group('BBB2', 'Y')];
    const { svc } = make({
      search: { search: jest.fn(async () => ({ query: {}, exact, analogs: [] })) },
      parts: {
        brandsByCode: jest.fn(async () => []),
        entity: jest
          .fn()
          .mockRejectedValueOnce(new Error('timeout'))
          .mockResolvedValueOnce({ images: ['https://img.example.com/b.jpg'] }),
      },
    });
    const res = await svc.search('AAA1');
    expect(res.article?.search.exact[0].image).toBeNull();
    expect(res.article?.search.exact[1].image).toBe('https://img.example.com/b.jpg');
    expect(res.article?.search.exact).toHaveLength(2);
  });

  it('sets image=null when entity() resolves null', async () => {
    const exact = [group('AAA1', 'X')];
    const { svc } = make({
      search: { search: jest.fn(async () => ({ query: {}, exact, analogs: [] })) },
      parts: { brandsByCode: jest.fn(async () => []), entity: jest.fn(async () => null) },
    });
    const res = await svc.search('AAA1');
    expect(res.article?.search.exact[0].image).toBeNull();
  });

  it('caps enrichment at MAX_ENRICH (5) exact groups', async () => {
    const exact = Array.from({ length: 7 }, (_, i) => group(`ART${i}`, 'BOSCH'));
    const entity = jest.fn(async () => ({ images: ['https://img.example.com/x.jpg'] }));
    const { svc } = make({
      search: { search: jest.fn(async () => ({ query: {}, exact, analogs: [] })) },
      parts: { brandsByCode: jest.fn(async () => []), entity },
    });
    const res = await svc.search('ART0');
    expect(entity).toHaveBeenCalledTimes(5);
    for (let i = 0; i < 5; i++) {
      expect(res.article?.search.exact[i].image).toBe('https://img.example.com/x.jpg');
    }
    for (let i = 5; i < 7; i++) {
      expect(res.article?.search.exact[i].image).toBeUndefined();
    }
  });
});
