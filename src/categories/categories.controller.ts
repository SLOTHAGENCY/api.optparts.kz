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
  @ApiOperation({
    summary: 'Дерево категорий (общедоступно)',
    description:
      'Возвращает все категории каталога в виде дерева: корневые категории, внутри них ' +
      'подкатегории, а в них — ещё более вложенные. Удобно для построения раскрывающегося меню ' +
      'каталога на сайте. Доступно без авторизации.',
  })
  getTree() { return this.categoriesService.findTree(); }

  /** GET /categories — flat list of all categories */
  @Public()
  @Get()
  @ApiOperation({
    summary: 'Список всех категорий одним списком (общедоступно)',
    description:
      'Возвращает все категории каталога обычным плоским списком (без вложенности). Удобно, ' +
      'когда нужна простая выборка всех категорий, а не дерево. Доступно без авторизации.',
  })
  findAll() { return this.categoriesService.findAll(); }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Получить категорию по id (общедоступно)',
    description:
      'Возвращает данные одной категории по её id. Если категория не найдена — вернётся ошибка ' +
      '404. Доступно без авторизации.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 404, description: 'Категория не найдена.' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.findById(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Создать категорию (менеджер/админ)',
    description:
      'Добавляет новую категорию в каталог. Можно указать родительскую категорию, чтобы сделать ' +
      'её вложенной. Доступно только менеджеру или администратору.',
  })
  @ApiResponse({ status: 403, description: 'Только для менеджера/администратора.' })
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Put(':id')
  @ApiOperation({
    summary: 'Изменить категорию (менеджер/админ)',
    description:
      'Обновляет данные существующей категории (например, название или родителя) по её id. ' +
      'Доступно только менеджеру или администратору.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'Только для менеджера/администратора.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.update(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Удалить категорию (только админ)',
    description:
      'Удаляет категорию из каталога по её id. Это необратимое действие, поэтому доступно только ' +
      'администратору. Менеджеру вернётся ошибка 403.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'Только для администратора.' })
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.delete(id);
  }
}