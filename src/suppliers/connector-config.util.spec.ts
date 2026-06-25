import { resolveConfig, hasKeys } from './connector-config.util';

function svc(config: Record<string, unknown> | null) {
  return { findByCode: async () => (config === null ? null : { config }) };
}

describe('resolveConfig', () => {
  const envMap = { KEY1: 'ROSSKO_KEY1', KEY2: 'ROSSKO_KEY2' };

  afterEach(() => { delete process.env.ROSSKO_KEY1; delete process.env.ROSSKO_KEY2; });

  it('prefers config over env', async () => {
    process.env.ROSSKO_KEY1 = 'envk1';
    const r = await resolveConfig(svc({ KEY1: 'cfgk1' }) as any, 'rossko', envMap);
    expect(r.KEY1).toBe('cfgk1');
  });

  it('falls back to env when config missing/empty', async () => {
    process.env.ROSSKO_KEY2 = 'envk2';
    const r = await resolveConfig(svc({ KEY1: 'cfgk1', KEY2: '  ' }) as any, 'rossko', envMap);
    expect(r.KEY1).toBe('cfgk1');
    expect(r.KEY2).toBe('envk2');
  });

  it('empty when neither config nor env', async () => {
    const r = await resolveConfig(svc(null) as any, 'rossko', envMap);
    expect(r.KEY1).toBe('');
  });
});

describe('hasKeys', () => {
  it('true only when all required present & non-empty', () => {
    expect(hasKeys({ A: 'x', B: 'y' }, ['A', 'B'])).toBe(true);
    expect(hasKeys({ A: 'x', B: '' }, ['A', 'B'])).toBe(false);
    expect(hasKeys({ A: 'x' }, ['A', 'B'])).toBe(false);
  });
});
