import { ServiceUnavailableException } from '@nestjs/common';
import { CART_CHECKOUT, CartCheckoutStub } from './cart-checkout.contract';

describe('cart checkout seam', () => {
  it('exposes the CART_CHECKOUT DI token as a symbol', () => {
    expect(typeof CART_CHECKOUT).toBe('symbol');
  });

  it('stub throws ServiceUnavailable until Spec B is merged', async () => {
    const stub = new CartCheckoutStub();
    await expect(stub.getCheckoutItems('u1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
