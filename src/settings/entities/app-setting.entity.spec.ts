import { AppSetting } from './app-setting.entity';

describe('AppSetting entity', () => {
  it('holds a key and a jsonb value', () => {
    const s = new AppSetting();
    s.key = 'FX_RATES';
    s.value = { RUB: 5.4 };
    expect(s.key).toBe('FX_RATES');
    expect((s.value as any).RUB).toBe(5.4);
  });
});
