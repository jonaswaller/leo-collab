import { getClobClient } from "../arb/clob.js";
import {
  getTrackedMakerOrders,
  TrackedMakerOrder,
} from "../arb/maker-registry.js";
import { getWagerByOrderId, saveWager, updateWagerSize } from "./operations.js";

/**
 * Poll for recent fills and update the database for any filled Maker orders.
 *
 * Hybrid Strategy:
 * 1. Fetch ALL live open orders via getOpenOrders() (1 call).
 *    - Matches tracked orders to open orders.
 *    - If an order is open and has `size_matched > 0`, update DB (partial fill).
 *
 * 2. Identify "Missing" Orders.
 *    - Tracked orders that are NOT in the open orders list must have finished (filled or cancelled).
 *    - Fetch status individually for these orders (1 call per finished order).
 *    - If filled/matched, update DB (full fill).
 *
 * This ensures 100% capture of fills (even during downtime) while minimizing API calls.
 */
export async function trackMakerFills(): Promise<void> {
  const trackedOrders = await getTrackedMakerOrders();

  if (trackedOrders.length === 0) {
    return;
  }

  const client = await getClobClient();

  try {
    // Step 1: Fetch ALL current open orders (efficient batch check)
    const openOrders = await client.getOpenOrders({}, true); // true = only first page (usually sufficient for active bots)

    // Map open orders by ID for quick lookup
    const openOrdersMap = new Map<string, any>();
    for (const o of openOrders) {
      openOrdersMap.set(o.id, o);
    }

    // Track which orders we've processed via the open orders list
    const processedOrderIds = new Set<string>();

    // 1. Update active partial fills
    for (const trackedOrder of trackedOrders) {
      const openOrder = openOrdersMap.get(trackedOrder.orderId);

      if (openOrder) {
        processedOrderIds.add(trackedOrder.orderId);

        // It's still open. Check for partial fills.
        const sizeMatched = parseFloat(openOrder.size_matched || "0");
        if (sizeMatched > 0) {
          await updateOrInsertWager(trackedOrder, sizeMatched);
        }
      }
    }

    // 2. Handle finished orders (tracked but not in open list)
    // These might be fully filled OR cancelled. We must check individually to be sure.
    const missingOrders = trackedOrders.filter(
      (t) => !processedOrderIds.has(t.orderId),
    );

    if (missingOrders.length > 0) {
      // console.log(
      //   `🔍 Checking status of ${missingOrders.length} finished/missing maker orders...`
      // );

      for (const missingOrder of missingOrders) {
        try {
          const status = await client.getOrder(missingOrder.orderId);
          const sizeMatched = status
            ? parseFloat(status.size_matched || "0")
            : 0;

          if (sizeMatched > 0) {
            await updateOrInsertWager(missingOrder, sizeMatched);
          }
        } catch (error: any) {
          // If 404, it might be really old or invalid. Just skip.
          console.warn(
            `   ⚠️ Could not fetch status for missing order ${missingOrder.orderId}: ${error.message}`,
          );
        }
      }
    }
  } catch (error: any) {
    console.error("❌ Error tracking maker fills:", error.message);
  }
}

/**
 * Helper to update an existing wager or create a new one if it doesn't exist.
 */
async function updateOrInsertWager(
  trackedOrder: TrackedMakerOrder,
  sizeMatched: number,
): Promise<void> {
  // Check DB existence
  const exists = await getWagerByOrderId(trackedOrder.orderId);

  if (exists) {
    // Update existing wager with latest filled size
    await updateWagerSize(trackedOrder.orderId, sizeMatched);
  } else {
    // Create new wager
    await saveWager({
      order_id: trackedOrder.orderId,
      market_slug: trackedOrder.marketSlug,
      event_slug: trackedOrder.eventSlug,
      sport: trackedOrder.sport,
      market_type: trackedOrder.marketType,
      outcome: trackedOrder.outcome,
      side: "BUY",
      order_type: "MAKER",
      price: trackedOrder.targetPrice,
      size_filled: sizeMatched,
      ev_at_placement: trackedOrder.evAtPlacement,
      fair_prob_at_placement: trackedOrder.fairProbAtPlacement,
      event_start_time: undefined,
    });
  }
}
