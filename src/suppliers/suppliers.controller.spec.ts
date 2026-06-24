import { SuppliersController } from './suppliers.controller';

describe('SuppliersController', () => {
  const service = {
    findAll: jest.fn(async () => [{ code: 'rossko' }]),
    update: jest.fn(async (code: string, dto: any) => ({ code, ...dto })),
  };
  const controller = new SuppliersController(service as any);

  it('GET list delegates to service.findAll', async () => {
    await expect(controller.findAll()).resolves.toEqual([{ code: 'rossko' }]);
    expect(service.findAll).toHaveBeenCalled();
  });

  it('PATCH delegates to service.update with code + dto', async () => {
    const dto = { isActive: false, markupPercent: 12 };
    await expect(controller.update('rossko', dto)).resolves.toEqual({
      code: 'rossko',
      isActive: false,
      markupPercent: 12,
    });
    expect(service.update).toHaveBeenCalledWith('rossko', dto);
  });
});
