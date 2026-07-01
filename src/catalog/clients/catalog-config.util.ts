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
