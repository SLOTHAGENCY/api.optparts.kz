import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Address } from './entities/address.entity';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class AddressesService {
  constructor(
    @InjectRepository(Address)
    private readonly repo: Repository<Address>,
  ) {}

  findAllByUser(userId: string): Promise<Address[]> {
    return this.repo.find({ where: { userId }, order: { main: 'DESC', createdAt: 'ASC' } });
  }

  async findOne(id: string, userId: string): Promise<Address> {
    const address = await this.repo.findOne({ where: { id } });
    if (!address) throw new NotFoundException('Address not found.');
    if (address.userId !== userId) throw new ForbiddenException('Access denied.');
    return address;
  }

  async create(userId: string, dto: CreateAddressDto): Promise<Address> {
    if (dto.main) {
      await this.unsetMain(userId);
    }
    const address = this.repo.create({ ...dto, userId });
    return this.repo.save(address);
  }

  async update(id: string, userId: string, dto: UpdateAddressDto): Promise<Address> {
    const address = await this.findOne(id, userId);
    if (dto.main === true) {
      await this.unsetMain(userId);
    }
    Object.assign(address, dto);
    return this.repo.save(address);
  }

  async setMain(id: string, userId: string): Promise<Address> {
    const address = await this.findOne(id, userId);
    await this.unsetMain(userId);
    address.main = true;
    return this.repo.save(address);
  }

  async delete(id: string, userId: string): Promise<void> {
    const address = await this.findOne(id, userId);
    await this.repo.remove(address);
  }

  /** Unsets main on all user addresses */
  private async unsetMain(userId: string): Promise<void> {
    await this.repo.update({ userId, main: true }, { main: false });
  }
}