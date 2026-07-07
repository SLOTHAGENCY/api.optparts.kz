import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { MonitoringService } from './monitoring.service';
import { MonitoringResponseDto } from './dto/monitoring-response.dto';

@ApiTags('monitoring')
@ApiBearerAuth()
@Controller('admin/monitoring')
@UseGuards(RolesGuard)
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get()
  @ApiOperation({
    summary: 'Состояние интеграций поставщиков и агрегатная статистика (ADMIN, MANAGER)',
    description:
      'Возвращает текущее состояние подключённых коннекторов поставщиков (включён ли поставщик ' +
      'в поиск и настроены ли его креденшелы) и агрегатную статистику успешности ответов ' +
      'поставщиков за последние 24 часа, вычисленную из журнала поиска (search_log).',
  })
  @ApiOkResponse({ type: MonitoringResponseDto })
  @ApiResponse({ status: 403, description: 'Только для администратора или менеджера.' })
  getMonitoring(): Promise<MonitoringResponseDto> {
    return this.monitoringService.getMonitoring();
  }
}
