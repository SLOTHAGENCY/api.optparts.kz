/**
 * The seam for an "unknown outcome" supplier send.
 *
 * A connector's placeOrder has exactly two honest failure kinds:
 *  - a DEFINITE rejection the supplier actually returned (a parsed error body, a business
 *    decline, a 4xx). The supplier does NOT have the order — the connector returns
 *    { status: 'FAILED' } and the order service may safely retry it.
 *  - an INDETERMINATE transport failure with no verdict: a timeout, a reset/refused
 *    connection, a DNS failure, or a 5xx with no usable body. The POST may already have
 *    reached the supplier and committed — we simply never learned the outcome. This must
 *    NOT be collapsed into FAILED (retryable), or one manager click re-sends real goods.
 *    The connector throws IndeterminateSupplierError; sendSupplierOrder() catches it and
 *    leaves the sub-order in SENDING — the ambiguous state only an admin can resolve.
 */
export class IndeterminateSupplierError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'IndeterminateSupplierError';
  }
}

/** axios/node error codes that mean the request never got a response (no supplier verdict). */
const INDETERMINATE_ERROR_CODES = new Set([
  'ECONNABORTED', // axios request timeout
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND', // DNS
]);

/**
 * Classify an axios (or generic) error as an INDETERMINATE transport failure — one where the
 * supplier may or may not have received the order.
 *
 *  - a response WAS received: only a 5xx is indeterminate (the server blew up mid-request and
 *    the commit state is unknown). Any 4xx / other status is a definite verdict the supplier
 *    returned -> NOT indeterminate (the caller treats it as FAILED).
 *  - NO response received (err.request set, or a known transport error code): the request may
 *    have reached the supplier and only the reply was lost -> indeterminate.
 */
export function isIndeterminateSupplierError(err: any): boolean {
  if (!err) return false;
  const response = err.response;
  if (response) {
    return typeof response.status === 'number' && response.status >= 500;
  }
  if (err.request) return true;
  return typeof err.code === 'string' && INDETERMINATE_ERROR_CODES.has(err.code);
}
