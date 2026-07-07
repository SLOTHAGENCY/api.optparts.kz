import { AdminStatsController } from './admin-stats.controller';

describe('AdminStatsController', () => {
  it('delegates to AdminStatsService.getStats', async () => {
    const stats = { activeSuppliers: 8 } as any;
    const svc = { getStats: jest.fn(async () => stats) };
    const controller = new AdminStatsController(svc as any);
    await expect(controller.getStats()).resolves.toBe(stats);
    expect(svc.getStats).toHaveBeenCalled();
  });
});
