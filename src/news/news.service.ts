import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { News } from './entities/news.entity';
import { CreateNewsDto } from './dto/create-news.dto';
import { UpdateNewsDto } from './dto/update-news.dto';

@Injectable()
export class NewsService {
  constructor(
    @InjectRepository(News)
    private readonly repo: Repository<News>,
  ) {}

  findAll(): Promise<News[]> {
    return this.repo.find({ order: { publishedAt: 'DESC' } });
  }

  async findOne(id: string): Promise<News> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('News item not found.');
    return row;
  }

  create(dto: CreateNewsDto): Promise<News> {
    const entity = this.repo.create({
      title: dto.title,
      body: dto.body,
      coverImage: dto.coverImage ?? null,
      publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : new Date(),
    });
    return this.repo.save(entity);
  }

  async update(id: string, dto: UpdateNewsDto): Promise<News> {
    const row = await this.findOne(id);
    if (dto.title !== undefined) row.title = dto.title;
    if (dto.body !== undefined) row.body = dto.body;
    if (dto.coverImage !== undefined) row.coverImage = dto.coverImage;
    if (dto.publishedAt !== undefined) row.publishedAt = new Date(dto.publishedAt);
    return this.repo.save(row);
  }

  async remove(id: string): Promise<void> {
    const res = await this.repo.delete(id);
    if (!res.affected) throw new NotFoundException('News item not found.');
  }
}
