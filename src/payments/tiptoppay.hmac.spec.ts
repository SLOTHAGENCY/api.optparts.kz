import { createHmac } from 'crypto';
import { isValidHmac } from './tiptoppay.hmac';

const SECRET = 'test_secret';
const BODY = '{"TransactionId":455,"Amount":1000,"InvoiceId":"OP-1"}';

const sign = (body: string, secret = SECRET): string =>
  createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('base64');

describe('isValidHmac', () => {
  it('accepts a signature computed from the raw body with the api secret', () => {
    expect(isValidHmac(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it('accepts a raw Buffer body', () => {
    expect(isValidHmac(Buffer.from(BODY, 'utf8'), sign(BODY), SECRET)).toBe(true);
  });

  it('rejects a signature made with a different secret', () => {
    expect(isValidHmac(BODY, sign(BODY, 'other_secret'), SECRET)).toBe(false);
  });

  it('rejects when the body was tampered with', () => {
    const signature = sign(BODY);
    const tampered = '{"TransactionId":455,"Amount":1,"InvoiceId":"OP-1"}';
    expect(isValidHmac(tampered, signature, SECRET)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(isValidHmac(BODY, undefined, SECRET)).toBe(false);
  });

  it('rejects garbage in the header without throwing', () => {
    expect(isValidHmac(BODY, 'not-base64-@@@', SECRET)).toBe(false);
  });

  it('rejects when the api secret is not configured', () => {
    expect(isValidHmac(BODY, sign(BODY), '')).toBe(false);
  });
});
