import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { SuppliersService } from './suppliers.service';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@ApiTags('suppliers')
@ApiBearerAuth()
@Controller('suppliers')
@UseGuards(RolesGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Roles(UserRole.ADMIN)
  @Get()
  @ApiOperation({
    summary: 'Список настроек поставщиков-партнёров (только админ)',
    description:
      'Возвращает все подключённые источники запчастей (поставщиков) с их настройками: включён ' +
      'ли поставщик в поиск, индивидуальная наценка, параметры подключения к его API. ' +
      'Используется в админ-панели для управления поставщиками. Доступно только администратору.',
  })
  @ApiResponse({ status: 403, description: 'Только для администратора.' })
  findAll() {
    return this.suppliersService.findAll();
  }

  @Roles(UserRole.ADMIN)
  @Patch(':code')
  @ApiOperation({
    summary: 'Изменить настройки поставщика (только админ)',
    description:
      'Меняет настройки одного поставщика по его коду (например, "rossko"): включить/выключить ' +
      'его в поиске (isActive), задать процент наценки (markupPercent) и параметры подключения ' +
      '(config). Так администратор управляет тем, какие поставщики участвуют в поиске и на каких ' +
      'условиях. Доступно только администратору.',
  })
  @ApiParam({ name: 'code', example: 'rossko', description: 'Код поставщика (например, rossko)' })
  @ApiResponse({ status: 403, description: 'Только для администратора.' })
  update(@Param('code') code: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliersService.update(code, dto);
  }
}
