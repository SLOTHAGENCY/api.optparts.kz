/** Cache TTLs (ms) for catalog provider responses. Protects paid/limited quotas. */
export const CATALOG_TTL = {
  /** Reference data that rarely changes (category lists, car makes). */
  REFERENCE_MS: 7 * 24 * 60 * 60 * 1000,
  /** Article/analog/applicability/card and vehicle/node/part data. */
  DYNAMIC_MS: 24 * 60 * 60 * 1000,
} as const;
