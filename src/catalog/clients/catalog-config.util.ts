export type CatalogProvider = 'partsindex' | 'partscatalogs';

export interface CatalogClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  rpm: number | null;
}

const DEFAULTS: Record<CatalogProvider, { baseUrl: string; prefix: string }> = {
  partsindex: { baseUrl: 'https://api.parts-index.com/v1', prefix: 'PARTSINDEX' },
  partscatalogs: { baseUrl: 'https://api.parts-catalogs.com/v1', prefix: 'PARTSCATALOGS' },
};

/**
 * PartsIndex "part info / информация о детали" surface — the `/parts/*` controller and the
 * brand/image enrichment in global search. Enabled by default; set PARTSINDEX_PARTINFO_ENABLED=false
 * to deactivate (invoice line "Информация о детали"). Disabling stops all calls to
 * /brands/by-part-code and /entities while leaving the PartsIndex goods catalog (/catalog/*) intact.
 */
export function isPartInfoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PARTSINDEX_PARTINFO_ENABLED !== 'false';
}

export function resolveCatalogConfig(
  provider: CatalogProvider,
  env: NodeJS.ProcessEnv = process.env,
): CatalogClientConfig {
  const { baseUrl, prefix } = DEFAULTS[provider];
  const rawRpm = env[`${prefix}_RPM`];
  const rpm =
    rawRpm != null && rawRpm !== '' && Number.isFinite(Number(rawRpm))
      ? Number(rawRpm)
      : null;
  const rawTimeout = Number(env[`${prefix}_TIMEOUT_MS`]);
  return {
    baseUrl: (env[`${prefix}_API_URL`] || baseUrl).replace(/\/+$/, ''),
    apiKey: env[`${prefix}_API_KEY`] ?? '',
    timeoutMs: Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 15000,
    rpm,
  };
}
