import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/**
 * Checkout contract shared with Spec B (Cart). Frozen identically in both specs.
 * Returns cart positions with a fresh live re-check.
 */
export interface CheckoutItem {
  supplierCode: string;
  article: string;
  brand: string;
  productName: string;
  costPrice: number;
  sellPrice: number;
  currentPrice: number;
  priceAtAdd: number;
  warehouseId: string;
  raw: Record<string, unknown>;
  quantity: number;
  available: boolean;
  priceChanged: boolean;
  /** Live delivery estimate (days); null when the offer couldn't be re-checked. */
  deliveryDays: number | null;
}

export interface CartCheckoutContract {
  getCheckoutItems(userId: string): Promise<CheckoutItem[]>;
  clearCart(userId: string): Promise<unknown>;
}

/** DI token for the cart checkout seam. */
export const CART_CHECKOUT = Symbol('CART_CHECKOUT');

/**
 * MERGE: this stub is the seam with Spec B. Once CartModule is merged,
 * replace the `{ provide: CART_CHECKOUT, useClass: CartCheckoutStub }`
 * provider in OrdersModule with `{ provide: CART_CHECKOUT, useExisting: CartService }`
 * (and import CartModule). CartService already implements getCheckoutItems()/clearCart().
 */
@Injectable()
export class CartCheckoutStub implements CartCheckoutContract {
  async getCheckoutItems(_userId: string): Promise<CheckoutItem[]> {
    throw new ServiceUnavailableException(
      'Cart integration not wired yet — merge Spec B (CartService.getCheckoutItems).',
    );
  }

  async clearCart(_userId: string): Promise<unknown> {
    throw new ServiceUnavailableException(
      'Cart integration not wired yet — merge Spec B (CartService.clearCart).',
    );
  }
}
