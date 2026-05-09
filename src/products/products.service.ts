import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { Product } from './entities/product.entity';
import { ProductImage } from './entities/product-image.entity';
import { ProductProperty } from './entities/product-property.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product) private readonly repo: Repository<Product>,
    @InjectRepository(ProductImage) private readonly imageRepo: Repository<ProductImage>,
    @InjectRepository(ProductProperty) private readonly propRepo: Repository<ProductProperty>,
  ) {}

  findAll(): Promise<Product[]> { return this.repo.find(); }

  async findById(id: string): Promise<Product> {
    const product = await this.repo.findOne({ where: { id } });
    if (!product) throw new NotFoundException('Product not found.');
    return product;
  }

  create(dto: CreateProductDto): Promise<Product> {
    return this.repo.save(this.repo.create({ ...dto, images: [], properties: [] }));
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const product = await this.findById(id);
    Object.assign(product, dto);
    return this.repo.save(product);
  }

  async addImage(productId: string, filename: string, order = 0): Promise<ProductImage> {
    await this.findById(productId);
    const filepath = `/uploads/products/${filename}`;
    const image = this.imageRepo.create({ productId, filepath, order });
    return this.imageRepo.save(image);
  }

  async removeImage(productId: string, imageId: string): Promise<void> {
    const image = await this.imageRepo.findOne({ where: { id: imageId, productId } });
    if (!image) throw new NotFoundException('Image not found.');
    // Delete file from disk
    try {
      const diskPath = join(process.cwd(), 'uploads', 'products', image.filepath.split('/').pop());
      await unlink(diskPath);
    } catch (_) { /* file may already be gone */ }
    await this.imageRepo.remove(image);
  }

  async addProperty(productId: string, key: string, value: string): Promise<ProductProperty> {
    await this.findById(productId);
    const prop = this.propRepo.create({ productId, key, value });
    return this.propRepo.save(prop);
  }

  async updateProperty(productId: string, propId: string, key: string, value: string): Promise<ProductProperty> {
    const prop = await this.propRepo.findOne({ where: { id: propId, productId } });
    if (!prop) throw new NotFoundException('Property not found.');
    Object.assign(prop, { key, value });
    return this.propRepo.save(prop);
  }

  async removeProperty(productId: string, propId: string): Promise<void> {
    const prop = await this.propRepo.findOne({ where: { id: propId, productId } });
    if (!prop) throw new NotFoundException('Property not found.');
    await this.propRepo.remove(prop);
  }

  async delete(id: string): Promise<void> {
    await this.repo.remove(await this.findById(id));
  }
}