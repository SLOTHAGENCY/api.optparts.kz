import { IsBoolean, IsNumber, IsObject, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSupplierDto {
  @ApiPropertyOptional({ description: 'Enable/disable the partner without redeploy' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Markup percent for this partner; null falls back to DEFAULT_MARKUP_PERCENT',
    minimum: 0,
    maximum: 1000,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  markupPercent?: number | null;

  @ApiPropertyOptional({ description: 'Non-sensitive partner config (URLs etc.)' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
