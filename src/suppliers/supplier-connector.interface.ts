import {
  PlaceOrderItem,
  ReturnItem,
  ReturnResult,
  SupplierOffer,
  SupplierOrderResult,
  SupplierOrderStatusValue,
} from './types';

export interface SupplierConnector {
  readonly code: string;
  readonly name: string;

  search(article: string, brand?: string): Promise<SupplierOffer[]>;
  placeOrder(items: PlaceOrderItem[]): Promise<SupplierOrderResult>;
  getOrderStatus(externalOrderId: string): Promise<SupplierOrderStatusValue>;
  requestReturn(
    externalOrderId: string,
    items: ReturnItem[],
  ): Promise<ReturnResult>;
}

/** DI token: array of registered SupplierConnector providers. */
export const SUPPLIERS = Symbol('SUPPLIERS');
