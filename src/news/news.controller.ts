import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { NewsService } from './news.service';
import { CreateNewsDto } from './dto/create-news.dto';
import { UpdateNewsDto } from './dto/update-news.dto';

@ApiTags('news')
@Controller('news')
export class NewsController {
  constructor(private readonly service: NewsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List news, newest first (public)' })
  findAll() {
    return this.service.findAll();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get one news item (public)' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  @ApiOperation({ summary: 'Create news (ADMIN/MANAGER)' })
  create(@Body() dto: CreateNewsDto) {
    return this.service.create(dto);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Put(':id')
  @ApiOperation({ summary: 'Update news (ADMIN/MANAGER)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNewsDto) {
    return this.service.update(id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete news (ADMIN/MANAGER)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
