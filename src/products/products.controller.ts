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
  @ApiOperation({ summary: 'List all products (public)' })
  findAll() { return this.productsService.findAll(); }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a product by id (public)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 404, description: 'Product not found.' })
  findOne(@Param('id', ParseUUIDPipe) id: string) { return this.productsService.findById(id); }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new product (MANAGER/ADMIN)' })
  @ApiResponse({ status: 403, description: 'Admin/Manager only.' })
  create(@Body() dto: CreateProductDto) { return this.productsService.create(dto); }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Put(':id')
  @ApiOperation({ summary: 'Update a product (MANAGER/ADMIN)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'Admin/Manager only.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  // Images
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/images')
  @ApiOperation({ summary: 'Upload product images (MANAGER/ADMIN, multipart/form-data)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 403, description: 'Admin/Manager only.' })
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
  @ApiOperation({ summary: 'Remove a product image (MANAGER/ADMIN)' })
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
  @ApiOperation({ summary: 'Add a key/value property to a product (MANAGER/ADMIN)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  addProperty(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PropertyDto) {
    return this.productsService.addProperty(id, dto.key, dto.value);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Put(':id/properties/:propId')
  @ApiOperation({ summary: 'Update a product property value (MANAGER/ADMIN)' })
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
  @ApiOperation({ summary: 'Remove a product property (MANAGER/ADMIN)' })
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
  @ApiOperation({ summary: 'Delete a product (ADMIN)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'Admin only.' })
  delete(@Param('id', ParseUUIDPipe) id: string) { return this.productsService.delete(id); }
}