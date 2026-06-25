import { NotFoundException } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';

function makeRepoMock(initial: any[] = []) {
  const rows = [...initial];
  return {
    rows,
    find: jest.fn(async () => rows),
    findOne: jest.fn(async ({ where: { code } }: any) =>
      rows.find((r) => r.code === code) ?? null,
    ),
    save: jest.fn(async (row: any) => row),
  };
}

describe('SuppliersService', () => {
  it('findAll returns all rows', async () => {
    const repo = makeRepoMock([{ code: 'rossko' }]);
    const service = new SuppliersService(repo as any);
    await expect(service.findAll()).resolves.toHaveLength(1);
  });

  it('findByCode returns the matching row or null', async () => {
    const repo = makeRepoMock([{ code: 'rossko' }]);
    const service = new SuppliersService(repo as any);
    await expect(service.findByCode('rossko')).resolves.toEqual({ code: 'rossko' });
    await expect(service.findByCode('nope')).resolves.toBeNull();
  });

  it('update mutates fields and saves', async () => {
    const repo = makeRepoMock([
      { code: 'rossko', isActive: true, markupPercent: null, config: {} },
    ]);
    const service = new SuppliersService(repo as any);
    const updated = await service.update('rossko', {
      isActive: false,
      markupPercent: 15,
    });
    expect(updated.isActive).toBe(false);
    expect(updated.markupPercent).toBe(15);
    expect(repo.save).toHaveBeenCalled();
  });

  it('update throws NotFoundException for unknown code', async () => {
    const repo = makeRepoMock([]);
    const service = new SuppliersService(repo as any);
    await expect(service.update('ghost', { isActive: false })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
