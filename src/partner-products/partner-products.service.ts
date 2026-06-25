import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { PartnerProduct } from './entities/partner-product.entity';
import { QueryPartnerProductsDto } from './dto/query-partner-products.dto';

export interface RecordOrderInput {
  supplierCode: string;
  article: string;
  brand: string;
  name: string;
  costPrice: number;
  sellPrice: number;
}

@Injectable()
export class PartnerProductsService {
  constructor(
    @InjectRepository(PartnerProduct)
    private readonly repo: Repository<PartnerProduct>,
  ) {}

  /** Upsert analytics catalog on checkout (Spec C §6). Not a source of price/search. */
  async recordOrder(input: RecordOrderInput): Promise<PartnerProduct> {
    const now = new Date();
    const existing = await this.repo.findOne({
      where: {
        supplierCode: input.supplierCode,
        article: input.article,
        brand: input.brand,
      },
    });

    if (existing) {
      existing.name = input.name;
      existing.lastSeenAt = now;
      existing.lastKnownCostPrice = input.costPrice;
      existing.lastKnownSellPrice = input.sellPrice;
      existing.timesOrdered = (existing.timesOrdered ?? 0) + 1;
      return this.repo.save(existing);
    }

    const row = this.repo.create({
      supplierCode: input.supplierCode,
      article: input.article,
      brand: input.brand,
      name: input.name,
      lastSeenAt: now,
      lastKnownCostPrice: input.costPrice,
      lastKnownSellPrice: input.sellPrice,
      timesOrdered: 1,
    });
    return this.repo.save(row);
  }

  async findMany(query: QueryPartnerProductsDto): Promise<{
    items: PartnerProduct[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: FindOptionsWhere<PartnerProduct> = {};
    if (query.supplierCode) where.supplierCode = query.supplierCode;
    if (query.article) where.article = query.article;

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { lastSeenAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total, page, limit };
  }
}
