import { MonitoringService } from './monitoring.service';

function makeRepo(raw: { cnt: string; queried: string; failed: string }) {
  const qb: any = {
    select: jest.fn(() => qb),
    addSelect: jest.fn(() => qb),
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    getRawOne: jest.fn(async () => raw),
  };
  return { createQueryBuilder: jest.fn(() => qb) } as any;
}

function makeConnector(code: string, name: string, configured: boolean | Error) {
  return {
    code,
    name,
    isConfigured: jest.fn(async () => {
      if (configured instanceof Error) throw configured;
      return configured;
    }),
  } as any;
}

describe('MonitoringService', () => {
  it('maps connector statuses (online / disabled / misconfigured) and sorts by code', async () => {
    const connectors = [
      makeConnector('tabys', 'Tabys', true),   // active + configured -> online
      makeConnector('rossko', 'Rossko', true), // active but no row -> disabled
      makeConnector('shatem', 'ShateM', false),// active + !configured -> misconfigured
    ];
    const suppliersService = {
      findAll: jest.fn(async () => [
        { code: 'tabys', isActive: true },
        { code: 'shatem', isActive: true },
        // 'rossko' intentionally absent -> defaults to inactive
      ]),
    } as any;
    const repo = makeRepo({ cnt: '0', queried: '0', failed: '0' });

    const svc = new MonitoringService(connectors, suppliersService, repo);
    const res = await svc.getMonitoring();

    expect(res.connectors.map((c) => c.code)).toEqual(['rossko', 'shatem', 'tabys']);
    const byCode = Object.fromEntries(res.connectors.map((c) => [c.code, c.status]));
    expect(byCode).toEqual({ tabys: 'online', shatem: 'misconfigured', rossko: 'disabled' });
  });

  it('computes successRate from search_log window', async () => {
    const connectors = [makeConnector('tabys', 'Tabys', true)];
    const suppliersService = {
      findAll: jest.fn(async () => [{ code: 'tabys', isActive: true }]),
    } as any;
    const repo = makeRepo({ cnt: '128', queried: '250', failed: '12' });

    const svc = new MonitoringService(connectors, suppliersService, repo);
    const res = await svc.getMonitoring();

    expect(res.stats.windowHours).toBe(24);
    expect(res.stats.searchCount).toBe(128);
    expect(res.stats.suppliersQueriedTotal).toBe(250);
    expect(res.stats.suppliersFailedTotal).toBe(12);
    expect(res.stats.successRate).toBe(0.952);
    expect(new Date(res.generatedAt).toISOString()).toBe(res.generatedAt);
  });

  it('successRate is 1 when no suppliers were queried', async () => {
    const connectors = [makeConnector('tabys', 'Tabys', true)];
    const suppliersService = { findAll: jest.fn(async () => [{ code: 'tabys', isActive: true }]) } as any;
    const repo = makeRepo({ cnt: '0', queried: '0', failed: '0' });

    const svc = new MonitoringService(connectors, suppliersService, repo);
    const res = await svc.getMonitoring();

    expect(res.stats.successRate).toBe(1);
    expect(res.stats.searchCount).toBe(0);
  });

  it('treats a throwing isConfigured() as not configured', async () => {
    const connectors = [makeConnector('tabys', 'Tabys', new Error('boom'))];
    const suppliersService = { findAll: jest.fn(async () => [{ code: 'tabys', isActive: true }]) } as any;
    const repo = makeRepo({ cnt: '0', queried: '0', failed: '0' });

    const svc = new MonitoringService(connectors, suppliersService, repo);
    const res = await svc.getMonitoring();

    expect(res.connectors[0].isConfigured).toBe(false);
    expect(res.connectors[0].status).toBe('misconfigured');
  });
});
