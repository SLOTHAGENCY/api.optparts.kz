import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { GarageService } from './garage.service';
import { Vehicle } from './entities/vehicle.entity';

function makeVehicle(partial: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'v1',
    vin: 'JHME5000000000001',
    make: null,
    model: null,
    year: null,
    trim: null,
    main: false,
    userId: 'u1',
    user: undefined as any,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...partial,
  };
}

function makeService(seed: Vehicle[] = []) {
  const store = [...seed];
  const repo = {
    find: jest.fn(async ({ where }: any) =>
      store.filter((v) => v.userId === where.userId),
    ),
    findOne: jest.fn(async ({ where }: any) => {
      if (where.id) return store.find((v) => v.id === where.id) ?? null;
      if (where.userId && where.vin) {
        return store.find((v) => v.userId === where.userId && v.vin === where.vin) ?? null;
      }
      return null;
    }),
    create: jest.fn((d: any) => makeVehicle({ id: 'new', ...d })),
    save: jest.fn(async (v: Vehicle) => {
      const idx = store.findIndex((s) => s.id === v.id);
      if (idx >= 0) store[idx] = v;
      else store.push(v);
      return v;
    }),
    remove: jest.fn(async (v: Vehicle) => {
      const idx = store.findIndex((s) => s.id === v.id);
      if (idx >= 0) store.splice(idx, 1);
      return v;
    }),
    update: jest.fn(async (criteria: any, patch: any) => {
      store
        .filter((v) => v.userId === criteria.userId && v.main === criteria.main)
        .forEach((v) => Object.assign(v, patch));
      return { affected: 0 };
    }),
  };
  const service = new GarageService(repo as any);
  return { service, repo, store };
}

describe('GarageService', () => {
  it('normalizes VIN to trimmed uppercase on create', async () => {
    const { service } = makeService();
    const created = await service.create('u1', { vin: '  jhmes000000000abc ' });
    expect(created.vin).toBe('JHMES000000000ABC');
  });

  it('rejects a duplicate VIN for the same user with 409', async () => {
    const { service } = makeService([makeVehicle({ vin: 'JHMES000000000ABC' })]);
    await expect(
      service.create('u1', { vin: 'jhmes000000000abc' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows the same VIN for a different user', async () => {
    const { service } = makeService([makeVehicle({ vin: 'JHMES000000000ABC', userId: 'u2' })]);
    const created = await service.create('u1', { vin: 'JHMES000000000ABC' });
    expect(created.userId).toBe('u1');
  });

  it('unsets other mains when creating a main vehicle', async () => {
    const { service, store } = makeService([makeVehicle({ id: 'v1', main: true })]);
    await service.create('u1', { vin: 'NEWVIN0000001', main: true });
    expect(store.find((v) => v.id === 'v1')!.main).toBe(false);
  });

  it('findOne throws 404 when missing', async () => {
    const { service } = makeService();
    await expect(service.findOne('nope', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findOne throws 403 when owned by another user', async () => {
    const { service } = makeService([makeVehicle({ id: 'v1', userId: 'u2' })]);
    await expect(service.findOne('v1', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('setMain unsets others and sets the target', async () => {
    const { service, store } = makeService([
      makeVehicle({ id: 'v1', main: true }),
      makeVehicle({ id: 'v2', vin: 'SECONDVIN0001', main: false }),
    ]);
    const result = await service.setMain('v2', 'u1');
    expect(result.main).toBe(true);
    expect(store.find((v) => v.id === 'v1')!.main).toBe(false);
  });

  it('delete removes an owned vehicle', async () => {
    const { service, store } = makeService([makeVehicle({ id: 'v1' })]);
    await service.delete('v1', 'u1');
    expect(store).toHaveLength(0);
  });

  it('rejects updating a vehicle VIN to match another vehicle of the same user', async () => {
    const { service } = makeService([
      makeVehicle({ id: 'v1', vin: 'JHMES000000000ABC' }),
      makeVehicle({ id: 'v2', vin: 'SECONDVIN0001' }),
    ]);
    await expect(
      service.update('v2', 'u1', { vin: 'jhmes000000000abc' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows updating a vehicle keeping its own VIN or changing other fields', async () => {
    const { service } = makeService([
      makeVehicle({ id: 'v1', vin: 'JHMES000000000ABC' }),
    ]);
    const result = await service.update('v1', 'u1', { vin: 'jhmes000000000abc', model: 'Civic' });
    expect(result.vin).toBe('JHMES000000000ABC');
    expect(result.model).toBe('Civic');
  });
});
