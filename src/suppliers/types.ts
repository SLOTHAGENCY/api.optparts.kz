export interface SupplierOffer {
  supplierCode: string;
  article: string;
  brand: string;
  name: string;
  costPrice: number;
  count: number;
  deliveryDays: number;
  multiplicity: number;
  warehouseId: string;
  isAnalog: boolean;
  raw: Record<string, unknown>;
}

export interface PlaceOrderItem {
  article: string;
  brand: string;
  warehouseId: string;
  quantity: number;
  raw: Record<string, unknown>;
}

export type SupplierOrderStatusValue =
  | 'NEW'
  | 'PLACED'
  | 'FAILED'
  | 'CONFIRMED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

export interface SupplierOrderResult {
  externalOrderId: string | null;
  status: SupplierOrderStatusValue;
  errorMessage?: string;
}

export interface ReturnItem {
  externalOrderId: string;
  article: string;
  quantity: number;
}

export interface ReturnResult {
  returnStatus: 'REQUESTED' | 'IN_PROGRESS' | 'DONE' | 'REJECTED';
  externalReturnId?: string;
  errorMessage?: string;
}
