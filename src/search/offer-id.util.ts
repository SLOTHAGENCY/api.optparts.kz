export interface OfferIdParts {
  supplierCode: string;
  article: string;
  brand: string;
  warehouseId: string;
}

/**
 * Deterministic, storage-free offer identifier.
 * `offerId = base64url("{supplierCode}|{article}|{brand}|{warehouseId}")`.
 * The frontend returns the full offer (including this id) when adding to cart (Spec B).
 */
export function encodeOfferId(parts: OfferIdParts): string {
  const raw = `${parts.supplierCode}|${parts.article}|${parts.brand}|${parts.warehouseId}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

export function decodeOfferId(offerId: string): OfferIdParts {
  const raw = Buffer.from(offerId, 'base64url').toString('utf8');
  const [supplierCode = '', article = '', brand = '', warehouseId = ''] = raw.split('|');
  return { supplierCode, article, brand, warehouseId };
}
