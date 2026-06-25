import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class SearchFilterDto {
  @ApiPropertyOptional({ example: 'BOSCH' })
  @IsOptional() @IsString()
  brand?: string;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0)
  priceMin?: number;

  @ApiPropertyOptional({ example: 9000 })
  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0)
  priceMax?: number;

  @ApiPropertyOptional({ example: true, description: 'Only offers with count > 0' })
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean()
  inStock?: boolean;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0)
  maxDeliveryDays?: number;

  @ApiPropertyOptional({ example: 'rossko,tabys', description: 'Comma-separated supplier codes' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.split(',').map((s) => s.trim()).filter(Boolean)
      : value,
  )
  @IsArray() @IsString({ each: true })
  suppliers?: string[];
}
