interface HasConfig {
  findByCode(code: string): Promise<{ config?: Record<string, unknown> | null } | null>;
}

export async function resolveConfig(
  suppliersService: HasConfig,
  code: string,
  envMap: Record<string, string>,
): Promise<Record<string, string>> {
  const supplier = await suppliersService.findByCode(code);
  const config = (supplier?.config ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [key, envName] of Object.entries(envMap)) {
    const fromCfg = config[key];
    const cfgStr = fromCfg == null ? '' : String(fromCfg).trim();
    out[key] = cfgStr !== '' ? cfgStr : process.env[envName] ?? '';
  }
  return out;
}

export function hasKeys(resolved: Record<string, string>, required: string[]): boolean {
  return required.every((k) => (resolved[k] ?? '').trim() !== '');
}
