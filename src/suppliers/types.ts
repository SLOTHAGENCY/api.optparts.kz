export interface SupplierOffer {
  supplierCode: string;
  article: string;
  brand: string;
  name: string;
  costPrice: number;
  currency: string;
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

/**
 * SENDING is OUR state, never a supplier's: the row is claimed by exactly one sender
 * (a conditional UPDATE) for the duration of the connector call. A row left in SENDING
 * means the request may have reached the supplier while the outcome write was lost — it
 * is ambiguous, must never be auto-re-sent, and only an admin who phoned the supplier can
 * resolve it (see OrdersService.resolveSupplierAttempt).
 * `supplier_orders.status` is a plain varchar column, so a new value needs no migration.
 */
export type SupplierOrderStatusValue =
  | 'NEW'
  | 'SENDING'
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
