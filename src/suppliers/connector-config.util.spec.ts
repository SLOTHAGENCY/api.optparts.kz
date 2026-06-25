import { resolveConfig, hasKeys } from './connector-config.util';

function svc(supplier: any) {
  return {
    findByCode: jest.fn(async () => supplier),
    getSecrets: jest.fn(async () => supplier?.secrets ?? {}),
  } as any;
}

describe('resolveConfig', () => {
  const OLD = process.env.TABYS_API_KEY;
  afterAll(() => { process.env.TABYS_API_KEY = OLD; });

  it('priority secrets > config > env', async () => {
    process.env.TABYS_API_KEY = 'from-env';
    const s = svc({ config: { API_KEY: 'from-config' }, secrets: { API_KEY: 'from-secret' }, timeoutMs: null });
    const out = await resolveConfig(s, 'tabys', { API_KEY: 'TABYS_API_KEY' });
    expect(out.API_KEY).toBe('from-secret');
  });

  it('falls back to env when neither secret nor config set', async () => {
    process.env.TABYS_API_KEY = 'from-env';
    const s = svc({ config: {}, secrets: {}, timeoutMs: null });
    const out = await resolveConfig(s, 'tabys', { API_KEY: 'TABYS_API_KEY' });
    expect(out.API_KEY).toBe('from-env');
  });

  it('exposes TIMEOUT_MS from supplier, default 15000', async () => {
    const s1 = svc({ config: {}, secrets: {}, timeoutMs: 3000 });
    expect((await resolveConfig(s1, 'tabys', {})).TIMEOUT_MS).toBe('3000');
    const s2 = svc({ config: {}, secrets: {}, timeoutMs: null });
    expect((await resolveConfig(s2, 'tabys', {})).TIMEOUT_MS).toBe('15000');
  });

  it('works when findByCode returns null: falls back to env and defaults TIMEOUT_MS to 15000', async () => {
    process.env.TABYS_API_KEY = 'from-env';
    const s = {
      findByCode: jest.fn(async () => null),
      getSecrets: jest.fn(async () => ({})),
    } as any;
    const out = await resolveConfig(s, 'tabys', { API_KEY: 'TABYS_API_KEY' });
    expect(out.API_KEY).toBe('from-env');
    expect(out.TIMEOUT_MS).toBe('15000');
  });
});

describe('hasKeys', () => {
  it('true only when all required present & non-empty', () => {
    expect(hasKeys({ A: 'x', B: 'y' }, ['A', 'B'])).toBe(true);
    expect(hasKeys({ A: 'x', B: '' }, ['A', 'B'])).toBe(false);
    expect(hasKeys({ A: 'x' }, ['A', 'B'])).toBe(false);
  });
});
