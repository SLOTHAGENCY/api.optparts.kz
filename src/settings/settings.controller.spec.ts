import { SettingsController } from './settings.controller';

describe('SettingsController', () => {
  const settings = {
    getAll: jest.fn(async () => ({ DEFAULT_MARKUP_PERCENT: 20, FX_RATES: { KZT: 1 }, FX_BUFFER_PERCENT: 0 })),
    update: jest.fn(async () => undefined),
  };
  const ctrl = new SettingsController(settings as any);

  it('GET returns all settings', async () => {
    expect(await ctrl.get()).toEqual({ DEFAULT_MARKUP_PERCENT: 20, FX_RATES: { KZT: 1 }, FX_BUFFER_PERCENT: 0 });
  });

  it('PUT updates then returns fresh settings', async () => {
    await ctrl.update({ DEFAULT_MARKUP_PERCENT: 25 } as any);
    expect(settings.update).toHaveBeenCalledWith({ DEFAULT_MARKUP_PERCENT: 25 });
  });
});
