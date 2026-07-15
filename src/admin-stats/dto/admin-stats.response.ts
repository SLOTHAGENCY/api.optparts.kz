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
  /**
   * Sub-orders stuck in the ambiguous SENDING state (money taken, outcome unknown) across all
   * time — each one needs a human to phone the supplier and resolve it. NOT time-boxed to
   * today: a row stuck since yesterday is exactly the one nobody must lose sight of.
   */
  stuckSending: number;
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
