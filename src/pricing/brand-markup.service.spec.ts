import { BrandMarkupService } from './brand-markup.service';

function make(rows: any[] = []) {
  const repo = {
    find: jest.fn(async () => rows),
    findOne: jest.fn(async ({ where: { brand } }: any) =>
      rows.find((r) => r.brand === brand) ?? null),
    save: jest.fn(async (r: any) => r),
    delete: jest.fn(async () => ({ affected: 1 })),
  };
  return { svc: new BrandMarkupService(repo as any), repo };
}

describe('BrandMarkupService', () => {
  it('findPercentByBrand normalizes case and trim', async () => {
    const { svc } = make([{ brand: 'BOSCH', markupPercent: 25 }]);
    expect(await svc.findPercentByBrand('  bosch ')).toBe(25);
  });

  it('findPercentByBrand returns null when no row', async () => {
    const { svc } = make([]);
    expect(await svc.findPercentByBrand('MANN')).toBeNull();
  });

  it('upsert stores brand uppercased', async () => {
    const { svc, repo } = make([]);
    await svc.upsert(' bosch ', 25);
    expect(repo.save).toHaveBeenCalledWith({ brand: 'BOSCH', markupPercent: 25 });
  });
});
