import { Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';

@Controller('categories')
@UseGuards(RolesGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Public() @Get()
  findAll() { return this.categoriesService.findAll(); }

  @Public() @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) { return this.categoriesService.findById(id); }

  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Post() @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateCategoryDto) { return this.categoriesService.create(dto); }

  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.update(id, dto);
  }

  @Roles(UserRole.ADMIN) @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', ParseUUIDPipe) id: string) { return this.categoriesService.delete(id); }
}