/**
 * Polymarket Sports Market Discovery
 *
 * Fetches and filters upcoming sports markets from Polymarket Gamma API.
 * Refactored from scripts/fetch-upcoming-sports.ts to be reusable in a loop.
 */

import axios from "axios";
import {
  GammaEvent,
  GammaMarket,
  PolymarketMarket,
  MarketType,
} from "./types.js";
import { HOURS_AHEAD } from "./config.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

const MIN_LIQUIDITY = 0;
const MAX_CONCURRENT = 5; // Process 5 at a time to limit memory usage
const REQUEST_DELAY_MS = 100; // 100ms between request batches

// Single source of truth: sport code → Gamma tag IDs
const SPORT_TAG_MAP: Record<string, string[]> = {
  // US major leagues
  nhl: ["899"],
  nba: ["745"],
  nfl: ["450"],
  mlb: ["100381"],
  cfb: ["100351"],
  ncaab: ["100149"],
  cbb: ["101178"],
  wnba: ["100254"],
  // Soccer
  epl: ["82", "306"],
  lal: ["780"],
  bun: ["1494"],
  fl1: ["102070"],
  sea: ["101962"],
  ere: ["101735"],
  mls: ["100100"],
  mex: ["102448"],
  arg: ["102561"],
  ucl: ["100977"],
  uel: ["101787"],
  // Cricket
  ipl: ["101977"],
  odi: ["102815"],
  t20: ["102810"],
  // MMA
  mma: ["100639"],
};

