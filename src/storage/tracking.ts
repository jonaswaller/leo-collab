import { getClobClient } from "../arb/clob.js";
import {
  getTrackedMakerOrders,
  TrackedMakerOrder,
} from "../arb/maker-registry.js";
import { getWagerByOrderId, saveWager, updateWagerSize } from "./operations.js";

// State to track the last time we checked for trades
let lastTradeCheck = Date.now() - 24 * 60 * 60 * 1000; // Default to 24h ago for first run

/**
 * Poll for recent trades and update the database for any filled Maker orders.
 *
 * This is designed to be called once per cycle in the main loop.
 */
export async function trackMakerFills(): Promise<void> {
  const now = Date.now();
  const trackedOrders = getTrackedMakerOrders();

  if (trackedOrders.length === 0) {
    lastTradeCheck = now;
    return;
  }

  const client = await getClobClient();

  try {
    // Fetch trades since last check
    // We fetch recent trades for the user.
    const trades = await client.getTrades({
      // No specific params, just gets latest trades for the user
    });

    // Create a map of tracked orders for O(1) lookup
    const trackedMap = new Map<string, TrackedMakerOrder>();
    for (const order of trackedOrders) {
      trackedMap.set(order.orderId, order);
    }

    // Identify which orders have new activity
    const activeOrderIds = new Set<string>();

    for (const trade of trades) {
      const tradeOrderId =
        (trade as any).orderID || (trade as any).maker_order_id;

      if (trackedMap.has(tradeOrderId)) {
        const timestamp = (trade as any).timestamp
          ? new Date((trade as any).timestamp).getTime()
          : 0;
        // If this trade is newer than our last check, mark the order for update
        if (timestamp > lastTradeCheck) {
          activeOrderIds.add(tradeOrderId);
        }
      }
    }

    // For each active order, fetch the authoritative status from CLOB and update DB
    for (const orderId of activeOrderIds) {
      const trackedOrder = trackedMap.get(orderId)!;

      // Check DB existence
      const exists = await getWagerByOrderId(orderId);

      // Fetch current status
      const orderStatus = await client.getOrder(orderId);
      const totalFilled = orderStatus
        ? parseFloat(orderStatus.size_matched || "0")
        : 0;

      if (totalFilled <= 0) continue;

      if (exists) {
        // Update existing wager
        await updateWagerSize(orderId, totalFilled);
      } else {
        // Create new wager
        await saveWager({
          order_id: orderId,
          market_slug: trackedOrder.marketSlug,
          event_slug: trackedOrder.eventSlug,
          sport: trackedOrder.sport,
          market_type: trackedOrder.marketType,
          outcome: trackedOrder.outcome,
          side: "BUY",
          order_type: "MAKER",
          price: trackedOrder.targetPrice,
          size_filled: totalFilled,
          ev_at_placement: trackedOrder.evAtPlacement,
          fair_prob_at_placement: trackedOrder.fairProbAtPlacement,
          // We don't have event start time readily available in TrackedMakerOrder yet,
          // but it's not critical for the wager record itself (it's in the market metadata).
          // We can leave it undefined for now or fetch it if needed.
          event_start_time: undefined,
        });
      }
    }

    lastTradeCheck = now;
  } catch (error: any) {
    console.error("❌ Error tracking maker fills:", error.message);
  }
}
