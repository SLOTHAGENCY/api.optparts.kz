import {
  IsEnum,
  IsUUID,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryType } from '../entities/order.entity';

/**
 * Items are taken from the cart's live re-check (CartService.getCheckoutItems),
 * not from the request body (Spec C §4).
 */
export class CreateOrderDto {
  @ApiProperty({
    enum: DeliveryType,
    description: 'Способ получения: доставка курьером (delivery) или самовывоз (pickup)',
  })
  @IsEnum(DeliveryType)
  deliveryType: DeliveryType;

  @ApiPropertyOptional({
    description: 'ID адреса доставки — обязателен, когда выбрана доставка (deliveryType=delivery); при самовывозе не нужен',
    format: 'uuid',
  })
  // Validated only for delivery: then it must be a UUID (and present).
  // For pickup the rule is skipped entirely, so addressId may be omitted.
  @ValidateIf((o) => o.deliveryType === DeliveryType.DELIVERY)
  @IsUUID()
  addressId?: string;

  @ApiPropertyOptional({
    description: 'Имя получателя — обязательно при доставке (deliveryType=delivery)',
    maxLength: 150,
  })
  // Required only for delivery, same pattern as addressId above.
  @ValidateIf((o) => o.deliveryType === DeliveryType.DELIVERY)
  @IsString()
  @MaxLength(150)
  recipientName?: string;

  @ApiPropertyOptional({
    description: 'Телефон получателя — обязателен при доставке (deliveryType=delivery)',
  })
  @ValidateIf((o) => o.deliveryType === DeliveryType.DELIVERY)
  @Matches(/^\+?[0-9 ()-]{7,}$/)
  recipientPhone?: string;

  @ApiPropertyOptional({ description: 'Комментарий покупателя к заказу — опционально' })
  @IsOptional()
  @IsString()
  customerComment?: string;
}
