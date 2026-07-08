import { GlobalSearchController } from './global-search.controller';

describe('GlobalSearchController.suggest', () => {
  const index = {
    suggest: jest.fn().mockReturnValue([
      { kind: 'category', categoryId: 'ignition', groupId: null, name: 'Свечи зажигания', parentName: null, score: 120 },
    ]),
  };
  const controller = new GlobalSearchController({} as any, index as any);

  it('возвращает подсказки для запроса >= 2 символов', () => {
    const res = controller.suggest('свеча', undefined, undefined);
    expect(res.query).toBe('свеча');
    expect(res.suggestions[0].categoryId).toBe('ignition');
    expect(index.suggest).toHaveBeenCalledWith('свеча', 'ru', 8);
  });

  it('короткий запрос -> пустой список без обращения к индексу', () => {
    index.suggest.mockClear();
    const res = controller.suggest('с', undefined, undefined);
    expect(res.suggestions).toEqual([]);
    expect(index.suggest).not.toHaveBeenCalled();
  });

  it('ограничивает limit сверху (<=20)', () => {
    index.suggest.mockClear();
    controller.suggest('фильтр', 'ru', '100');
    expect(index.suggest).toHaveBeenCalledWith('фильтр', 'ru', 20);
  });
});
