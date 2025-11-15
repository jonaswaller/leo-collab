/**
 * In-memory registry for maker orders (Phase 3/4).
 *
 * This is intentionally simple and process-local. Persistent storage
 * will come later once we add a real database.
 */

import { MakerOpportunity } from "./types.js";
import { ExecutionPreview } from "./execution.js";

export interface TrackedMakerOrder {
  orderId: string;
  tokenId: string;
  marketSlug: string;
  eventSlug: string;
  outcome: 1 | 2;
  targetPrice: number;
  size: number;
  evAtPlacement: number;
  placedAt: number; // ms since epoch
}

const trackedMakerOrders = new Map<string, TrackedMakerOrder>();

/**
 * Register a maker order we just placed.
 *
 * Call this right after a successful placeMakerOrder() when you have
 * an orderId from the CLOB.
 */
export function registerMakerOrder(
  orderId: string,
  opp: MakerOpportunity,
  preview: ExecutionPreview,
): void {
  const now = Date.now();

  const entry: TrackedMakerOrder = {
    orderId,
    tokenId: opp.tokenId,
    marketSlug: opp.marketSlug,
    eventSlug: opp.eventSlug,
    outcome: opp.outcome,
    targetPrice: preview.price,
    size: preview.size,
    evAtPlacement: opp.ev,
    placedAt: now,
  };

  trackedMakerOrders.set(orderId, entry);
}

export function removeMakerOrder(orderId: string): void {
  trackedMakerOrders.delete(orderId);
}

export function getTrackedMakerOrders(): TrackedMakerOrder[] {
  return Array.from(trackedMakerOrders.values());
}
