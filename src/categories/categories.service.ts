import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Category } from './entities/category.entity';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

const MAX_LEVEL = 3;

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly repo: Repository<Category>,
  ) {}

  /** Returns only root categories — children nested inside via eager loading */
  findTree(): Promise<Category[]> {
    return this.repo.find({ where: { parentId: IsNull() } });
  }

  findAll(): Promise<Category[]> {
    return this.repo.find();
  }

  async findById(id: string): Promise<Category> {
    const cat = await this.repo.findOne({ where: { id } });
    if (!cat) throw new NotFoundException('Category not found.');
    return cat;
  }

  async create(dto: CreateCategoryDto): Promise<Category> {
    let level = 1;

    if (dto.parentId) {
      const parent = await this.findById(dto.parentId);
      level = parent.level + 1;

      if (level > MAX_LEVEL) {
        throw new BadRequestException(
          `Maximum category depth is ${MAX_LEVEL} levels. ` +
          `Parent is already at level ${parent.level}.`,
        );
      }
    }

    const category = this.repo.create({ ...dto, level });
    return this.repo.save(category);
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    const category = await this.findById(id);

    if (dto.parentId && dto.parentId !== category.parentId) {
      const parent = await this.findById(dto.parentId);
      const newLevel = parent.level + 1;

      if (newLevel > MAX_LEVEL) {
        throw new BadRequestException(
          `Maximum category depth is ${MAX_LEVEL} levels. ` +
          `Parent is already at level ${parent.level}.`,
        );
      }

      // Prevent circular reference
      if (dto.parentId === id) {
        throw new BadRequestException('A category cannot be its own parent.');
      }

      category.level = newLevel;
    }

    Object.assign(category, dto);
    return this.repo.save(category);
  }

  async delete(id: string): Promise<void> {
    const category = await this.findById(id);
    await this.repo.remove(category);
  }
}