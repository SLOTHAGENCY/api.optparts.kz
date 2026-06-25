import { Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('categories')
@UseGuards(RolesGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  /** GET /categories/tree — nested tree (root → children → grandchildren) */
  @Public()
  @Get('tree')
  @ApiOperation({ summary: 'Get the full category tree (public)' })
  getTree() { return this.categoriesService.findTree(); }

  /** GET /categories — flat list of all categories */
  @Public()
  @Get()
  @ApiOperation({ summary: 'List all categories flat (public)' })
  findAll() { return this.categoriesService.findAll(); }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a single category by id (public)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 404, description: 'Category not found.' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.findById(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new category (MANAGER/ADMIN)' })
  @ApiResponse({ status: 403, description: 'Admin/Manager only.' })
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Put(':id')
  @ApiOperation({ summary: 'Update a category (MANAGER/ADMIN)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'Admin/Manager only.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.update(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a category (ADMIN)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'Admin only.' })
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.delete(id);
  }
}