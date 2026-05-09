import { Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';

@Controller('brands')
@UseGuards(RolesGuard)
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Public() @Get()
  findAll() { return this.brandsService.findAll(); }

  @Public() @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) { return this.brandsService.findById(id); }

  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Post() @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateBrandDto) { return this.brandsService.create(dto); }

  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBrandDto) {
    return this.brandsService.update(id, dto);
  }

  @Roles(UserRole.ADMIN) @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', ParseUUIDPipe) id: string) { return this.brandsService.delete(id); }
}