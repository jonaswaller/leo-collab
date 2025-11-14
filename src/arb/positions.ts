import axios from "axios";
import { OpenOrder, OpenOrderParams } from "@polymarket/clob-client";
import { PolymarketMarket } from "./types.js";
import { getClobClient } from "./clob.js";
import { ExposureSnapshot } from "./calculator.js";

const DATA_API_BASE =
  process.env.POLYMARKET_DATA_API_URL?.trim() ||
  "https://data-api.polymarket.com";

/**
 * Fetch open orders for the configured account using the CLOB `/data/orders` endpoint.
 *
 * By default this only fetches the first page (`only_first_page = true`) to avoid
 * crawling large histories. Callers can pass `OpenOrderParams` to filter by market
 * or asset.
 */
export async function fetchOpenOrders(
  params?: OpenOrderParams,
): Promise<OpenOrder[]> {
  const client = await getClobClient();
  const orders = await client.getOpenOrders(params, true);
  return orders;
}

/**
 * Raw position shape from Polymarket Data API `/positions`.
 * Based on actual API response fields.
 */
export interface RawPosition {
  asset: string; // Token ID
  conditionId: string;
  size: number; // Number of shares held
  avgPrice: number; // Average entry price per share
  currentValue: number; // Current market value in USD (size * current_price)
  curPrice: number; // Current market price per share
  slug?: string; // Market slug (for reference)
  [key: string]: unknown; // Allow other fields
}

function getUserAddress(): string {
  const addr = process.env.POLY_PROXY_WALLET;
  if (!addr || addr.trim() === "") {
    throw new Error("Missing POLY_PROXY_WALLET env var for positions lookup");
  }
  return addr.trim();
}

/**
 * Fetch current positions for the configured user from Polymarket Data API.
 *
 * This corresponds to the "Positions" tab in the Polymarket UI and should
 * match your active holdings (shares) rather than open orders.
 */
export async function fetchCurrentPositions(
  userAddress?: string,
): Promise<RawPosition[]> {
  const user =
    userAddress && userAddress.trim() !== ""
      ? userAddress.trim()
      : getUserAddress();

  const { data } = await axios.get<RawPosition[]>(
    `${DATA_API_BASE}/positions`,
    {
      params: { user },
    },
  );

  return data;
}

// ============================================================================
// POSITION ENRICHMENT (Gamma + Positions)
// ============================================================================

export interface EnrichedPosition {
  // Identification
  conditionId: string;
  tokenId: string;

  // Market context from Gamma
  sport?: string | undefined;
  marketSlug?: string | undefined;
  eventSlug?: string | undefined;
  outcomeName?: string | undefined;

  // Position details
  shares: number;
  avgEntryPrice: number;
  currentMarketPrice: number;
  currentValueUSD: number;
  unrealizedPnL: number;
}

/**
 * Build a lookup from conditionId to Polymarket markets.
 * Some conditionIds can theoretically map to multiple markets; we just take the first.
 */
function indexMarketsByConditionId(
  markets: PolymarketMarket[],
): Map<string, PolymarketMarket> {
  const map = new Map<string, PolymarketMarket>();
  for (const m of markets) {
    if (m.conditionId && !map.has(m.conditionId)) {
      map.set(m.conditionId, m);
    }
  }
  return map;
}

/**
 * Enrich raw positions with Gamma metadata (slug, sport, outcome names).
 *
 * This glue is what lets us tie the account-level positions (Data API) back
 * into the markets we discovered from Gamma.
 *
 * NOTE: Positions in closed/non-sports markets won't match and will have
 * undefined metadata, but we still include them for capital tracking.
 */
