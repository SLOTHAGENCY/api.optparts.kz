import { NotFoundException } from '@nestjs/common';
import { NewsService } from './news.service';

function make(rows: any[] = []) {
  const repo = {
    find: jest.fn(async () => rows),
    findOne: jest.fn(async ({ where: { id } }: any) => rows.find((r) => r.id === id) ?? null),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (r: any) => ({ id: r.id ?? 'generated-id', ...r })),
    delete: jest.fn(async (id: string) => ({ affected: rows.some((r) => r.id === id) ? 1 : 0 })),
  };
  return { svc: new NewsService(repo as any), repo };
}

describe('NewsService', () => {
  it('findAll sorts by publishedAt DESC', async () => {
    const { svc, repo } = make([{ id: '1' }]);
    await svc.findAll();
    expect(repo.find).toHaveBeenCalledWith({ order: { publishedAt: 'DESC' } });
  });

  it('findOne throws NotFoundException when missing', async () => {
    const { svc } = make([]);
    await expect(svc.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findOne returns the row when present', async () => {
    const { svc } = make([{ id: 'a', title: 'T' }]);
    expect(await svc.findOne('a')).toEqual({ id: 'a', title: 'T' });
  });

  it('create defaults publishedAt to now() when omitted', async () => {
    const { svc, repo } = make([]);
    const before = Date.now();
    const res = await svc.create({ title: 'X', body: 'B' } as any);
    const after = Date.now();
    const savedArg = repo.save.mock.calls[0][0];
    expect(savedArg.publishedAt).toBeInstanceOf(Date);
    expect(savedArg.publishedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(savedArg.publishedAt.getTime()).toBeLessThanOrEqual(after);
    expect(res.title).toBe('X');
  });

  it('create uses provided publishedAt (ISO string -> Date)', async () => {
    const { svc, repo } = make([]);
    await svc.create({ title: 'X', body: 'B', publishedAt: '2026-01-01T00:00:00.000Z' } as any);
    const savedArg = repo.save.mock.calls[0][0];
    expect(savedArg.publishedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('create defaults coverImage to null when omitted', async () => {
    const { svc, repo } = make([]);
    await svc.create({ title: 'X', body: 'B' } as any);
    expect(repo.save.mock.calls[0][0].coverImage).toBeNull();
  });

  it('update throws NotFoundException when missing', async () => {
    const { svc } = make([]);
    await expect(svc.update('nope', { title: 'Y' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update merges only provided fields', async () => {
    const { svc, repo } = make([{ id: 'a', title: 'Old', body: 'B', coverImage: null }]);
    await svc.update('a', { title: 'New' });
    const savedArg = repo.save.mock.calls[0][0];
    expect(savedArg.title).toBe('New');
    expect(savedArg.body).toBe('B');
  });

  it('remove throws NotFoundException when nothing deleted', async () => {
    const { svc } = make([]);
    await expect(svc.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove resolves when a row is deleted', async () => {
    const { svc } = make([{ id: 'a' }]);
    await expect(svc.remove('a')).resolves.toBeUndefined();
  });
});
