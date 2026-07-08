import { stemRu, transliterate, normalize, normToString, levenshtein } from './name-normalize';

describe('stemRu', () => {
  it.each([
    ['свеча', 'свеч'],
    ['свечи', 'свеч'],
    ['свечей', 'свеч'],
    ['зажигания', 'зажигани'],
    ['зажигание', 'зажигани'],
    ['колодки', 'колодк'],
    ['колодка', 'колодк'],
    ['фильтр', 'фильтр'],
    ['фильтра', 'фильтр'],
    ['фильтров', 'фильтр'],
    ['масляный', 'маслян'],
    ['масляная', 'маслян'],
    ['лампы', 'ламп'],
  ])('стеммит %s -> %s', (input, expected) => {
    expect(stemRu(input)).toBe(expected);
  });

  it('не режет слова <= 3 символов', () => {
    expect(stemRu('ось')).toBe('ось');
  });
});

describe('transliterate', () => {
  it('латиница -> кириллица с диграфами', () => {
    expect(transliterate('svecha')).toBe('свеча');
    expect(transliterate('lampa')).toBe('лампа');
  });
});

describe('normalize', () => {
  it('ё->е, пунктуация, стоп-слова, стемминг, транслит', () => {
    expect(normalize('Свечи зажигания')).toEqual(['свеч', 'зажигани']);
    expect(normalize('svecha')).toEqual(['свеч']);
    expect(normalize('фильтр для масла')).toEqual(['фильтр', 'масл']);
  });
  it('пустой ввод -> []', () => {
    expect(normalize('   ')).toEqual([]);
  });
});

describe('normToString', () => {
  it('соединяет стеммы пробелом', () => {
    expect(normToString('Свечи зажигания')).toBe('свеч зажигани');
  });
});

describe('levenshtein', () => {
  it('считает расстояние', () => {
    expect(levenshtein('свеч', 'свеч')).toBe(0);
    expect(levenshtein('колодок', 'колодк')).toBe(1);
    expect(levenshtein('свеча', 'сеча')).toBe(1);
  });
});
