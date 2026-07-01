import {
  BadGatewayException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';

/** Upstream provider quota/limit exhausted (e.g. PartsIndex 403 code 1004). */
export class CatalogQuotaExceededException extends ServiceUnavailableException {
  constructor(message = 'Catalog provider quota exceeded.') {
    super(message);
  }
}

/** Upstream provider unreachable or returned 5xx / network failure. */
export class CatalogUpstreamException extends BadGatewayException {
  constructor(message = 'Catalog provider is unavailable.') {
    super(message);
  }
}

/** Our credentials/access are wrong (401 / access-deny 403) — a config problem, not the client's fault. */
export class CatalogConfigException extends InternalServerErrorException {
  constructor(message = 'Catalog provider access is misconfigured.') {
    super(message);
  }
}
