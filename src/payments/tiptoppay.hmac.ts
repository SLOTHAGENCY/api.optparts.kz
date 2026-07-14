import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Validates the X-Content-HMAC header TipTopPay sends with every webhook.
 *
 * The signature is HMAC-SHA256 of the RAW request body (not the re-serialized JSON —
 * key order and whitespace would differ) keyed with the ApiSecret, base64-encoded.
 *
 * Comparison is constant-time: a fast string compare would leak the expected signature
 * byte by byte to anyone able to time our responses.
 */
export function isValidHmac(
  rawBody: Buffer | string,
  headerValue: string | undefined,
  apiSecret: string,
): boolean {
  if (!headerValue || !apiSecret) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const expected = createHmac('sha256', apiSecret).update(body).digest();

  let received: Buffer;
  try {
    received = Buffer.from(headerValue, 'base64');
  } catch {
    return false;
  }

  // timingSafeEqual throws on length mismatch — check first.
  if (received.length !== expected.length) return false;

  return timingSafeEqual(received, expected);
}
