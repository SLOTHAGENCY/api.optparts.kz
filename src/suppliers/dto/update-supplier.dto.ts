import { IsBoolean, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';

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

  @ApiPropertyOptional({ description: 'ISO-4217 currency code for this supplier', example: 'KZT' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Non-sensitive partner config (URLs etc.)' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 2, nullable: true, description: 'Extra delivery days for this partner' })
  @IsOptional() @IsNumber() @Min(0)
  deliveryBufferDays?: number | null;

  @ApiPropertyOptional({ description: 'Partner API base URL (stored in config.API_URL)', example: 'https://api.tabys.parts' })
  @IsOptional() @IsString()
  apiUrl?: string;

  @ApiPropertyOptional({ description: 'Per-request timeout in ms', minimum: 1000, maximum: 60000, nullable: true })
  @IsOptional() @IsNumber() @Min(1000) @Max(60000)
  timeoutMs?: number | null;

  @ApiPropertyOptional({ description: 'Rate limit (requests per minute); null = unlimited', minimum: 1, maximum: 100000, nullable: true })
  @IsOptional() @IsNumber() @Min(1) @Max(100000)
  rateLimitRpm?: number | null;

  @ApiPropertyOptional({
    description: 'Sensitive keys (API_KEY/KEY1/KEY2/LOGIN/PASSWORD…). Stored encrypted; never returned.',
    example: { API_KEY: 'secret' },
  })
  @IsOptional() @IsObject()
  secrets?: Record<string, string>;
}
