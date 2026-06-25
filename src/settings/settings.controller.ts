import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { SettingsService, AppSettings } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Получить глобальные настройки системы (только админ)',
    description:
      'Возвращает общие настройки магазина, которые влияют на расчёт цен и сроков: процент ' +
      'наценки, курсы валют для пересчёта цен поставщиков и буфер к сроку доставки. Доступно ' +
      'только администратору.',
  })
  @ApiResponse({ status: 403, description: 'Только для администратора.' })
  get(): Promise<AppSettings> {
    return this.settings.getAll();
  }

  @Put()
  @ApiOperation({
    summary: 'Изменить глобальные настройки системы (только админ)',
    description:
      'Обновляет общие настройки магазина: наценку, курсы валют, буфер срока доставки. Изменения ' +
      'сразу влияют на то, какие итоговые цены и сроки видят покупатели. Можно присылать только ' +
      'те поля, которые нужно поменять. В ответ возвращаются актуальные настройки. Доступно ' +
      'только администратору.',
  })
  @ApiResponse({ status: 403, description: 'Только для администратора.' })
  async update(@Body() dto: UpdateSettingsDto): Promise<AppSettings> {
    await this.settings.update(dto);
    return this.settings.getAll();
  }
}
