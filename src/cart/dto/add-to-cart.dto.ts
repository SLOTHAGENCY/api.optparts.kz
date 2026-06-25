import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsInt,
  IsOptional,
  Min,
  IsObject,
} from 'class-validator';

/**
 * Snapshot of the offer the user picked from GET /api/search.
 * The front-end echoes back the offer it received.
 */
export class AddToCartDto {
  @ApiProperty({ description: 'Код поставщика, у которого выбрано предложение', example: 'rossko' })
  @IsString()
  @IsNotEmpty()
  supplierCode: string;

  @ApiProperty({ description: 'Артикул (номер) детали', example: '0986452041' })
  @IsString()
  @IsNotEmpty()
  article: string;

  @ApiProperty({ description: 'Бренд (производитель)', example: 'BOSCH' })
  @IsString()
  brand: string;

  @ApiProperty({ description: 'Название товара', example: 'Фильтр масляный' })
  @IsString()
  @IsNotEmpty()
  productName: string;

  @ApiProperty({ description: 'Цена продажи, которую видел пользователь в момент выбора', example: 5200 })
  @IsNumber()
  @Min(0)
  sellPrice: number;

  @ApiPropertyOptional({
    description:
      'Внутренняя закупочная цена. Клиент её НЕ передаёт — поиск её никогда не показывает, ' +
      'а сервер сам пересчитывает её при каждой повторной проверке. Поле служит лишь резервным запасным значением.',
    example: 4333,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @ApiProperty({ description: 'Идентификатор склада / предложения у поставщика', example: 'W12' })
  @IsString()
  @IsNotEmpty()
  warehouseId: string;

  @ApiProperty({
    description: 'Исходные данные предложения из поиска — возвращаются как есть, нужны для оформления заказа',
    type: Object,
  })
  @IsObject()
  raw: Record<string, unknown>;

  @ApiProperty({ description: 'Количество (минимум 1)', example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}
