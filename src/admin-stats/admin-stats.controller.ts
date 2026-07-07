import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { AdminStatsService } from './admin-stats.service';
import { AdminStatsResponse } from './dto/admin-stats.response';

@ApiTags('admin-stats')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(RolesGuard)
export class AdminStatsController {
  constructor(private readonly adminStats: AdminStatsService) {}

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('stats')
  @ApiOperation({
    summary: 'Сводная статистика для дашборда админ-панели (админ/менеджер)',
    description:
      'Агрегаты за сегодня: заказы (кол-во, сумма, динамика ко вчера), ошибки интеграций и ' +
      'успешность запросов к поставщикам, число активных поставщиков, новых клиентов и ' +
      'доставленных заказов. Доступно администратору и менеджеру.',
  })
  @ApiResponse({ status: 403, description: 'Только для администратора или менеджера.' })
  getStats(): Promise<AdminStatsResponse> {
    return this.adminStats.getStats();
  }
}
