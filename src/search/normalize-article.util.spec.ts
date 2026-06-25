import { normalizeArticle } from './normalize-article.util';

describe('normalizeArticle', () => {
  it('strips dashes, spaces, dots, slashes and uppercases', () => {
    expect(normalizeArticle('0451-103 316')).toBe('0451103316');
    expect(normalizeArticle('a.1/2 b')).toBe('A12B');
    expect(normalizeArticle('  bosch ')).toBe('BOSCH');
  });

  it('is idempotent and null-safe', () => {
    expect(normalizeArticle(normalizeArticle('04-51'))).toBe('0451');
    expect(normalizeArticle(undefined as any)).toBe('');
  });
});
