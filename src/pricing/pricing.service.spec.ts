import { PricingService } from './pricing.service';

function make(opts: {
  supplier?: { markupPercent?: number | null; currency?: string | null };
  rates?: Record<string, number>;
  buffer?: number;
  defaultMarkup?: number;
} = {}) {
  const suppliersService = {
    findByCode: jest.fn(async () => opts.supplier ?? { markupPercent: null, currency: null }),
  };
  const settings = {
    getFxRates: jest.fn(async () => opts.rates ?? { KZT: 1 }),
    getFxBufferPercent: jest.fn(async () => opts.buffer ?? 0),
    getDefaultMarkup: jest.fn(async () => opts.defaultMarkup ?? 20),
  };
  return new PricingService(suppliersService as any, settings as any);
}

describe('PricingService.applyMarkup', () => {
  it('KZT cost, default markup 20%', async () => {
    const p = make();
    expect(await p.applyMarkup(1000, 'x', 'KZT')).toBe(1200);
  });

  it('converts RUB to KZT (rate) then applies markup', async () => {
    const p = make({ rates: { RUB: 5, KZT: 1 }, supplier: { markupPercent: 10, currency: null } });
    // 100 RUB * 5 = 500 KZT; +10% = 550
    expect(await p.applyMarkup(100, 'x', 'RUB')).toBe(550);
  });

  it('applies FX buffer before markup', async () => {
    const p = make({ rates: { RUB: 5, KZT: 1 }, buffer: 10, supplier: { markupPercent: 0, currency: null } });
    // 100 * 5 * 1.10 = 550; +0% = 550
    expect(await p.applyMarkup(100, 'x', 'RUB')).toBe(550);
  });

  it('supplier currency override beats the offer currency', async () => {
    const p = make({ rates: { RUB: 5, KZT: 1 }, supplier: { markupPercent: 0, currency: 'RUB' } });
    expect(await p.applyMarkup(100, 'x', 'KZT')).toBe(500); // forced RUB
  });

  it('unknown currency falls back to rate 1', async () => {
    const p = make({ rates: { KZT: 1 }, supplier: { markupPercent: 0, currency: null } });
    expect(await p.applyMarkup(100, 'x', 'EUR')).toBe(100);
  });
});
