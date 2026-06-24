import { PricingService } from './pricing.service';

function makeService(markupPercent: number | null | 'no-row') {
  const suppliersService = {
    findByCode: jest.fn(async () =>
      markupPercent === 'no-row' ? null : { code: 'rossko', markupPercent },
    ),
  };
  return new PricingService(suppliersService as any);
}

describe('PricingService.applyMarkup', () => {
  const OLD_ENV = process.env.DEFAULT_MARKUP_PERCENT;
  afterEach(() => {
    process.env.DEFAULT_MARKUP_PERCENT = OLD_ENV;
  });

  it('uses the partner markupPercent when set', async () => {
    const service = makeService(25);
    await expect(service.applyMarkup(1000, 'rossko')).resolves.toBe(1250);
  });

  it('falls back to DEFAULT_MARKUP_PERCENT when partner markup is null', async () => {
    process.env.DEFAULT_MARKUP_PERCENT = '20';
    const service = makeService(null);
    await expect(service.applyMarkup(1000, 'rossko')).resolves.toBe(1200);
  });

  it('falls back to DEFAULT_MARKUP_PERCENT when partner row is missing', async () => {
    process.env.DEFAULT_MARKUP_PERCENT = '10';
    const service = makeService('no-row');
    await expect(service.applyMarkup(1000, 'ghost')).resolves.toBe(1100);
  });

  it('defaults to 20 percent when env is unset', async () => {
    delete process.env.DEFAULT_MARKUP_PERCENT;
    const service = makeService(null);
    await expect(service.applyMarkup(1000, 'rossko')).resolves.toBe(1200);
  });

  it('rounds to the nearest whole tenge', async () => {
    const service = makeService(15);
    // 5200 * 1.15 = 5980 exactly; use a non-integer case:
    const svc = makeService(13);
    await expect(svc.applyMarkup(999, 'rossko')).resolves.toBe(1129); // 999*1.13 = 1128.87 -> 1129
  });
});
