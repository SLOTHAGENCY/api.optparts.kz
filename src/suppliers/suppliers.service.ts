import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from './entities/supplier.entity';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CryptoService } from '../common/crypto.service';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly repo: Repository<Supplier>,
    private readonly crypto: CryptoService,
  ) {}

  async findAll(): Promise<Supplier[]> {
    const rows = await this.repo.find();
    return rows.map((s) => ({ ...s, secretsEnc: s.secretsEnc ? '***' : null }));
  }

  findByCode(code: string): Promise<Supplier | null> {
    return this.repo.findOne({ where: { code } });
  }

  async getSecrets(code: string): Promise<Record<string, string>> {
    const supplier = await this.findByCode(code);
    if (!supplier?.secretsEnc) return {};
    try {
      return JSON.parse(this.crypto.decrypt(supplier.secretsEnc));
    } catch {
      return {};
    }
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
    if (dto.timeoutMs !== undefined) supplier.timeoutMs = dto.timeoutMs;
    if (dto.rateLimitRpm !== undefined) supplier.rateLimitRpm = dto.rateLimitRpm;
    if (dto.apiUrl !== undefined) {
      supplier.config = { ...(supplier.config ?? {}), API_URL: dto.apiUrl };
    }
    if (dto.secrets !== undefined) {
      supplier.secretsEnc = this.crypto.encrypt(JSON.stringify(dto.secrets));
    }
    return this.repo.save(supplier);
  }
}
