export interface AdminStatsOrdersToday {
  count: number;
  totalAmount: number;
  changePct: number | null;
}

export interface AdminStatsLastError {
  supplierCode: string;
  message: string;
  at: string;
}

export interface AdminStatsIntegrations {
  errorsToday: number;
  successRate: number | null;
  lastError: AdminStatsLastError | null;
}

export interface AdminStatsResponse {
  ordersToday: AdminStatsOrdersToday;
  integrations: AdminStatsIntegrations;
  activeSuppliers: number;
  newCustomersToday: number;
  deliveredToday: number;
  queueStatus: 'ok' | 'unknown';
}
