import { SupplierConnector } from '../../supplier-connector.interface';
import {
  PlaceOrderItem,
  ReturnItem,
  ReturnResult,
  SupplierOffer,
  SupplierOrderResult,
  SupplierOrderStatusValue,
} from '../../types';

/**
 * Controllable connector for Search/Cart/Orders tests.
 * Not registered in production providers — instantiated directly in tests.
 */
export class MockConnector implements SupplierConnector {
  private offers: SupplierOffer[] = [];
  private error: Error | null = null;
  private delayMs = 0;
  private orderResult: SupplierOrderResult = {
    externalOrderId: 'MOCK-EXT-1',
    status: 'PLACED',
  };
  private status: SupplierOrderStatusValue = 'PLACED';
  private returnResult: ReturnResult = { returnStatus: 'REQUESTED' };

  constructor(
    public readonly code = 'mock',
    public readonly name = 'Mock Supplier',
  ) {}

  setOffers(offers: SupplierOffer[]): this {
    this.offers = offers;
    return this;
  }

  failWith(error: Error): this {
    this.error = error;
    return this;
  }

  timeoutMs(ms: number): this {
    this.delayMs = ms;
    return this;
  }

  setOrderResult(result: SupplierOrderResult): this {
    this.orderResult = result;
    return this;
  }

  setStatus(status: SupplierOrderStatusValue): this {
    this.status = status;
    return this;
  }

  setReturnResult(result: ReturnResult): this {
    this.returnResult = result;
    return this;
  }

  async isConfigured(): Promise<boolean> { return true; }

  async search(_article: string, _brand?: string): Promise<SupplierOffer[]> {
    if (this.error) throw this.error;
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    return this.offers;
  }

  async placeOrder(_items: PlaceOrderItem[]): Promise<SupplierOrderResult> {
    if (this.error) throw this.error;
    return this.orderResult;
  }

  async getOrderStatus(_externalOrderId: string): Promise<SupplierOrderStatusValue> {
    return this.status;
  }

  async requestReturn(
    _externalOrderId: string,
    _items: ReturnItem[],
  ): Promise<ReturnResult> {
    return this.returnResult;
  }
}
