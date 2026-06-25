import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SuppliersRegistry } from './suppliers.registry';
import { SupplierConnector } from './supplier-connector.interface';

function fakeConnector(code: string): SupplierConnector {
  return {
    code,
    name: code,
    isConfigured: jest.fn(async () => true),
    search: jest.fn(),
    placeOrder: jest.fn(),
    getOrderStatus: jest.fn(),
    requestReturn: jest.fn(),
  } as unknown as SupplierConnector;
}

describe('SuppliersRegistry', () => {
  const rossko = fakeConnector('rossko');
  const emex = fakeConnector('emex');

  function makeRegistry(rows: any[]) {
    const service = {
      findAll: jest.fn(async () => rows),
      findByCode: jest.fn(async (code: string) => rows.find((r) => r.code === code) ?? null),
    };
    return new SuppliersRegistry([rossko, emex], service as any);
  }

  it('getActive returns only connectors whose row isActive', async () => {
    const reg = makeRegistry([
      { code: 'rossko', isActive: true },
      { code: 'emex', isActive: false },
    ]);
    const active = await reg.getActive();
    expect(active.map((c) => c.code)).toEqual(['rossko']);
  });

  it('getActive excludes connectors with no config row', async () => {
    const reg = makeRegistry([{ code: 'rossko', isActive: true }]);
    const active = await reg.getActive();
    expect(active.map((c) => c.code)).toEqual(['rossko']);
  });

  it('getByCode returns the active connector', async () => {
    const reg = makeRegistry([{ code: 'rossko', isActive: true }]);
    await expect(reg.getByCode('rossko')).resolves.toBe(rossko);
  });

  it('getByCode throws NotFoundException for unknown connector', async () => {
    const reg = makeRegistry([{ code: 'rossko', isActive: true }]);
    await expect(reg.getByCode('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getByCode throws BadRequestException for an inactive supplier', async () => {
    const reg = makeRegistry([{ code: 'emex', isActive: false }]);
    await expect(reg.getByCode('emex')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('getActive skips active-but-unconfigured connectors', async () => {
    const configured = { code: 'a', name: 'A', isConfigured: async () => true } as any;
    const unconfigured = { code: 'b', name: 'B', isConfigured: async () => false } as any;
    const suppliersService = {
      findAll: async () => [
        { code: 'a', isActive: true },
        { code: 'b', isActive: true },
      ],
    };
    const registry = new SuppliersRegistry([configured, unconfigured] as any, suppliersService as any);
    const active = await registry.getActive();
    expect(active.map((c: any) => c.code)).toEqual(['a']);
  });
});
