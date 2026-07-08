import { SYNONYMS } from './synonyms';
import { stemRu } from './name-normalize';

describe('SYNONYMS', () => {
  it('ключи хранятся в стеммленой форме', () => {
    for (const key of Object.keys(SYNONYMS)) {
      expect(stemRu(key)).toBe(key);
    }
  });
  it('значения тоже стеммлены', () => {
    for (const arr of Object.values(SYNONYMS)) {
      for (const v of arr) expect(stemRu(v)).toBe(v);
    }
  });
  it('покрывает базовые кейсы', () => {
    expect(SYNONYMS['дворник']).toContain('щетк');
    expect(SYNONYMS['тормоз']).toContain('колодк');
  });
});
