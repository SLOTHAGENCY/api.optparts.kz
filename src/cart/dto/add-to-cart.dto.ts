import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsInt,
  Min,
  IsObject,
} from 'class-validator';

/**
 * Snapshot of the offer the user picked from GET /api/search.
 * The front-end echoes back the offer it received.
 */
export class AddToCartDto {
  @ApiProperty({ example: 'rossko' })
  @IsString()
  @IsNotEmpty()
  supplierCode: string;

  @ApiProperty({ example: '0986452041' })
  @IsString()
  @IsNotEmpty()
  article: string;

  @ApiProperty({ example: 'BOSCH' })
  @IsString()
  brand: string;

  @ApiProperty({ example: 'Фильтр масляный' })
  @IsString()
  @IsNotEmpty()
  productName: string;

  @ApiProperty({ description: 'sellPrice shown to the user at selection time', example: 5200 })
  @IsNumber()
  @Min(0)
  sellPrice: number;

  @ApiProperty({ description: 'partner cost price (internal)', example: 4333 })
  @IsNumber()
  @Min(0)
  costPrice: number;

  @ApiProperty({ description: 'partner warehouse / offer id', example: 'W12' })
  @IsString()
  @IsNotEmpty()
  warehouseId: string;

  @ApiProperty({
    description: 'raw offer identifier from search, passed back for placeOrder',
    type: Object,
  })
  @IsObject()
  raw: Record<string, unknown>;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}
