import { IsBoolean, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSupplierDto {
  @ApiPropertyOptional({ description: 'Включить/выключить поставщика в поиске без перезапуска сервера' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Процент наценки для этого поставщика; если null — используется общая наценка по умолчанию',
    minimum: 0,
    maximum: 1000,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  markupPercent?: number | null;

  @ApiPropertyOptional({ description: 'Код валюты поставщика по стандарту ISO-4217', example: 'KZT' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Несекретные настройки подключения поставщика (например, адреса API)' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Дополнительные дни к сроку доставки для этого поставщика', example: 2, nullable: true })
  @IsOptional() @IsNumber() @Min(0)
  deliveryBufferDays?: number | null;
}
