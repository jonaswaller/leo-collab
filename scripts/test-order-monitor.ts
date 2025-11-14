/**
 * scripts/test-order-monitor.ts
 *
 * Simple script to inspect current open orders and their statuses.
 * This chips away at Phase 3.8 (Order Status Monitor).
 */

import "dotenv/config";
import { summarizeOpenOrders } from "../src/arb/order-monitor.js";

async function main() {
  console.log("== Open Orders Monitor ==");

  const { orders, summary } = await summarizeOpenOrders();

  console.log(`Total open orders: ${summary.total}`);
  console.log("By status:");
  for (const [status, count] of Object.entries(summary.byStatus)) {
    console.log(`  ${status}: ${count}`);
  }

  if (orders.length > 0) {
    console.log("\nSample orders:");
    for (const o of orders.slice(0, 5)) {
      console.log({
        id: o.id,
        status: o.status,
        market: o.market,
        asset_id: o.asset_id,
        side: o.side,
        price: o.price,
        original_size: o.original_size,
        size_matched: o.size_matched,
        order_type: o.order_type,
        created_at: o.created_at,
      });
    }
  }
}

main().catch((err) => {
  console.error("Monitor failed:", err);
  process.exit(1);
});
