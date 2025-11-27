/**
 * Database-backed registry for maker orders (Phase 3/4).
 *
 * Persists tracked maker orders to Supabase 'active_maker_orders' table.
 * This ensures state survives restarts and crashes.
 */

import { supabase } from "../storage/supabase.js";
import { MakerOpportunity } from "./types.js";
import { ExecutionPreview } from "./execution.js";

export interface TrackedMakerOrder {
  orderId: string;
  tokenId: string;
  marketSlug: string;
  eventSlug: string;
  sport: string;
  marketType: string;
  outcome: 1 | 2;
  targetPrice: number;
  size: number;
  evAtPlacement: number;
  fairProbAtPlacement: number;
  bookmakers: string[];
  placedAt: number; // ms since epoch
  eventStartTime?: string;
}

/**
 * Register a maker order in the database.
 *
 * Call this right after a successful placeMakerOrder() when you have
 * an orderId from the CLOB.
 */
export async function registerMakerOrder(
  orderId: string,
  opp: MakerOpportunity,
  preview: ExecutionPreview,
  eventStartTime?: string,
): Promise<void> {
  if (!supabase) {
    console.warn("⚠️ No database connection, skipping maker registration");
    return;
  }

  const { error } = await supabase.from("active_maker_orders").upsert({
    order_id: orderId,
    token_id: opp.tokenId,
    market_slug: opp.marketSlug,
    event_slug: opp.eventSlug,
    sport: opp.sport,
    market_type: opp.marketType,
    outcome: opp.outcome,
    target_price: preview.price,
    size: preview.size,
    ev_at_placement: opp.ev,
    fair_prob_at_placement: opp.fairProb,
    bookmakers_used: opp.bookmakers,
    placed_at: new Date().toISOString(),
    event_start_time: eventStartTime,
  });

  if (error) {
    console.error(
      `❌ Error registering maker order ${orderId}:`,
      error.message,
    );
  }
}

/**
 * Remove a maker order from the database (it's been cancelled or fully filled).
 */
export async function removeMakerOrder(orderId: string): Promise<void> {
  if (!supabase) {
    console.warn("⚠️ No database connection, skipping maker removal");
    return;
  }

  const { error } = await supabase
    .from("active_maker_orders")
    .delete()
    .eq("order_id", orderId);

  if (error) {
    console.error(`❌ Error removing maker order ${orderId}:`, error.message);
  }
}

/**
 * Fetch all currently active maker orders from the database.
 */
export async function getTrackedMakerOrders(): Promise<TrackedMakerOrder[]> {
  if (!supabase) {
    console.warn("⚠️ No database connection, returning empty maker list");
    return [];
  }

  const { data, error } = await supabase
    .from("active_maker_orders")
    .select("*");

  if (error) {
    console.error("❌ Error fetching tracked maker orders:", error.message);
    return [];
  }

  return (data || []).map((row: any) => ({
    orderId: row.order_id,
    tokenId: row.token_id,
    marketSlug: row.market_slug,
    eventSlug: row.event_slug,
    sport: row.sport,
    marketType: row.market_type,
    outcome: row.outcome,
    targetPrice: Number(row.target_price),
    size: Number(row.size),
    evAtPlacement: Number(row.ev_at_placement),
    fairProbAtPlacement: Number(row.fair_prob_at_placement),
    bookmakers: row.bookmakers_used || [],
    placedAt: new Date(row.placed_at).getTime(),
    eventStartTime: row.event_start_time,
  }));
}
