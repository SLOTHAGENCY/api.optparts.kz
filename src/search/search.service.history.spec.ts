import { SearchService } from './search.service';
import { UserRole } from '../users/entities/user.entity';

function makeService(rows: any[]) {
  const repo = {
    findAndCount: jest.fn(async ({ where, skip, take }: any) => {
      const filtered = where?.userId
        ? rows.filter((r) => r.userId === where.userId)
        : rows;
      return [filtered.slice(skip, skip + take), filtered.length];
    }),
  };
  const service = new SearchService({} as any, {} as any, repo as any);
  return { service, repo };
}

const user = (id: string, roles: UserRole[]) => ({ id, roles } as any);

describe('SearchService.history', () => {
  const rows = [
    { id: '1', userId: 'u1', article: 'A' },
    { id: '2', userId: 'u2', article: 'B' },
    { id: '3', userId: 'u1', article: 'C' },
  ];

  it('returns only the current user rows for a plain user', async () => {
    const { service } = makeService(rows);
    const res = await service.history(user('u1', [UserRole.USER]), {});
    expect(res.total).toBe(2);
    expect(res.items.every((r) => r.userId === 'u1')).toBe(true);
    expect(res.page).toBe(1);
    expect(res.limit).toBe(20);
  });

  it('returns all rows for a MANAGER', async () => {
    const { service } = makeService(rows);
    const res = await service.history(user('mgr', [UserRole.MANAGER]), {});
    expect(res.total).toBe(3);
  });

  it('applies pagination (page/limit) with skip/take', async () => {
    const { service, repo } = makeService(rows);
    const res = await service.history(user('adm', [UserRole.ADMIN]), { page: 2, limit: 1 });
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 1, take: 1, order: { createdAt: 'DESC' } }),
    );
    expect(res.page).toBe(2);
    expect(res.limit).toBe(1);
    expect(res.items).toHaveLength(1);
  });
});
