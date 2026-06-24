import { PartnerProductsService } from './partner-products.service';

function makeRepoMock(initial: any[] = []) {
  const rows = [...initial];
  return {
    rows,
    findOne: jest.fn(async ({ where }: any) =>
      rows.find(
        (r) =>
          r.supplierCode === where.supplierCode &&
          r.article === where.article &&
          r.brand === where.brand,
      ) ?? null,
    ),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (row: any) => {
      if (!rows.includes(row)) rows.push(row);
      return row;
    }),
    findAndCount: jest.fn(async () => [rows, rows.length]),
  };
}

describe('PartnerProductsService', () => {
  const input = {
    supplierCode: 'rossko',
    article: 'A1',
    brand: 'BOSCH',
    name: 'Filter',
    costPrice: 5200,
    sellPrice: 6240,
  };

  it('inserts a new catalog row with timesOrdered=1', async () => {
    const repo = makeRepoMock([]);
    const service = new PartnerProductsService(repo as any);
    const row = await service.recordOrder(input);
    expect(row.timesOrdered).toBe(1);
    expect(row.lastKnownCostPrice).toBe(5200);
    expect(row.lastKnownSellPrice).toBe(6240);
    expect(repo.save).toHaveBeenCalled();
  });

  it('increments timesOrdered and refreshes prices on repeat order', async () => {
    const existing = {
      supplierCode: 'rossko',
      article: 'A1',
      brand: 'BOSCH',
      name: 'Filter',
      lastKnownCostPrice: 5000,
      lastKnownSellPrice: 6000,
      timesOrdered: 1,
      lastSeenAt: new Date('2020-01-01'),
    };
    const repo = makeRepoMock([existing]);
    const service = new PartnerProductsService(repo as any);
    const row = await service.recordOrder(input);
    expect(row.timesOrdered).toBe(2);
    expect(row.lastKnownSellPrice).toBe(6240);
  });

  it('findMany paginates and returns total', async () => {
    const repo = makeRepoMock([{ supplierCode: 'rossko' }]);
    const service = new PartnerProductsService(repo as any);
    const res = await service.findMany({ page: 1, limit: 20 } as any);
    expect(res.total).toBe(1);
    expect(res.page).toBe(1);
    expect(repo.findAndCount).toHaveBeenCalled();
  });
});
