import type { OrderBookSummary } from "@polymarket/clob-client";
import { getClobClient } from "./clob.js";
import type { PolymarketMarket } from "./types.js";

export interface BestPrices {
  bestBid: number | null;
  bestAsk: number | null;
}

/**
 * Fetch best bid/ask for a set of tokenIds from the CLOB orderbook.
 *
 * Uses one getOrderBook call per tokenId. This is acceptable because the number
 * of tracked maker orders / markets is moderate. If this ever grows large we
 * can migrate to batched getOrderBooks.
 */
export async function fetchBestPricesForTokens(
  tokenIds: string[],
): Promise<Map<string, BestPrices>> {
  const unique = Array.from(new Set(tokenIds)).filter(Boolean);
  const result = new Map<string, BestPrices>();

  if (unique.length === 0) {
    return result;
  }

  const client = await getClobClient();

  for (const tokenId of unique) {
    try {
      const book: OrderBookSummary = await client.getOrderBook(tokenId);

      let bestBid: number | null = null;
      let bestAsk: number | null = null;

      if (book.bids && book.bids.length > 0) {
        bestBid = Math.max(...book.bids.map((b) => parseFloat(b.price ?? "0")));
      }
      if (book.asks && book.asks.length > 0) {
        bestAsk = Math.min(...book.asks.map((a) => parseFloat(a.price ?? "0")));
      }

      result.set(tokenId, { bestBid, bestAsk });
    } catch {
      // If we cannot fetch the orderbook for this token, just skip it.
      // Callers will decide how to handle missing CLOB prices.
      continue;
    }
  }

  return result;
}

/**
 * Enrich Polymarket markets with fresh bestBid/bestAsk from the CLOB.
 *
 * We:
 * - Use clobTokenIds[0] (outcome 1 asset) as the canonical price source.
 * - Set:
 *     bestBid, bestAsk from that asset's orderbook
 *     outcome2Bid = 1 - bestAsk (complement)
 *     outcome2Ask = 1 - bestBid (complement)
 *
 * This replaces Gamma's bestBid/bestAsk/outcome2* prices so all downstream
 * logic (analyzer, positions, etc.) uses live CLOB prices instead.
 */
export async function enrichMarketsWithClobQuotes(
  markets: PolymarketMarket[],
): Promise<PolymarketMarket[]> {
  // Collect outcome-1 tokenIds (index 0 of clobTokenIds) for all markets.
  const tokenIds: string[] = [];
  for (const m of markets) {
    if (m.clobTokenIds && m.clobTokenIds.length > 0) {
      tokenIds.push(m.clobTokenIds[0]!);
    }
  }

  const bestPriceMap = await fetchBestPricesForTokens(tokenIds);

  for (const market of markets) {
    if (!market.clobTokenIds || market.clobTokenIds.length === 0) {
      continue;
    }

    const outcome1TokenId = market.clobTokenIds[0]!;
    const prices = bestPriceMap.get(outcome1TokenId);
    if (!prices) continue;

    const { bestBid, bestAsk } = prices;

    // Update outcome 1 prices
    if (bestBid !== null) {
      market.bestBid = bestBid;
    }
    if (bestAsk !== null) {
      market.bestAsk = bestAsk;
    }

    // Derive outcome 2 complement prices when both sides exist
    if (bestBid !== null && bestAsk !== null) {
      market.outcome2Bid = 1 - bestAsk;
      market.outcome2Ask = 1 - bestBid;
    }
  }

  return markets;
}
