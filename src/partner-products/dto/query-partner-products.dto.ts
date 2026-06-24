import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryPartnerProductsDto {
  @ApiPropertyOptional({ description: 'Filter by supplier code', example: 'rossko' })
  @IsOptional()
  @IsString()
  supplierCode?: string;

  @ApiPropertyOptional({ description: 'Filter by article (exact match)' })
  @IsOptional()
  @IsString()
  article?: string;

  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit: number = 20;
}
