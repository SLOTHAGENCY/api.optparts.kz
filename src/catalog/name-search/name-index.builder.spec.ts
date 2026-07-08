import { NameIndexBuilder } from './name-index.builder';
import { normToString } from './name-normalize';

describe('NameIndexBuilder.rebuild', () => {
  it('плоско разворачивает категории + дерево групп и пишет norm', async () => {
    const catalog = {
      listCategories: jest.fn().mockResolvedValue([
        { id: 'ignition', name: 'Свечи зажигания', image: null },
      ]),
      groups: jest.fn().mockResolvedValue([
        {
          id: 'root',
          name: 'Зажигание',
          children: [{ id: '84', name: 'Свечи накаливания', children: [] }],
        },
      ]),
    };

    const saved: any[] = [];
    const manager = {
      delete: jest.fn().mockResolvedValue(undefined),
      insert: jest.fn(async (_e: unknown, rows: any[]) => { saved.push(...rows); }),
    };
    const dataSource = { transaction: (fn: any) => fn(manager) };
    const index = { reload: jest.fn().mockResolvedValue(undefined), size: () => saved.length };

    const builder = new NameIndexBuilder(
      catalog as any,
      dataSource as any,
      index as any,
    );

    const res = await builder.rebuild('ru');

    expect(res.categories).toBe(1);
    expect(res.groups).toBe(2); // root + 1 child
    expect(manager.delete).toHaveBeenCalled();
    const category = saved.find((r) => r.kind === 'category');
    expect(category.norm).toBe(normToString('Свечи зажигания'));
    const child = saved.find((r) => r.name === 'Свечи накаливания');
    expect(child.kind).toBe('group');
    expect(child.groupId).toBe('84');
    expect(child.parentName).toBe('Свечи зажигания');
    expect(index.reload).toHaveBeenCalled();
  });
});
