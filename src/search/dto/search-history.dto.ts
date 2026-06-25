import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { SearchLog } from '../entities/search-log.entity';

export class HistoryQueryDto {
  @ApiPropertyOptional({ description: 'Номер страницы (начиная с 1)', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Количество записей на странице (до 100)', default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class HistoryResponseDto {
  @ApiProperty({ description: 'Записи истории поиска на текущей странице', type: [SearchLog] })
  items: SearchLog[];

  @ApiProperty({ description: 'Всего записей в истории', example: 42 })
  total: number;

  @ApiProperty({ description: 'Текущая страница', example: 1 })
  page: number;

  @ApiProperty({ description: 'Размер страницы', example: 20 })
  limit: number;
}
