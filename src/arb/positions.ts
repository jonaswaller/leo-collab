import axios from "axios";
import { OpenOrder, OpenOrderParams } from "@polymarket/clob-client";
import { PolymarketMarket } from "./types.js";
import { getClobClient } from "./clob.js";

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
 * This is intentionally loose; we only depend on a few core fields downstream.
 */
export interface RawPosition {
  market: string;
  asset: string;
  conditionId: string;
  balance: string;
  avgPrice: string;
  value: string;
  [key: string]: unknown;
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
  currentValueUSD: number;
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

    if (market) {
      sport = market.sport;
      marketSlug = market.marketSlug;
      eventSlug = market.eventSlug;

      if (market.clobTokenIds && market.clobTokenIds.length >= 2) {
        const idx = market.clobTokenIds.indexOf(tokenId);
        if (idx === 0) outcomeName = market.outcome1Name;
        else if (idx === 1) outcomeName = market.outcome2Name;
      }
    }

    const shares = Number(raw.balance) || 0;
    const avgEntryPrice = Number(raw.avgPrice) || 0;
    const currentValueUSD =
      Number(raw.value) ||
      (shares > 0 && avgEntryPrice > 0 ? shares * avgEntryPrice : 0);

    // Ignore truly empty positions
    if (shares === 0 && currentValueUSD === 0) continue;

    enriched.push({
      conditionId,
      tokenId,
      sport,
      marketSlug,
      eventSlug,
      outcomeName,
      shares,
      avgEntryPrice,
      currentValueUSD,
    });
  }

  return enriched;
}

// ============================================================================
// CAPITAL / EXPOSURE SUMMARY (uses CLOB + positions)
// ============================================================================

export interface CapitalUsage {
  totalPositionValueUSD: number;
  totalOpenOrderExposureUSD: number;
  availableCapitalUSD: number;
}

/**
 * Compute capital usage given wallet balance (USDC), enriched positions, and open orders.
 *
 * - Position value is taken directly from the position `currentValueUSD` field.
 * - Open-order exposure is approximated as remaining BUY size * price; SELL orders
 *   do not consume USDC and are treated as zero capital usage.
 */
export function computeCapitalUsage(
  walletBalanceUSD: number,
  positions: EnrichedPosition[],
  openOrders: OpenOrder[],
): CapitalUsage {
  const totalPositionValueUSD = positions.reduce(
    (sum, p) =>
      sum + (Number.isFinite(p.currentValueUSD) ? p.currentValueUSD : 0),
    0,
  );

  let totalOpenOrderExposureUSD = 0;
  for (const o of openOrders) {
    const size = Number(o.original_size);
    const matched = Number(o.size_matched);
    const price = Number(o.price);

    if (
      !Number.isFinite(size) ||
      !Number.isFinite(matched) ||
      !Number.isFinite(price)
    ) {
      continue;
    }

    const remaining = Math.max(0, size - matched);

    // BUY orders lock USDC; SELL orders lock shares (we ignore those in USD terms here).
    if (o.side === "BUY") {
      totalOpenOrderExposureUSD += remaining * price;
    }
  }

  const used = totalPositionValueUSD + totalOpenOrderExposureUSD;
  const availableCapitalUSD = Math.max(0, walletBalanceUSD - used);

  return {
    totalPositionValueUSD,
    totalOpenOrderExposureUSD,
    availableCapitalUSD,
  };
}
