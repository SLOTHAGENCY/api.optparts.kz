import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsNumber, Min } from 'class-validator';

export class UpdateSettingsDto {
  @ApiPropertyOptional({ example: 20 })
  @IsOptional() @IsNumber() @Min(0)
  DEFAULT_MARKUP_PERCENT?: number;

  @ApiPropertyOptional({ example: { RUB: 5.4, USD: 480, KZT: 1 } })
  @IsOptional() @IsObject()
  FX_RATES?: Record<string, number>;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional() @IsNumber() @Min(0)
  FX_BUFFER_PERCENT?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional() @IsNumber() @Min(0)
  DELIVERY_BUFFER_DAYS?: number;
}
