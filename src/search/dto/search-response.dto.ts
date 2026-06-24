import { ApiProperty } from '@nestjs/swagger';

export class OfferDto {
  @ApiProperty({ description: 'Opaque deterministic offer id (base64url)' })
  offerId: string;

  @ApiProperty({ example: 'rossko' })
  supplierCode: string;

  @ApiProperty({ example: 'Rossko' })
  supplierName: string;

  @ApiProperty({ example: 6240, description: 'Sell price (markup applied). costPrice is never exposed.' })
  sellPrice: number;

  @ApiProperty({ example: 3 })
  deliveryDays: number;

  @ApiProperty({ example: 10 })
  count: number;

  @ApiProperty({ example: 1 })
  multiplicity: number;

  @ApiProperty({ example: 's1' })
  warehouseId: string;

  @ApiProperty({
    description:
      'Opaque supplier payload. The frontend MUST return this offer (with offerId and raw) verbatim when adding it to the cart (Spec B).',
    type: 'object',
    additionalProperties: true,
  })
  raw: Record<string, unknown>;
}

export class SearchGroupDto {
  @ApiProperty({ example: '0451103316' })
  article: string;

  @ApiProperty({ example: 'BOSCH' })
  brand: string;

  @ApiProperty({ example: 'Oil Filter' })
  name: string;

  @ApiProperty({ type: [OfferDto] })
  offers: OfferDto[];
}

export class SearchQueryEchoDto {
  @ApiProperty({ example: '0451103316' })
  article: string;

  @ApiProperty({ example: 'BOSCH', nullable: true })
  brand: string | null;
}

export class SearchResponseDto {
  @ApiProperty({ type: SearchQueryEchoDto })
  query: SearchQueryEchoDto;

  @ApiProperty({ type: [SearchGroupDto], description: 'Exact matches (isAnalog=false)' })
  exact: SearchGroupDto[];

  @ApiProperty({ type: [SearchGroupDto], description: 'Analog substitutes (isAnalog=true)' })
  analogs: SearchGroupDto[];
}
