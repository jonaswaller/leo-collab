import { axClob } from "./http.js";

export type BookResponse = {
  market: string; // conditionId
  asset_id: string; // token_id echoed
  min_order_size: string; // e.g. "0.01"
  tick_size: string; // e.g. "0.001"
  neg_risk: boolean;
};

// Constraint cache to avoid /book calls on hot path
const cache = new Map<
  string,
  { tickSize: number; minOrder: number; negRisk: boolean; t: number }
>();
const TTL_MS = 60_000; // 1 minute cache

export async function getConstraints(tokenId: string) {
  const hit = cache.get(tokenId);
  const now = Date.now();
  if (hit && now - hit.t < TTL_MS) return hit;

  const fresh = await getBook(tokenId);
  const val = { ...fresh, t: now };
  cache.set(tokenId, val);
  return val;
}

// Update cache when tick size changes (called from WebSocket handler)
export function updateTickSize(tokenId: string, newTickSize: number) {
  const hit = cache.get(tokenId);
  if (hit) {
    hit.tickSize = newTickSize;
    hit.t = Date.now(); // Refresh timestamp
    console.log(`[CACHE] Updated tick size for ${tokenId}: ${newTickSize}`);
  }
}

export async function getBook(tokenId: string) {
  const { data } = await axClob.get<BookResponse>("/book", {
    params: { token_id: tokenId },
  });
  return {
    tickSize: Number(data.tick_size),
    minOrder: Number(data.min_order_size),
    negRisk: Boolean(data.neg_risk),
  };
}

export function roundToTick(px: number, tick: number) {
  return Math.round(px / tick) * tick;
}
