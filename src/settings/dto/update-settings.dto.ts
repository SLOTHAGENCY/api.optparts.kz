import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsNumber, Min, IsIn } from 'class-validator';

export class UpdateSettingsDto {
  @ApiPropertyOptional({ description: 'Наценка по умолчанию в процентах (применяется, если у поставщика не задана своя)', example: 20 })
  @IsOptional() @IsNumber() @Min(0)
  DEFAULT_MARKUP_PERCENT?: number;

  @ApiPropertyOptional({ description: 'Курсы валют для пересчёта цен поставщиков в тенге (сколько тенге за 1 единицу валюты)', example: { RUB: 5.4, USD: 480, KZT: 1 } })
  @IsOptional() @IsObject()
  FX_RATES?: Record<string, number>;

  @ApiPropertyOptional({ description: 'Запас к курсу валют в процентах — страховка от колебаний курса', example: 2 })
  @IsOptional() @IsNumber() @Min(0)
  FX_BUFFER_PERCENT?: number;

  @ApiPropertyOptional({ description: 'Запас к сроку доставки в днях, добавляемый ко всем предложениям', example: 2 })
  @IsOptional() @IsNumber() @Min(0)
  DELIVERY_BUFFER_DAYS?: number;

  @ApiPropertyOptional({ description: 'Режим оформления заказов: test — тестовый (заказы не отправляются поставщикам), prod — боевой', example: 'test', enum: ['test', 'prod'] })
  @IsOptional() @IsIn(['test', 'prod'])
  ORDER_MODE?: 'test' | 'prod';
}
