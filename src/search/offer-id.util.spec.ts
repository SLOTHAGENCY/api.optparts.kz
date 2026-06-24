import { encodeOfferId, decodeOfferId } from './offer-id.util';

describe('offerId codec', () => {
  const parts = {
    supplierCode: 'rossko',
    article: '0451103316',
    brand: 'BOSCH',
    warehouseId: 's1',
  };

  it('encodes to a base64url string of the pipe-joined fields', () => {
    const expected = Buffer.from('rossko|0451103316|BOSCH|s1', 'utf8').toString('base64url');
    expect(encodeOfferId(parts)).toBe(expected);
  });

  it('round-trips through decode', () => {
    expect(decodeOfferId(encodeOfferId(parts))).toEqual(parts);
  });

  it('handles an empty brand', () => {
    const p = { ...parts, brand: '' };
    expect(decodeOfferId(encodeOfferId(p))).toEqual(p);
  });

  it('produces a url-safe token (no +, /, or =)', () => {
    const token = encodeOfferId({
      supplierCode: 'p',
      article: '???>>>',
      brand: 'b',
      warehouseId: 'w',
    });
    expect(token).not.toMatch(/[+/=]/);
  });
});
