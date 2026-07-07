import {
  Injectable, NotFoundException, ForbiddenException, ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vehicle } from './entities/vehicle.entity';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';

@Injectable()
export class GarageService {
  constructor(
    @InjectRepository(Vehicle)
    private readonly repo: Repository<Vehicle>,
  ) {}

  private normalizeVin(vin: string): string {
    return vin.trim().toUpperCase();
  }

  findAllByUser(userId: string): Promise<Vehicle[]> {
    return this.repo.find({
      where: { userId },
      order: { main: 'DESC', createdAt: 'ASC' },
    });
  }

  async findOne(id: string, userId: string): Promise<Vehicle> {
    const vehicle = await this.repo.findOne({ where: { id } });
    if (!vehicle) throw new NotFoundException('Vehicle not found.');
    if (vehicle.userId !== userId) throw new ForbiddenException('Access denied.');
    return vehicle;
  }

  async create(userId: string, dto: CreateVehicleDto): Promise<Vehicle> {
    const vin = this.normalizeVin(dto.vin);
    const existing = await this.repo.findOne({ where: { userId, vin } });
    if (existing) throw new ConflictException('Это авто уже в гараже.');

    if (dto.main) {
      await this.unsetMain(userId);
    }
    const vehicle = this.repo.create({ ...dto, vin, userId });
    return this.repo.save(vehicle);
  }

  async update(id: string, userId: string, dto: UpdateVehicleDto): Promise<Vehicle> {
    const vehicle = await this.findOne(id, userId);
    if (dto.main === true) {
      await this.unsetMain(userId);
    }
    const patch: Partial<Vehicle> = { ...dto };
    if (dto.vin !== undefined) {
      const vin = this.normalizeVin(dto.vin);
      const existing = await this.repo.findOne({ where: { userId, vin } });
      if (existing && existing.id !== id) {
        throw new ConflictException('Это авто уже в гараже.');
      }
      patch.vin = vin;
    }
    Object.assign(vehicle, patch);
    return this.repo.save(vehicle);
  }

  async setMain(id: string, userId: string): Promise<Vehicle> {
    const vehicle = await this.findOne(id, userId);
    await this.unsetMain(userId);
    vehicle.main = true;
    return this.repo.save(vehicle);
  }

  async delete(id: string, userId: string): Promise<void> {
    const vehicle = await this.findOne(id, userId);
    await this.repo.remove(vehicle);
  }

  private async unsetMain(userId: string): Promise<void> {
    await this.repo.update({ userId, main: true }, { main: false });
  }
}
