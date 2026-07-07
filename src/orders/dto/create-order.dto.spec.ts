import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderDto } from './create-order.dto';
import { DeliveryType } from '../entities/order.entity';

async function validateDto(data: Partial<CreateOrderDto>) {
  const dto = plainToInstance(CreateOrderDto, data);
  return validate(dto);
}

describe('CreateOrderDto validation', () => {
  it('requires recipientName and recipientPhone when deliveryType=delivery', async () => {
    const errors = await validateDto({
      deliveryType: DeliveryType.DELIVERY,
      addressId: '659ec08b-8b67-4008-ace4-db38797f635b',
    });
    const properties = errors.map((e) => e.property);
    expect(properties).toEqual(
      expect.arrayContaining(['recipientName', 'recipientPhone']),
    );
  });

  it('passes when delivery has valid recipientName, recipientPhone and addressId', async () => {
    const errors = await validateDto({
      deliveryType: DeliveryType.DELIVERY,
      addressId: '659ec08b-8b67-4008-ace4-db38797f635b',
      recipientName: 'Ivan Ivanov',
      recipientPhone: '+7 700 123 45 67',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects an invalid recipientPhone format for delivery', async () => {
    const errors = await validateDto({
      deliveryType: DeliveryType.DELIVERY,
      addressId: '659ec08b-8b67-4008-ace4-db38797f635b',
      recipientName: 'Ivan Ivanov',
      recipientPhone: 'abc',
    });
    expect(errors.some((e) => e.property === 'recipientPhone')).toBe(true);
  });

  it('does not require recipientName/recipientPhone for pickup', async () => {
    const errors = await validateDto({ deliveryType: DeliveryType.PICKUP });
    expect(errors).toHaveLength(0);
  });

  it('allows an optional customerComment for pickup', async () => {
    const errors = await validateDto({
      deliveryType: DeliveryType.PICKUP,
      customerComment: 'Please pack carefully',
    });
    expect(errors).toHaveLength(0);
  });
});
