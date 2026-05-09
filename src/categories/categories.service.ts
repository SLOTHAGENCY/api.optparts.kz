import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './entities/category.entity';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(@InjectRepository(Category) private readonly repo: Repository<Category>) {}

  findAll(): Promise<Category[]> { return this.repo.find(); }

  async findById(id: string): Promise<Category> {
    const cat = await this.repo.findOne({ where: { id } });
    if (!cat) throw new NotFoundException('Category not found.');
    return cat;
  }

  create(dto: CreateCategoryDto): Promise<Category> {
    return this.repo.save(this.repo.create(dto));
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    const cat = await this.findById(id);
    Object.assign(cat, dto);
    return this.repo.save(cat);
  }

  async delete(id: string): Promise<void> {
    await this.repo.remove(await this.findById(id));
  }
}