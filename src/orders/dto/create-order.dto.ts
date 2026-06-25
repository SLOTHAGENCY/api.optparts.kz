import { IsEnum, IsUUID, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryType } from '../entities/order.entity';

/**
 * Items are taken from the cart's live re-check (CartService.getCheckoutItems),
 * not from the request body (Spec C §4).
 */
export class CreateOrderDto {
  @ApiProperty({
    enum: DeliveryType,
    description: 'Delivery method: home delivery or self pickup',
  })
  @IsEnum(DeliveryType)
  deliveryType: DeliveryType;

  @ApiPropertyOptional({
    description: 'Delivery address id — required when deliveryType=delivery',
    format: 'uuid',
  })
  // Validated only for delivery: then it must be a UUID (and present).
  // For pickup the rule is skipped entirely, so addressId may be omitted.
  @ValidateIf((o) => o.deliveryType === DeliveryType.DELIVERY)
  @IsUUID()
  addressId?: string;
}
