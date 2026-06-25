import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from './entities/supplier.entity';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly repo: Repository<Supplier>,
  ) {}

  findAll(): Promise<Supplier[]> {
    return this.repo.find();
  }

  findByCode(code: string): Promise<Supplier | null> {
    return this.repo.findOne({ where: { code } });
  }

  async update(code: string, dto: UpdateSupplierDto): Promise<Supplier> {
    const supplier = await this.findByCode(code);
    if (!supplier) {
      throw new NotFoundException(`Supplier "${code}" not found.`);
    }
    if (dto.isActive !== undefined) supplier.isActive = dto.isActive;
    if (dto.markupPercent !== undefined) supplier.markupPercent = dto.markupPercent;
    if (dto.currency !== undefined) supplier.currency = dto.currency;
    if (dto.config !== undefined) supplier.config = dto.config;
    if (dto.deliveryBufferDays !== undefined) supplier.deliveryBufferDays = dto.deliveryBufferDays;
    return this.repo.save(supplier);
  }
}
