interface HasConfig {
  findByCode(code: string): Promise<
    { config?: Record<string, unknown> | null; timeoutMs?: number | null } | null
  >;
  getSecrets?(code: string): Promise<Record<string, string>>;
}

const DEFAULT_TIMEOUT_MS = 15000;

export async function resolveConfig(
  suppliersService: HasConfig,
  code: string,
  envMap: Record<string, string>,
): Promise<Record<string, string>> {
  const supplier = await suppliersService.findByCode(code);
  const config = (supplier?.config ?? {}) as Record<string, unknown>;
  const secrets = suppliersService.getSecrets
    ? await suppliersService.getSecrets(code)
    : {};
  const out: Record<string, string> = {};
  for (const [key, envName] of Object.entries(envMap)) {
    const fromSecret = secrets[key];
    const fromCfg = config[key];
    const secretStr = fromSecret == null ? '' : String(fromSecret).trim();
    const cfgStr = fromCfg == null ? '' : String(fromCfg).trim();
    out[key] =
      secretStr !== '' ? secretStr
      : cfgStr !== '' ? cfgStr
      : process.env[envName] ?? '';
  }
  out.TIMEOUT_MS = String(supplier?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return out;
}

export function hasKeys(resolved: Record<string, string>, required: string[]): boolean {
  return required.every((k) => (resolved[k] ?? '').trim() !== '');
}
