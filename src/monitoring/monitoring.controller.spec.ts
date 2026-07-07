import { MonitoringController } from './monitoring.controller';

describe('MonitoringController', () => {
  const payload = {
    connectors: [{ code: 'tabys', name: 'Tabys', isActive: true, isConfigured: true, status: 'online' }],
    stats: { windowHours: 24, searchCount: 0, suppliersQueriedTotal: 0, suppliersFailedTotal: 0, successRate: 1 },
    generatedAt: '2026-07-03T12:00:00.000Z',
  };
  const service = { getMonitoring: jest.fn(async () => payload) };
  const controller = new MonitoringController(service as any);

  it('GET delegates to service.getMonitoring', async () => {
    await expect(controller.getMonitoring()).resolves.toEqual(payload);
    expect(service.getMonitoring).toHaveBeenCalled();
  });
});
