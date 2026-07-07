import { ApiProperty } from '@nestjs/swagger';

export type ConnectorStatus = 'online' | 'disabled' | 'misconfigured';

export class MonitoringConnectorDto {
  @ApiProperty({ example: 'tabys', description: 'Код поставщика' })
  code: string;

  @ApiProperty({ example: 'Tabys', description: 'Название поставщика' })
  name: string;

  @ApiProperty({ example: true, description: 'Включён ли поставщик в поиск (suppliers.isActive)' })
  isActive: boolean;

  @ApiProperty({ example: true, description: 'Есть ли все обязательные креденшелы (connector.isConfigured())' })
  isConfigured: boolean;

  @ApiProperty({ enum: ['online', 'disabled', 'misconfigured'], example: 'online' })
  status: ConnectorStatus;
}

export class MonitoringStatsDto {
  @ApiProperty({ example: 24, description: 'Окно агрегации в часах' })
  windowHours: number;

  @ApiProperty({ example: 128, description: 'Сколько поисков было за окно (строк в search_log)' })
  searchCount: number;

  @ApiProperty({ example: 250, description: 'Суммарно опрошено поставщиков за окно (SUM suppliersQueried)' })
  suppliersQueriedTotal: number;

  @ApiProperty({ example: 12, description: 'Суммарно неудачных ответов поставщиков за окно (SUM suppliersFailed)' })
  suppliersFailedTotal: number;

  @ApiProperty({ example: 0.952, description: 'Доля успешных ответов 0..1; =1 если опросов не было' })
  successRate: number;
}

export class MonitoringResponseDto {
  @ApiProperty({ type: [MonitoringConnectorDto] })
  connectors: MonitoringConnectorDto[];

  @ApiProperty({ type: MonitoringStatsDto })
  stats: MonitoringStatsDto;

  @ApiProperty({ example: '2026-07-03T12:00:00.000Z', description: 'Момент формирования ответа (ISO)' })
  generatedAt: string;
}
