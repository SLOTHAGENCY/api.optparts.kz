// src/common/crypto.service.spec.ts
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  const old = process.env.APP_SECRET;
  beforeAll(() => { process.env.APP_SECRET = 'test-master-secret'; });
  afterAll(() => { process.env.APP_SECRET = old; });

  it('round-trips a secret', () => {
    const c = new CryptoService();
    const enc = c.encrypt('rossko-key-123');
    expect(enc).not.toContain('rossko-key-123');
    expect(c.decrypt(enc)).toBe('rossko-key-123');
  });

  it('produces different ciphertext each call (random IV)', () => {
    const c = new CryptoService();
    expect(c.encrypt('x')).not.toBe(c.encrypt('x'));
  });

  it('throws on tampered payload', () => {
    const c = new CryptoService();
    const enc = c.encrypt('secret');
    const tampered = enc.slice(0, -2) + (enc.endsWith('aa') ? 'bb' : 'aa');
    expect(() => c.decrypt(tampered)).toThrow();
  });
});
