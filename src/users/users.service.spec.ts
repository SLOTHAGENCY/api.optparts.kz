import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserRole } from './entities/user.entity';

function make(rows: any[] = []) {
  const repo = {
    find: jest.fn(async () => rows),
    findOne: jest.fn(async ({ where: { id } }: any) =>
      rows.find((r) => r.id === id) ?? null),
    save: jest.fn(async (r: any) => r),
    create: jest.fn((data: any) => ({ ...data })),
  };
  return { svc: new UsersService(repo as any), repo };
}

describe('UsersService.update', () => {
  it('persists phones alongside other profile fields', async () => {
    const { svc, repo } = make([
      { id: 'u1', email: 'a@a.com', firstName: 'A', lastName: 'B', phones: [] },
    ]);
    const updated = await svc.update('u1', { phones: ['+7 700 123 45 67'] });
    expect(updated.phones).toEqual(['+7 700 123 45 67']);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ phones: ['+7 700 123 45 67'] }),
    );
  });

  it('merges phones with other updated fields, leaving the rest untouched', async () => {
    const { svc } = make([
      { id: 'u1', email: 'a@a.com', firstName: 'A', lastName: 'B', phones: ['+77001112233'] },
    ]);
    const updated = await svc.update('u1', {
      firstName: 'New',
      phones: ['+77001112233', '+77009998877'],
    });
    expect(updated.firstName).toBe('New');
    expect(updated.lastName).toBe('B');
    expect(updated.phones).toEqual(['+77001112233', '+77009998877']);
  });

  it('throws NotFoundException for an unknown user', async () => {
    const { svc } = make([]);
    await expect(svc.update('missing', { phones: [] })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('UsersService.create', () => {
  it('defaults roles to USER when not provided', async () => {
    const { svc } = make([]);
    const user = await svc.create({
      email: 'a@a.com',
      password: 'pw',
      firstName: 'A',
      lastName: 'B',
    });
    expect(user.roles).toEqual([UserRole.USER]);
  });
});