export function buildEnrichedPositions(
  markets: PolymarketMarket[],
  rawPositions: RawPosition[],
): EnrichedPosition[] {
  const byCondition = indexMarketsByConditionId(markets);
  const enriched: EnrichedPosition[] = [];

  for (const raw of rawPositions) {
    const conditionId = raw.conditionId;
    const tokenId = raw.asset;
    if (!conditionId || !tokenId) continue;

    const market = byCondition.get(conditionId);

    let outcomeName: string | undefined;
    let sport: string | undefined;
    let marketSlug: string | undefined;
    let eventSlug: string | undefined;
    let currentMarketPrice = raw.curPrice || 0;

    if (market) {
      sport = market.sport;
      marketSlug = market.marketSlug;
      eventSlug = market.eventSlug;

      if (market.clobTokenIds && market.clobTokenIds.length >= 2) {
        const idx = market.clobTokenIds.indexOf(tokenId);
        if (idx === 0) {
          outcomeName = market.outcome1Name;
          // Use Gamma price if available (lastPrice or bestAsk), otherwise use Data API price
          currentMarketPrice =
            market.lastPrice || market.bestAsk || currentMarketPrice;
        } else if (idx === 1) {
          outcomeName = market.outcome2Name;
          // Use Gamma price if available (outcome2Ask), otherwise use Data API price
          currentMarketPrice = market.outcome2Ask || currentMarketPrice;
        }
      }
    }

    const shares = raw.size || 0;
    const avgEntryPrice = raw.avgPrice || 0;
    const currentValueUSD = raw.currentValue || 0;
    const unrealizedPnL = (currentMarketPrice - avgEntryPrice) * shares;

    // Include all positions with shares > 0
    if (shares === 0) continue;

    enriched.push({
      conditionId,
      tokenId,
      sport,
      marketSlug,
      eventSlug,
      outcomeName,
      shares,
      avgEntryPrice,
      currentMarketPrice,
      currentValueUSD,
      unrealizedPnL,
    });
  }

  return enriched;
}

// ============================================================================
// EXPOSURE SNAPSHOTS FOR KELLY SIZING
// ============================================================================

/**
 * Build ExposureSnapshot objects (in USD) from current positions + Gamma markets.
 *
 * This is the glue between account-level positions and the Kelly engine:
 * - marketKey: we prefer the Polymarket market slug if available
 * - eventKey: we prefer the Polymarket event slug if available
 * - exposureUSD: current market value of the position
 */
export function buildExposureSnapshotsFromPositions(
  markets: PolymarketMarket[],
  rawPositions: RawPosition[],
): ExposureSnapshot[] {
  const enriched = buildEnrichedPositions(markets, rawPositions);
  const snapshots: ExposureSnapshot[] = [];

  for (const p of enriched) {
    // Skip zero-valued positions defensively
    if (!Number.isFinite(p.currentValueUSD) || p.currentValueUSD <= 0) continue;

    const marketKey =
      p.marketSlug ||
      (p.eventSlug ? `${p.eventSlug}:${p.conditionId}` : p.conditionId);

    const eventKey = p.eventSlug || p.marketSlug || p.conditionId;

    snapshots.push({
      marketKey,
      eventKey,
      exposureUSD: p.currentValueUSD,
    });
  }

  return snapshots;
}

// ============================================================================
// CAPITAL / EXPOSURE SUMMARY
// ============================================================================

export interface CapitalSummary {
  usdcBalance: number; // Free USDC in wallet
  totalPositionValueUSD: number; // Current market value of all shares held
  totalCapitalUSD: number; // USDC + Position Value (total buying power)
  openOrderCount: number; // Number of unfilled orders (for info only)
}

/**
 * Compute capital summary for Kelly sizing and position management.
 *
 * Key insights from Polymarket mechanics:
 * 1. Open orders DO NOT lock capital - they're just limit orders on the book
 * 2. Position value ADDS to your capital - shares have market value you can sell
 * 3. Total capital = USDC Balance + Position Market Value
 *
 * This is different from traditional exchanges where limit orders lock collateral.
 */
export function computeCapitalSummary(
  usdcBalance: number,
  rawPositions: RawPosition[],
  openOrders: OpenOrder[],
): CapitalSummary {
  // Sum current market value of all positions
  const totalPositionValueUSD = rawPositions.reduce(
    (sum, p) => sum + (Number(p.currentValue) || 0),
    0,
  );

  // Total capital is USDC + position value (both are liquid)
  const totalCapitalUSD = usdcBalance + totalPositionValueUSD;

  return {
    usdcBalance,
    totalPositionValueUSD,
    totalCapitalUSD,
    openOrderCount: openOrders.length,
  };
}