// Create dedicated axios instance for Gamma API with optimized settings
const axGamma = axios.create({
  baseURL: "https://gamma-api.polymarket.com",
  timeout: 10000,
  headers: {
    Connection: "keep-alive",
  },
});

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function calculateLiquidity(market: GammaMarket): number {
  if (typeof market.liquidityNum === "number" && market.liquidityNum > 0) {
    return market.liquidityNum;
  }

  const clobLiq = market.liquidityClob || 0;
  const ammLiq = market.liquidityAmm || 0;
  if (clobLiq + ammLiq > 0) {
    return clobLiq + ammLiq;
  }

  if (market.liquidity) {
    const parsed = parseFloat(market.liquidity);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 0;
}

function extractStartTime(
  event: GammaEvent,
  market?: GammaMarket,
): Date | null {
  if (event.startTime) {
    const date = new Date(event.startTime);
    if (!isNaN(date.getTime())) return date;
  }

  if (market?.gameStartTime) {
    const date = new Date(market.gameStartTime);
    if (!isNaN(date.getTime())) return date;
  }

  if (market?.eventStartTime) {
    const date = new Date(market.eventStartTime);
    if (!isNaN(date.getTime())) return date;
  }

  if (event.eventDate) {
    const date = new Date(event.eventDate);
    if (!isNaN(date.getTime())) return date;
  }

  if (event.startDate) {
    const date = new Date(event.startDate);
    if (!isNaN(date.getTime())) return date;
  }

  return null;
}

function isWithinTimeWindow(
  startTime: Date,
  windowStart: Date,
  windowEnd: Date,
): boolean {
  return startTime >= windowStart && startTime <= windowEnd;
}

function parseTeamNames(eventTitle: string): {
  homeTeam?: string;
  awayTeam?: string;
} {
  const separators = [" vs. ", " vs ", " @ ", " v "];

  for (const sep of separators) {
    if (eventTitle.includes(sep)) {
      const parts = eventTitle.split(sep);
      if (parts.length === 2 && parts[0] && parts[1]) {
        return {
          awayTeam: parts[0].trim(),
          homeTeam: parts[1].trim(),
        };
      }
    }
  }

  return {};
}

// Player prop pattern: "Player Name: Stat O/U Line"
const PLAYER_PROP_RE = /^(.+?):\s*(Points|Rebounds|Assists|Threes|Blocks|Steals|Strikeouts|Hits|Home Runs|Total Bases|RBIs|Goals|Shots on Goal|Saves|Pass Yards|Rush Yards|Reception Yards|Receptions|Pass Attempts|Pass Completions|Pass Touchdowns|Rush Attempts|Tackles|Sacks)\s+O\/U\s+(\d+\.?\d*)/i;

function detectMarketType(question: string): MarketType {
  const q = question.toLowerCase();

  // Player props MUST be checked before totals (both contain "O/U")
  if (PLAYER_PROP_RE.test(question)) {
    return "player_props";
  }

  if (q.includes("o/u") || q.includes("over/under") || q.includes("total")) {
    return "totals";
  }

  if (
    q.includes("spread:") ||
    q.includes("spread ") ||
    /\(-\d+\.?\d*\)/.test(question) ||
    /\(\+\d+\.?\d*\)/.test(question) ||
    /[+-]\d+\.5\b/.test(question)
  ) {
    return "spreads";
  }

  if (q.includes("will") && q.includes("win")) {
    return "h2h";
  }

  if (q.includes("draw") || q.includes("tie")) {
    return "h2h";
  }

  if (q.includes("vs") || q.includes("@")) {
    return "h2h";
  }

  return "other";
}

/**
 * Parse player prop details from market question.
 * Returns { playerName, statType, line } or null if not a player prop.
 */
function parsePlayerProp(question: string): { playerName: string; statType: string; line: number } | null {
  const match = PLAYER_PROP_RE.exec(question);
  if (!match) return null;
  return {
    playerName: match[1]!.trim(),
    statType: match[2]!.toLowerCase(),
    line: parseFloat(match[3]!),
  };
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

async function fetchEventsForTag(tagId: string): Promise<GammaEvent[]> {
  try {
    const { data } = await axGamma.get<GammaEvent[]>("/events", {
      params: {
        tag_id: tagId,
        closed: false,
        active: true,
        limit: 100,
        include_tag: true,
      },
    });
    return data || [];
  } catch (error: any) {
    if (error.response?.status !== 404) {
      console.warn(
        `[Discovery] Warning: Error fetching events for tag ${tagId}`,
      );
    }
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// MAIN DISCOVERY FUNCTION
// ============================================================================

export async function discoverPolymarkets(): Promise<PolymarketMarket[]> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + HOURS_AHEAD * 60 * 60 * 1000);

  // Build flat list of { sport, tagId } from SPORT_TAG_MAP
  const requests: Array<{ sport: string; tagId: string }> = [];
  for (const [sport, tagIds] of Object.entries(SPORT_TAG_MAP)) {
    for (const tagId of tagIds) {
      requests.push({ sport, tagId });
    }
  }
  console.log(
    `[Discovery] Fetching ${requests.length} tags for ${Object.keys(SPORT_TAG_MAP).length} sports`,
  );

  // Fetch events with throttling
  const allResults: Array<{ sport: string; events: GammaEvent[] }> = [];
  for (let i = 0; i < requests.length; i += MAX_CONCURRENT) {
    const chunk = requests.slice(i, i + MAX_CONCURRENT);

    const chunkResults = await Promise.allSettled(
      chunk.map(async ({ sport, tagId }) => {
        const events = await fetchEventsForTag(tagId);
        return { sport, events };
      }),
    );

    for (const r of chunkResults) {
      if (r.status === "fulfilled" && r.value.events.length > 0) {
        allResults.push(r.value);
      }
    }

    if (i + MAX_CONCURRENT < requests.length) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log(
    `[Discovery] Got events from ${allResults.length}/${requests.length} tags`,
  );

  // Extract and filter markets from events
  const allMarkets: PolymarketMarket[] = [];

  let totalEvents = 0;
  let noMarketsCount = 0;
  let noStartTimeCount = 0;
  let outsideWindowCount = 0;
  let closedCount = 0;
  let noBidAskCount = 0;
  let lowLiquidityCount = 0;
  let phantomCount = 0;
  let playerPropCount = 0;

  for (const { sport, events } of allResults) {
    for (const event of events) {
      totalEvents++;
      if (!event.markets || event.markets.length === 0) {
        noMarketsCount++;
        continue;
      }

      const eventStartTime = extractStartTime(event, undefined);

      if (!eventStartTime) {
        noStartTimeCount++;
        continue;
      }
      if (!isWithinTimeWindow(eventStartTime, now, windowEnd)) {
        outsideWindowCount++;
        continue;
      }

      for (const market of event.markets) {
        // Skip closed/inactive markets
        if (market.closed || market.active === false) {
          closedCount++;
          continue;
        }

        // Skip markets with no orders in the order book
        const hasBid =
          market.bestBid !== null &&
          market.bestBid !== undefined &&
          market.bestBid !== 0;
        const hasAsk =
          market.bestAsk !== null &&
          market.bestAsk !== undefined &&
          market.bestAsk !== 0;

        if (!hasBid && !hasAsk) {
          noBidAskCount++;
          continue;
        }

        // Calculate liquidity
        const liquidity = calculateLiquidity(market);

        // Filter by minimum liquidity
        if (liquidity < MIN_LIQUIDITY) {
          lowLiquidityCount++;
          continue;
        }

        // Filter out phantom markets (extreme spreads)
        const hasBidAsk =
          market.bestBid !== null &&
          market.bestBid !== undefined &&
          market.bestAsk !== null &&
          market.bestAsk !== undefined;

        if (hasBidAsk) {
          const spread = market.bestAsk! - market.bestBid!;

          if (spread > 0.9 || (liquidity === 0 && spread > 0.5)) {
            phantomCount++;
            continue;
          }

          if (market.bestBid! < 0.02 && market.bestAsk! > 0.98) {
            phantomCount++;
            continue;
          }
        }

        // Get start time
        const startTime = extractStartTime(event, market) || eventStartTime;

        const eventTitle = event.title || "Unknown Event";
        const marketQuestion = market.question || "Unknown Market";
        const { homeTeam, awayTeam } = parseTeamNames(eventTitle);
        const marketType = detectMarketType(marketQuestion);

        // Skip team totals only (player props are now supported)
        const qLower = marketQuestion.toLowerCase();
        if (qLower.includes("team total")) {
          playerPropCount++;
          continue;
        }

        const polymarketMarket: PolymarketMarket = {
          sport,
          eventTitle,
          startTime: startTime.toISOString(),
          marketQuestion,
          marketType,
          liquidity,
        };

        // Add player prop fields
        if (marketType === "player_props") {
          const propData = parsePlayerProp(marketQuestion);
          if (propData) {
            polymarketMarket.playerName = propData.playerName;
            polymarketMarket.playerStatType = propData.statType;
            polymarketMarket.playerLine = propData.line;
          }
        }

        // Add optional fields
        if (homeTeam) polymarketMarket.homeTeam = homeTeam;
        if (awayTeam) polymarketMarket.awayTeam = awayTeam;
        if (event.slug) polymarketMarket.eventSlug = event.slug;
        if (market.slug) polymarketMarket.marketSlug = market.slug;

        // Parse outcome names
        let outcomes: string[] = [];
        try {
          if (market.outcomes) {
            outcomes = JSON.parse(market.outcomes);
          }
        } catch {
          outcomes = ["Yes", "No"];
        }

        if (outcomes.length >= 2) {
          if (outcomes[0]) polymarketMarket.outcome1Name = outcomes[0];
          if (outcomes[1]) polymarketMarket.outcome2Name = outcomes[1];
        }

        // Add price data
        if (market.bestBid !== null && market.bestBid !== undefined) {
          polymarketMarket.bestBid = market.bestBid;
        }
        if (market.bestAsk !== null && market.bestAsk !== undefined) {
          polymarketMarket.bestAsk = market.bestAsk;
        }
        if (
          market.lastTradePrice !== null &&
          market.lastTradePrice !== undefined
        ) {
          polymarketMarket.lastPrice = market.lastTradePrice;
        }

        // Calculate complement prices (Outcome 2)
        if (
          polymarketMarket.bestBid !== undefined &&
          polymarketMarket.bestAsk !== undefined
        ) {
          polymarketMarket.outcome2Bid = 1 - polymarketMarket.bestAsk;
          polymarketMarket.outcome2Ask = 1 - polymarketMarket.bestBid;
        }

        // Extract CLOB trading metadata (CRITICAL for order execution)
        // Parse clobTokenIds from stringified JSON array
        if (market.clobTokenIds) {
          try {
            const tokenIds = JSON.parse(market.clobTokenIds);
            if (Array.isArray(tokenIds) && tokenIds.length >= 2) {
              polymarketMarket.clobTokenIds = tokenIds;
            }
          } catch (error) {
            // If parsing fails, log warning but continue
            console.warn(
              `[Discovery] Failed to parse clobTokenIds for market ${market.slug}: ${market.clobTokenIds}`,
            );
          }
        }

        // Add condition ID (required for some CLOB operations)
        if (market.conditionId) {
          polymarketMarket.conditionId = market.conditionId;
        }

        // Add neg-risk status (affects order execution)
        if (market.negRisk !== null && market.negRisk !== undefined) {
          polymarketMarket.negRisk = market.negRisk;
        }

        // Add tick size (minimum price increment)
        if (
          market.orderPriceMinTickSize !== null &&
          market.orderPriceMinTickSize !== undefined
        ) {
          polymarketMarket.tickSize = market.orderPriceMinTickSize;
        }

        // Add minimum order size (minimum shares per order)
        if (market.orderMinSize !== null && market.orderMinSize !== undefined) {
          polymarketMarket.minOrderSize = market.orderMinSize;
        }

        allMarkets.push(polymarketMarket);
      }
    }
  }

  console.log(`[Discovery] Filter funnel:`);
  console.log(`  Total events: ${totalEvents}`);
  console.log(`  Filtered — no markets: ${noMarketsCount}`);
  console.log(`  Filtered — no start time: ${noStartTimeCount}`);
  console.log(
    `  Filtered — outside window (${HOURS_AHEAD}h): ${outsideWindowCount}`,
  );
  console.log(`  Filtered — closed/inactive: ${closedCount}`);
  console.log(`  Filtered — no bid/ask: ${noBidAskCount}`);
  console.log(`  Filtered — low liquidity: ${lowLiquidityCount}`);
  console.log(`  Filtered — phantom spread: ${phantomCount}`);
  console.log(`  Filtered — player props: ${playerPropCount}`);
  console.log(`  Passed all filters: ${allMarkets.length}`);

  // Deduplicate markets by unique key
  const seen = new Set<string>();
  const uniqueMarkets = allMarkets.filter((market) => {
    const key = market.marketSlug
      ? `market:${market.marketSlug}`
      : `${market.eventSlug || market.eventTitle}:${market.marketQuestion}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return uniqueMarkets;
}
