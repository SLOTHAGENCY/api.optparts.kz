import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BrandMarkup } from './entities/brand-markup.entity';

function normBrand(brand: string): string {
  return (brand ?? '').trim().toUpperCase();
}

@Injectable()
export class BrandMarkupService {
  constructor(
    @InjectRepository(BrandMarkup)
    private readonly repo: Repository<BrandMarkup>,
  ) {}

  findAll(): Promise<BrandMarkup[]> {
    return this.repo.find();
  }

  async findPercentByBrand(brand: string): Promise<number | null> {
    const row = await this.repo.findOne({ where: { brand: normBrand(brand) } });
    return row ? Number(row.markupPercent) : null;
  }

  async upsert(brand: string, markupPercent: number): Promise<BrandMarkup> {
    const key = normBrand(brand);
    const existing = await this.repo.findOne({ where: { brand: key } });
    if (existing) {
      existing.markupPercent = markupPercent;
      return this.repo.save(existing);
    }
    return this.repo.save({ brand: key, markupPercent } as BrandMarkup);
  }

  async remove(brand: string): Promise<void> {
    await this.repo.delete({ brand: normBrand(brand) });
  }
}
