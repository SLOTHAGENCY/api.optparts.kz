import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly repo: Repository<Product>,
  ) {}

  findAll(): Promise<Product[]> {
    return this.repo.find();
  }

  async findById(id: string): Promise<Product> {
    const product = await this.repo.findOne({ where: { id } });
    if (!product) throw new NotFoundException('Product not found.');
    return product;
  }

  create(dto: CreateProductDto): Promise<Product> {
    const product = this.repo.create({ ...dto, images: [] });
    return this.repo.save(product);
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const product = await this.findById(id);
    Object.assign(product, dto);
    return this.repo.save(product);
  }

  async addImage(id: string, filename: string): Promise<Product> {
    const product = await this.findById(id);
    product.images = [...(product.images ?? []).filter(Boolean), filename];
    return this.repo.save(product);
  }

  async removeImage(id: string, filename: string): Promise<Product> {
    const product = await this.findById(id);
    product.images = product.images.filter((img) => img !== filename);
    return this.repo.save(product);
  }

  async delete(id: string): Promise<void> {
    const product = await this.findById(id);
    await this.repo.remove(product);
  }
}
