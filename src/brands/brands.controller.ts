import { Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { BrandsService } from './brands.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('brands')
@UseGuards(RolesGuard)
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Список всех брендов (общедоступно)',
    description:
      'Возвращает справочник всех брендов (производителей запчастей). Используется для фильтров и ' +
      'привязки товаров к бренду. Доступно без авторизации.',
  })
  findAll() { return this.brandsService.findAll(); }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Получить бренд по id (общедоступно)',
    description:
      'Возвращает данные одного бренда по его id. Если бренд не найден — вернётся ошибка 404. ' +
      'Доступно без авторизации.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 404, description: 'Бренд не найден.' })
  findOne(@Param('id', ParseUUIDPipe) id: string) { return this.brandsService.findById(id); }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Создать бренд (менеджер/админ)',
    description:
      'Добавляет новый бренд в справочник. Доступно только менеджеру или администратору. ' +
      'Обычному пользователю вернётся ошибка 403.',
  })
  @ApiResponse({ status: 403, description: 'Только для менеджера/администратора.' })
  create(@Body() dto: CreateBrandDto) { return this.brandsService.create(dto); }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Put(':id')
  @ApiOperation({
    summary: 'Изменить бренд (менеджер/админ)',
    description:
      'Обновляет данные существующего бренда (например, название) по его id. Доступно только ' +
      'менеджеру или администратору.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'Только для менеджера/администратора.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBrandDto) {
    return this.brandsService.update(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Удалить бренд (только админ)',
    description:
      'Удаляет бренд из справочника по его id. Это необратимое действие, поэтому доступно только ' +
      'администратору. Менеджеру вернётся ошибка 403.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'Только для администратора.' })
  delete(@Param('id', ParseUUIDPipe) id: string) { return this.brandsService.delete(id); }
}