import { SettingsService } from './settings.service';

function makeService(rows: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(rows));
  const repo = {
    find: jest.fn(async () => [...store].map(([key, value]) => ({ key, value }))),
    save: jest.fn(async (e: any) => { store.set(e.key, e.value); return e; }),
  };
  return { service: new SettingsService(repo as any), repo, store };
}

describe('SettingsService', () => {
  it('returns defaults when nothing stored', async () => {
    const { service } = makeService();
    expect(await service.getDefaultMarkup()).toBe(20);
    expect(await service.getFxRates()).toEqual({ KZT: 1 });
    expect(await service.getFxBufferPercent()).toBe(0);
  });

  it('reads stored values', async () => {
    const { service } = makeService({
      DEFAULT_MARKUP_PERCENT: 30,
      FX_RATES: { RUB: 5.4, KZT: 1 },
      FX_BUFFER_PERCENT: 2,
    });
    expect(await service.getDefaultMarkup()).toBe(30);
    expect((await service.getFxRates()).RUB).toBe(5.4);
    expect(await service.getFxBufferPercent()).toBe(2);
  });

  it('getDeliveryBufferDays defaults to 0 and reads stored value', async () => {
    const { service } = makeService();
    expect(await service.getDeliveryBufferDays()).toBe(0);
    const { service: s2 } = makeService({ DELIVERY_BUFFER_DAYS: 3 });
    expect(await s2.getDeliveryBufferDays()).toBe(3);
  });

  it('update writes rows and invalidates cache', async () => {
    const { service, repo } = makeService();
    await service.update({ DEFAULT_MARKUP_PERCENT: 25 });
    expect(repo.save).toHaveBeenCalled();
    expect(await service.getDefaultMarkup()).toBe(25);
  });
});
