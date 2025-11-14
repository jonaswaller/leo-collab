/**
 * Order status monitoring (Phase 3.8)
 *
 * Lightweight helpers to inspect the current open orders on the CLOB.
 * This is deliberately read-only for now; cancellation / EV re-check
 * will come in Phase 4.
 */

import { OpenOrder } from "@polymarket/clob-client";
import { fetchOpenOrders } from "./positions.js";

export interface OpenOrderSummary {
  total: number;
  byStatus: Record<string, number>;
}

/**
 * Fetch open orders (first page) and aggregate them by status.
 */
export async function summarizeOpenOrders(): Promise<{
  orders: OpenOrder[];
  summary: OpenOrderSummary;
}> {
  const orders = await fetchOpenOrders();

  const byStatus: Record<string, number> = {};
  for (const o of orders) {
    const key = o.status || "UNKNOWN";
    byStatus[key] = (byStatus[key] || 0) + 1;
  }

  return {
    orders,
    summary: {
      total: orders.length,
      byStatus,
    },
  };
}
