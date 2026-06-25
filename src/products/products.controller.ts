import {
  Controller, Get, Post, Put, Delete, Patch,
  Body, Param, UploadedFiles, UseInterceptors,
  HttpCode, HttpStatus, ParseUUIDPipe, UseGuards,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiConsumes,
} from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

class PropertyDto {
  @IsString() @IsNotEmpty() @MaxLength(100) key: string;
  @IsString() @IsNotEmpty() @MaxLength(500) value: string;
}

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('products')
@UseGuards(RolesGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Список всех товаров (общедоступно)',
    description:
      'Возвращает полный каталог собственных товаров магазина. Доступно без авторизации — ' +
      'этот список можно показывать любым посетителям сайта. Это товары из своей базы, а не ' +
      'результаты живого поиска у поставщиков.',
  })
  findAll() { return this.productsService.findAll(); }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Получить товар по id (общедоступно)',
    description:
      'Возвращает подробную карточку одного товара по его идентификатору: название, описание, ' +
      'характеристики, изображения. Доступно без авторизации. Если товар с таким id не найден — ' +
      'вернётся ошибка 404.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 404, description: 'Товар не найден.' })
  findOne(@Param('id', ParseUUIDPipe) id: string) { return this.productsService.findById(id); }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Создать товар (менеджер/админ)',
    description:
      'Добавляет новый товар в каталог магазина: название, описание, бренд, категория и т.д. ' +
      'Доступно только сотрудникам с ролью менеджера или администратора. Обычным пользователям ' +
      'вернётся ошибка 403.',
  })
  @ApiResponse({ status: 403, description: 'Только для менеджера/администратора.' })
  create(@Body() dto: CreateProductDto) { return this.productsService.create(dto); }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Put(':id')
  @ApiOperation({
    summary: 'Изменить товар (менеджер/админ)',
    description:
      'Обновляет данные существующего товара по его id. Доступно только менеджеру или ' +
      'администратору. Передавайте поля, которые нужно изменить.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'Только для менеджера/администратора.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  // Images
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/images')
  @ApiOperation({
    summary: 'Загрузить изображения товара (менеджер/админ)',
    description:
      'Загружает одну или несколько картинок товара (до 10 файлов за раз) через форму ' +
      'multipart/form-data (поле "images"). Принимаются только изображения. Каждая картинка ' +
      'привязывается к товару и получает порядковый номер для сортировки. Доступно только ' +
      'менеджеру или администратору.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 403, description: 'Только для менеджера/администратора.' })
  @UseInterceptors(FilesInterceptor('images', 10, {
    storage: diskStorage({
      destination: './uploads/products',
      filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${unique}${extname(file.originalname)}`);
      },
    }),
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.match(/^image\//)) return cb(new Error('Only images allowed.'), false);
      cb(null, true);
    },
  }))
  async uploadImages(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const images = await Promise.all(
      files.map((f, i) => this.productsService.addImage(id, f.filename, i)),
    );
    return images;
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id/images/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Удалить изображение товара (менеджер/админ)',
    description:
      'Удаляет одну конкретную картинку у товара по её id. Сам товар остаётся, удаляется ' +
      'только указанное изображение. Доступно только менеджеру или администратору.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'imageId', format: 'uuid' })
  removeImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.productsService.removeImage(id, imageId);
  }

  // Properties
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/properties')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Добавить характеристику товару (менеджер/админ)',
    description:
      'Добавляет товару одну характеристику в виде пары «название — значение» (например, ' +
      '«Цвет» — «Чёрный» или «Вес» — «1.2 кг»). Так формируется список свойств в карточке ' +
      'товара. Доступно только менеджеру или администратору.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  addProperty(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PropertyDto) {
    return this.productsService.addProperty(id, dto.key, dto.value);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Put(':id/properties/:propId')
  @ApiOperation({
    summary: 'Изменить характеристику товара (менеджер/админ)',
    description:
      'Обновляет существующую характеристику товара — её название и/или значение — по id ' +
      'характеристики. Доступно только менеджеру или администратору.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'propId', format: 'uuid' })
  updateProperty(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('propId', ParseUUIDPipe) propId: string,
    @Body() dto: PropertyDto,
  ) {
    return this.productsService.updateProperty(id, propId, dto.key, dto.value);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id/properties/:propId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Удалить характеристику товара (менеджер/админ)',
    description:
      'Удаляет одну характеристику у товара по её id. Сам товар и остальные его свойства ' +
      'сохраняются. Доступно только менеджеру или администратору.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'propId', format: 'uuid' })
  removeProperty(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('propId', ParseUUIDPipe) propId: string,
  ) {
    return this.productsService.removeProperty(id, propId);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Удалить товар (только админ)',
    description:
      'Полностью удаляет товар из каталога вместе с его изображениями и характеристиками. ' +
      'Это необратимое действие, поэтому доступно только администратору. Менеджеру вернётся ' +
      'ошибка 403.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'Только для администратора.' })
  delete(@Param('id', ParseUUIDPipe) id: string) { return this.productsService.delete(id); }
}