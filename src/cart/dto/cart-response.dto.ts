import { ApiProperty } from '@nestjs/swagger';

export class CartItemDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'rossko' }) supplierCode: string;
  @ApiProperty({ example: 'Rossko' }) supplierName: string;
  @ApiProperty() article: string;
  @ApiProperty() brand: string;
  @ApiProperty() productName: string;
  @ApiProperty({ description: 'sellPrice at the moment of adding', example: 5200 })
  priceAtAdd: number;
  @ApiProperty({ description: 'fresh sellPrice from live re-check', example: 5450 })
  currentPrice: number;
  @ApiProperty({ description: 'currentPrice differs from priceAtAdd', example: true })
  priceChanged: boolean;
  @ApiProperty({ description: 'false if partner unavailable or offer gone', example: true })
  available: boolean;
  @ApiProperty({ example: 2 }) quantity: number;
  @ApiProperty({ description: 'live stock count (0 when unavailable)', example: 10 })
  maxQuantity: number;
  @ApiProperty({ description: 'currentPrice * quantity', example: 10900 })
  subtotal: number;
}

export class CartResponseDto {
  @ApiProperty({ type: [CartItemDto] })
  items: CartItemDto[];

  @ApiProperty({ description: 'sum of subtotals (fresh prices)', example: 10900 })
  totalAmount: number;

  @ApiProperty({ description: 'any item changed price or is unavailable', example: true })
  hasChanges: boolean;
}
