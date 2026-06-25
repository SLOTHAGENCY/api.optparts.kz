import { NotFoundException } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';

function make(supplier: any) {
  const repo = {
    findOne: jest.fn(async () => supplier),
    find: jest.fn(async () => [supplier]),
    save: jest.fn(async (s: any) => s),
  };
  const crypto = {
    encrypt: jest.fn((s: string) => `enc(${s})`),
    decrypt: jest.fn((s: string) => s.replace(/^enc\(|\)$/g, '')),
  };
  return { svc: new SuppliersService(repo as any, crypto as any), repo, crypto };
}

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

const makeCrypto = () => ({
  encrypt: jest.fn((s: string) => `enc(${s})`),
  decrypt: jest.fn((s: string) => s.replace(/^enc\(|\)$/g, '')),
});

describe('SuppliersService', () => {
  it('findAll returns all rows', async () => {
    const repo = makeRepoMock([{ code: 'rossko', secretsEnc: null }]);
    const service = new SuppliersService(repo as any, makeCrypto() as any);
    await expect(service.findAll()).resolves.toHaveLength(1);
  });

  it('findByCode returns the matching row or null', async () => {
    const repo = makeRepoMock([{ code: 'rossko' }]);
    const service = new SuppliersService(repo as any, makeCrypto() as any);
    await expect(service.findByCode('rossko')).resolves.toEqual({ code: 'rossko' });
    await expect(service.findByCode('nope')).resolves.toBeNull();
  });

  it('update mutates fields and saves', async () => {
    const repo = makeRepoMock([
      { code: 'rossko', isActive: true, markupPercent: null, config: {} },
    ]);
    const service = new SuppliersService(repo as any, makeCrypto() as any);
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
    const service = new SuppliersService(repo as any, makeCrypto() as any);
    await expect(service.update('ghost', { isActive: false })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('SuppliersService secrets & config', () => {
  it('encrypts secrets on update and stores apiUrl in config', async () => {
    const supplier: any = { code: 'tabys', config: {}, secretsEnc: null };
    const { svc, repo, crypto } = make(supplier);
    const saved = await svc.update('tabys', { apiUrl: 'https://x', secrets: { API_KEY: 'k' } } as any);
    expect(crypto.encrypt).toHaveBeenCalledWith(JSON.stringify({ API_KEY: 'k' }));
    // HTTP response must be masked, not the raw ciphertext
    expect(saved.secretsEnc).toBe('***');
    // The real ciphertext must have been persisted to the repo
    expect(repo.save.mock.calls[0][0].secretsEnc).toBe('enc({"API_KEY":"k"})');
    expect(saved.config).toEqual({ API_URL: 'https://x' });
  });

  it('getSecrets decrypts, empty when unset', async () => {
    const { svc } = make({ code: 'tabys', secretsEnc: 'enc({"API_KEY":"k"})' });
    expect(await svc.getSecrets('tabys')).toEqual({ API_KEY: 'k' });
    const empty = make({ code: 'tabys', secretsEnc: null });
    expect(await empty.svc.getSecrets('tabys')).toEqual({});
  });

  it('update masks secretsEnc in the returned object but repo keeps real ciphertext', async () => {
    const supplier: any = { code: 'tabys', config: {}, secretsEnc: null };
    const { svc, repo, crypto } = make(supplier);
    const result = await svc.update('tabys', { secrets: { API_KEY: 'secret' } } as any);
    // HTTP response must NOT expose the real ciphertext
    expect(result.secretsEnc).toBe('***');
    // The object handed to repo.save must carry the real ciphertext
    const savedArg = repo.save.mock.calls[0][0];
    expect(savedArg.secretsEnc).toBe('enc({"API_KEY":"secret"})');
    // getSecrets must still decrypt correctly (DB row is untouched)
    crypto.decrypt.mockImplementation((s: string) => s.replace(/^enc\(|\)$/g, ''));
    expect(await svc.getSecrets('tabys')).toEqual({ API_KEY: 'secret' });
  });

  it('update returns secretsEnc === null (masked) when no secrets were set', async () => {
    const supplier: any = { code: 'tabys', config: {}, secretsEnc: null };
    const { svc } = make(supplier);
    const result = await svc.update('tabys', { isActive: true } as any);
    expect(result.secretsEnc).toBeNull();
  });
});
