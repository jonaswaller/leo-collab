import { supabase } from "./supabase.js";

export interface Wager {
  order_id: string;
  market_slug: string;
  event_slug: string;
  sport: string;
  market_type: string;
  outcome: 1 | 2;
  side: "BUY";
  order_type: "MAKER" | "TAKER";
  price: number;
  size_filled: number;
  ev_at_placement: number;
  fair_prob_at_placement: number;
  bookmakers: string[];
  event_start_time?: Date | null | undefined;
}

/**
 * Save a new wager to the database.
 * Used for Taker orders (immediately filled) and Maker orders (when first filled).
 */
export async function saveWager(wager: Wager): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase.from("wagers").insert([
    {
      order_id: wager.order_id,
      market_slug: wager.market_slug,
      event_slug: wager.event_slug,
      sport: wager.sport,
      market_type: wager.market_type,
      outcome: wager.outcome,
      side: wager.side,
      order_type: wager.order_type,
      price: wager.price,
      size_filled: wager.size_filled,
      ev_at_placement: wager.ev_at_placement,
      fair_prob_at_placement: wager.fair_prob_at_placement,
      bookmakers_used: wager.bookmakers,
      event_start_time: wager.event_start_time,
    },
  ]);

  if (error) {
    console.error(`❌ Error saving wager ${wager.order_id}:`, error.message);
  } else {
    // console.log(`💾 Saved wager ${wager.order_id} to DB`);
  }
}

/**
 * Update the filled size of an existing wager.
 * Used for Maker orders that get partially filled over time.
 */
export async function updateWagerSize(
  orderId: string,
  newTotalSize: number,
): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from("wagers")
    .update({ size_filled: newTotalSize })
    .eq("order_id", orderId);

  if (error) {
    console.error(
      `❌ Error updating wager size for ${orderId}:`,
      error.message,
    );
  }
}

/**
 * Check if a wager with the given orderId already exists.
 */
export async function getWagerByOrderId(orderId: string): Promise<boolean> {
  if (!supabase) return false;

  const { count, error } = await supabase
    .from("wagers")
    .select("*", { count: "exact", head: true })
    .eq("order_id", orderId);

  if (error) {
    console.error(
      `❌ Error checking wager existence for ${orderId}:`,
      error.message,
    );
    return false;
  }

  return (count || 0) > 0;
}

/**
 * Update Closing Line Value (CLV) for all wagers on a specific market.
 * Call this when a market transitions to "started" (live).
 *
 * CLV = (closing_fair_prob - price) / closing_fair_prob
 */
export async function updateWagerCLV(
  marketSlug: string,
  closingFairProb1: number,
  closingFairProb2?: number, // Optional: Explicit prob for outcome 2 (needed for 3-way markets like Soccer H2H)
): Promise<void> {
  if (!supabase) return;

  // We need to fetch the wagers first to calculate individual CLVs based on their entry price
  const { data: wagers, error: fetchError } = await supabase
    .from("wagers")
    .select("id, price, outcome")
    .eq("market_slug", marketSlug);

  if (fetchError) {
    console.error(
      `❌ Error fetching wagers for CLV update on ${marketSlug}:`,
      fetchError.message,
    );
    return;
  }

  if (!wagers || wagers.length === 0) return;

  // console.log(
  //   `📉 Updating CLV for ${wagers.length} wagers in ${marketSlug}...`,
  // );

  for (const wager of wagers) {
    // Determine the correct fair probability for this specific wager outcome
    let effectiveFairProb: number;

    if (wager.outcome === 1) {
      effectiveFairProb = closingFairProb1;
    } else {
      // Outcome 2
      if (closingFairProb2 !== undefined) {
        // Use explicit probability if available (supports 3-way markets)
        effectiveFairProb = closingFairProb2;
      } else {
        // Fallback to standard binary inversion (safe for spreads/totals/2-way ML)
        effectiveFairProb = 1 - closingFairProb1;
      }
    }

    const clv = (effectiveFairProb - Number(wager.price)) / effectiveFairProb;

    const { error: updateError } = await supabase
      .from("wagers")
      .update({
        closing_fair_prob: effectiveFairProb,
        clv: clv,
      })
      .eq("id", wager.id);

    if (updateError) {
      console.error(
        `❌ Error updating CLV for wager ${wager.id}:`,
        updateError.message,
      );
    }
  }
}
