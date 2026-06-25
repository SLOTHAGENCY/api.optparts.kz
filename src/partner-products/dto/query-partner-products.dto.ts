import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryPartnerProductsDto {
  @ApiPropertyOptional({ description: 'Фильтр по коду поставщика', example: 'rossko' })
  @IsOptional()
  @IsString()
  supplierCode?: string;

  @ApiPropertyOptional({ description: 'Фильтр по артикулу (точное совпадение)' })
  @IsOptional()
  @IsString()
  article?: string;

  @ApiPropertyOptional({ description: 'Номер страницы (начиная с 1)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ description: 'Количество элементов на странице', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit: number = 20;
}
