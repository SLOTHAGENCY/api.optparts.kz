import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Items are taken from the cart's live re-check (CartService.getCheckoutItems),
 * not from the request body (Spec C §4).
 */
export class CreateOrderDto {
  @ApiPropertyOptional({ description: 'Delivery address id', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  addressId?: string;
}
