import { PartnerProductsController } from './partner-products.controller';

describe('PartnerProductsController', () => {
  const service = {
    findMany: jest.fn(async () => ({ items: [], total: 0, page: 1, limit: 20 })),
  };
  const controller = new PartnerProductsController(service as any);

  it('GET delegates to service.findMany with the query', async () => {
    const query = { supplierCode: 'rossko', page: 1, limit: 20 } as any;
    await expect(controller.findMany(query)).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    expect(service.findMany).toHaveBeenCalledWith(query);
  });
});
