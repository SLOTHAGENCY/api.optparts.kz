import { ApiProperty } from '@nestjs/swagger';

export class CartItemDto {
  @ApiProperty({ description: 'ID позиции в корзине' }) id: string;
  @ApiProperty({ description: 'Код поставщика', example: 'rossko' }) supplierCode: string;
  @ApiProperty({ description: 'Название поставщика', example: 'Rossko' }) supplierName: string;
  @ApiProperty({ description: 'Артикул детали' }) article: string;
  @ApiProperty({ description: 'Бренд' }) brand: string;
  @ApiProperty({ description: 'Название товара' }) productName: string;
  @ApiProperty({ description: 'Цена на момент добавления в корзину', example: 5200 })
  priceAtAdd: number;
  @ApiProperty({ description: 'Актуальная цена из повторной живой проверки', example: 5450 })
  currentPrice: number;
  @ApiProperty({ description: 'true, если текущая цена отличается от цены при добавлении', example: true })
  priceChanged: boolean;
  @ApiProperty({ description: 'false, если поставщик недоступен или предложение исчезло', example: true })
  available: boolean;
  @ApiProperty({ description: 'Количество в корзине', example: 2 }) quantity: number;
  @ApiProperty({ description: 'Доступный остаток на складе (0, если нет в наличии)', example: 10 })
  maxQuantity: number;
  @ApiProperty({ description: 'Сумма по позиции: текущая цена × количество', example: 10900 })
  subtotal: number;
}

export class CartResponseDto {
  @ApiProperty({ description: 'Позиции в корзине', type: [CartItemDto] })
  items: CartItemDto[];

  @ApiProperty({ description: 'Итоговая сумма корзины (по актуальным ценам)', example: 10900 })
  totalAmount: number;

  @ApiProperty({ description: 'true, если хотя бы одна позиция изменила цену или стала недоступна', example: true })
  hasChanges: boolean;
}
