import { Repository } from 'typeorm';
import { NameSearchIndex } from './name-search-index.service';
import { CatalogNameIndex } from '../entities/catalog-name-index.entity';
import { normToString } from './name-normalize';

/** Собрать fake-строку индекса с корректным norm. */
function row(p: Partial<CatalogNameIndex>): CatalogNameIndex {
  return {
    id: Math.random().toString(36).slice(2),
    kind: 'category',
    catalogId: 'x',
    groupId: null,
    name: '',
    parentName: null,
    lang: 'ru',
    updatedAt: new Date(0),
    ...p,
    norm: normToString(p.name ?? ''),
  } as CatalogNameIndex;
}

function makeIndex(rows: CatalogNameIndex[]): NameSearchIndex {
  const repo = { find: async () => rows } as unknown as Repository<CatalogNameIndex>;
  return new NameSearchIndex(repo);
}

describe('NameSearchIndex.suggest', () => {
  const rows = [
    row({ kind: 'category', catalogId: 'ignition', name: 'Свечи зажигания' }),
    row({ kind: 'group', catalogId: 'ignition', groupId: '84', name: 'Свечи накаливания', parentName: 'Зажигание' }),
    row({ kind: 'category', catalogId: 'lamps', name: 'Лампы' }),
    row({ kind: 'category', catalogId: 'brakes', name: 'Тормозные колодки' }),
    row({ kind: 'category', catalogId: 'wipers', name: 'Щётки стеклоочистителя' }),
    row({ kind: 'category', catalogId: 'filters', name: 'Масляный фильтр' }),
  ];

  let index: NameSearchIndex;
  beforeEach(async () => {
    index = makeIndex(rows);
    await index.load();
  });

  it('единственное число находит множественное (стемминг)', () => {
    const top = index.suggest('свеча');
    expect(top[0].categoryId).toBe('ignition');
  });

  it('транслит: svecha -> свечи', () => {
    expect(index.suggest('svecha')[0].categoryId).toBe('ignition');
  });

  it('синоним: дворники -> щётки стеклоочистителя', () => {
    expect(index.suggest('дворники')[0].categoryId).toBe('wipers');
  });

  it('синоним: тормоз -> тормозные колодки', () => {
    expect(index.suggest('тормоз')[0].categoryId).toBe('brakes');
  });

  it('опечатка (фаззи): сеча -> свечи', () => {
    const top = index.suggest('сеча');
    expect(top.map((s) => s.categoryId)).toContain('ignition');
  });

  it('категория ранжируется выше подгруппы при равном совпадении', () => {
    const top = index.suggest('свечи');
    expect(top[0].kind).toBe('category');
  });

  it('короткий запрос (< 1 значимого токена) -> []', () => {
    expect(index.suggest('')).toEqual([]);
  });

  it('уважает limit', () => {
    expect(index.suggest('фильтр', 'ru', 1).length).toBeLessThanOrEqual(1);
  });
});
