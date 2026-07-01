import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CatalogQueryDto {
  @ApiPropertyOptional({ description: 'Идентификатор группы (узла) внутри категории', example: 'g1' })
  @IsOptional()
  @IsString()
  groupId?: string;

  @ApiPropertyOptional({ description: 'Сужение по поколению авто (PartsIndex generationId)', example: 'gen9' })
  @IsOptional()
  @IsString()
  generationId?: string;

  @ApiPropertyOptional({ description: 'Сужение по двигателю авто (PartsIndex engineId)', example: 'e1' })
  @IsOptional()
  @IsString()
  engineId?: string;

  @ApiPropertyOptional({
    description: 'Выбранные фасеты в виде JSON: {"<paramId>":"<value>"}',
    example: '{"120":"5W-30"}',
  })
  @IsOptional()
  @IsString()
  filters?: string;

  @ApiPropertyOptional({ description: 'Строка поиска/автодополнения', example: 'lukoil' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Язык данных', example: 'ru', enum: ['en', 'ru'] })
  @IsOptional()
  @IsString()
  lang?: string;
}

export class CatalogProductsQueryDto extends CatalogQueryDto {
  @ApiPropertyOptional({ description: 'Номер страницы (>=1)', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Размер страницы (1..100)', example: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
