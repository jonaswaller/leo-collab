/**
 * Polymarket Sports Market Discovery
 *
 * Fetches and filters upcoming sports markets from Polymarket Gamma API.
 * Refactored from scripts/fetch-upcoming-sports.ts to be reusable in a loop.
 */

import axios from "axios";
import {
  SportMetadata,
  GammaEvent,
  GammaMarket,
  PolymarketMarket,
  MarketType,
} from "./types.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

const MIN_LIQUIDITY = 0;
const HOURS_AHEAD = 12;
const MAX_CONCURRENT = 20; // Process 20 at a time
const REQUEST_DELAY_MS = 100; // 100ms between request batches = 10 req/s sustained

// Create dedicated axios instance for Gamma API with optimized settings
const axGamma = axios.create({
  baseURL: "https://gamma-api.polymarket.com",
  timeout: 10000,
  // Enable HTTP keep-alive for connection reuse
  headers: {
    Connection: "keep-alive",
  },
});

// Cache for sports metadata (rarely changes)
let sportsMetadataCache: SportMetadata[] | null = null;

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

function detectMarketType(question: string): MarketType {
  const q = question.toLowerCase();

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

  if (
    q.includes("player") ||
    q.includes("points") ||
    q.includes("assists") ||
    q.includes("rebounds")
  ) {
    return "player_props";
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

function detectSportFromEvent(
  event: GammaEvent,
  fallbackSport: string,
): string {
  // PRIORITY 1: Check event slug for sport indicators (most reliable for international competitions)
  if (event.slug) {
    const slug = event.slug.toLowerCase();

    // FIFA World Cup Qualifiers (various prefixes)
    if (
      slug.includes("uef-") ||
      slug.includes("uefa-") ||
      slug.startsWith("fif-")
    ) {
      return "wcq_europe"; // UEFA/FIFA World Cup Qualifiers - Europe
    }
    if (slug.includes("conmebol-") || slug.includes("wcq-sa")) {
      return "wcq_south_america"; // CONMEBOL World Cup Qualifiers
    }

    // CONCACAF competitions (cof- prefix or concacaf/cnl in slug)
    if (
      slug.startsWith("cof-") ||
      slug.includes("concacaf-") ||
      slug.includes("cnl-")
    ) {
      return "concacaf"; // CONCACAF Nations League / Gold Cup
    }
  }

  // PRIORITY 2: Use category if available
  if (event.category) {
    const cat = event.category.toLowerCase();
    if (cat.includes("hockey") || cat.includes("nhl")) return "nhl";
    if (cat.includes("basketball") && cat.includes("college")) return "ncaab";
    if (cat.includes("basketball") && cat.includes("nba")) return "nba";
    if (cat.includes("football") && cat.includes("college")) return "cfb";
    if (cat.includes("football") && cat.includes("nfl")) return "nfl";
    if (cat.includes("baseball")) return "mlb";
  }

  if (event.tags && event.tags.length > 0) {
    const tagIds = event.tags.map((t) => t.id);

    // Sport-specific tag IDs
    if (tagIds.includes("899")) return "nhl";
    if (tagIds.includes("745")) return "nba";
    if (tagIds.includes("450")) return "nfl";
    if (tagIds.includes("100381")) return "mlb";
    if (tagIds.includes("100351")) return "cfb";
    if (tagIds.includes("100149")) return "ncaab";
    if (tagIds.includes("101178")) return "cbb";
    if (tagIds.includes("100254")) return "wnba";

    // Soccer leagues
    if (tagIds.includes("82")) return "epl";
    if (tagIds.includes("780")) return "lal";
    if (tagIds.includes("1494")) return "bun";
    if (tagIds.includes("306")) return "epl";
    if (tagIds.includes("102070")) return "fl1";
    if (tagIds.includes("101962")) return "sea";
    if (tagIds.includes("101735")) return "ere";
    if (tagIds.includes("100100")) return "mls";
    if (tagIds.includes("102448")) return "mex";
    if (tagIds.includes("102561")) return "arg";
    if (tagIds.includes("100977")) return "ucl";
    if (tagIds.includes("101787")) return "uel";

    // Cricket
    if (tagIds.includes("101977")) return "ipl";
    if (tagIds.includes("102815")) return "odi";
    if (tagIds.includes("102810")) return "t20";

    // MMA
    if (
      tagIds.includes("100639") &&
      (event.title || "").toLowerCase().includes("ufc")
    ) {
      return "mma";
    }
  }

  return fallbackSport;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

async function getSportsMetadata(): Promise<SportMetadata[]> {
  // Return cached data if available
  if (sportsMetadataCache) {
    return sportsMetadataCache;
  }

  const { data } = await axGamma.get<SportMetadata[]>("/sports");
  sportsMetadataCache = data; // Cache for future calls
  return data;
}

async function fetchEventsForSport(
  tagId: string,
  startMin: string,
  startMax: string,
): Promise<GammaEvent[]> {
  try {
    const { data } = await axGamma.get<GammaEvent[]>("/events", {
      params: {
        tag_id: tagId,
        closed: false,
        limit: 100,
        include_tag: true,
      },
    });
    return data || [];
  } catch (error: any) {
    // Silently handle errors for individual tags (some may have no events)
    if (error.response?.status !== 404) {
      console.warn(
        `[Discovery] Warning: Error fetching events for tag ${tagId}`,
      );
    }
    return [];
  }
}

/**
 * Process requests with intelligent throttling
 * Uses a sliding window approach to maximize throughput while respecting rate limits
 */
async function processWithThrottling(
  requests: Array<{ sport: SportMetadata; tagId: string }>,
  startMin: string,
  startMax: string,
): Promise<Array<{ sport: SportMetadata; events: GammaEvent[] }>> {
  const results: Array<{ sport: SportMetadata; events: GammaEvent[] }> = [];

  // Process in chunks of MAX_CONCURRENT
  for (let i = 0; i < requests.length; i += MAX_CONCURRENT) {
    const chunk = requests.slice(i, i + MAX_CONCURRENT);

    const chunkPromises = chunk.map(async ({ sport, tagId }) => {
      const events = await fetchEventsForSport(tagId, startMin, startMax);
      return { sport, tagId, events };
    });

    const chunkResults = await Promise.allSettled(chunkPromises);

    const successfulResults = chunkResults
      .filter((r) => r.status === "fulfilled")
      .map(
        (r) =>
          (
            r as PromiseFulfilledResult<{
              sport: SportMetadata;
              tagId: string;
              events: GammaEvent[];
            }>
          ).value,
      )
      .filter((r) => r.events.length > 0);

    results.push(...successfulResults);

    // Small delay between chunks to avoid rate limiting
    if (i + MAX_CONCURRENT < requests.length) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  return results;
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

  const startMin = now.toISOString();
  const startMax = windowEnd.toISOString();

  // Step 1: Get all sports metadata
  const sports = await getSportsMetadata();

  // Step 2: Build list of all (sport, tagId) pairs
  const requests: Array<{ sport: SportMetadata; tagId: string }> = [];
  for (const sport of sports) {
    const tagIds = sport.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    for (const tagId of tagIds) {
      requests.push({ sport, tagId });
    }
  }

  // Step 3: Process all requests with intelligent throttling
  const allResults = await processWithThrottling(requests, startMin, startMax);

  // Step 4: Extract and filter markets from events
  const allMarkets: PolymarketMarket[] = [];
  const SUPPORTED_SPORTS = [
    "nfl",
    "cfb",
    "nba",
    "ncaab",
    "cbb",
    "wnba",
    "nhl",
    "mlb",
    "epl",
    "lal",
    "sea",
    "bun",
    "fl1",
    "ere",
    "mls",
    "mex",
    "arg",
    "ucl",
    "uel",
    "wcq_europe", // FIFA World Cup Qualifiers - Europe (UEFA)
    "wcq_south_america", // FIFA World Cup Qualifiers - South America (CONMEBOL)
    "concacaf", // CONCACAF Nations League
    "ipl",
    "odi",
    "t20",
    "mma",
  ];

  for (const { sport, events } of allResults) {
    for (const event of events) {
      if (!event.markets || event.markets.length === 0) continue;

      const eventStartTime = extractStartTime(event, undefined);

      // Skip events with no valid start time or outside time window
      if (
        !eventStartTime ||
        !isWithinTimeWindow(eventStartTime, now, windowEnd)
      ) {
        continue;
      }

      // Detect the actual sport from event metadata
      const actualSport = detectSportFromEvent(event, sport.sport);

      // Skip unsupported sports
      if (!SUPPORTED_SPORTS.includes(actualSport)) continue;

      for (const market of event.markets) {
        // Skip closed/inactive markets
        if (market.closed || market.active === false) continue;

        // Skip markets with no orders in the order book
        const hasBid =
          market.bestBid !== null &&
          market.bestBid !== undefined &&
          market.bestBid !== 0;
        const hasAsk =
          market.bestAsk !== null &&
          market.bestAsk !== undefined &&
          market.bestAsk !== 0;

        if (!hasBid && !hasAsk) continue;

        // Calculate liquidity
        const liquidity = calculateLiquidity(market);

        // Filter by minimum liquidity
        if (liquidity < MIN_LIQUIDITY) continue;

        // Filter out phantom markets (extreme spreads)
        const hasBidAsk =
          market.bestBid !== null &&
          market.bestBid !== undefined &&
          market.bestAsk !== null &&
          market.bestAsk !== undefined;

        if (hasBidAsk) {
          const spread = market.bestAsk! - market.bestBid!;

          if (spread > 0.9 || (liquidity === 0 && spread > 0.5)) {
            continue;
          }

          if (market.bestBid! < 0.02 && market.bestAsk! > 0.98) {
            continue;
          }
        }

        // Get start time
        const startTime = extractStartTime(event, market) || eventStartTime;

        const eventTitle = event.title || "Unknown Event";
        const marketQuestion = market.question || "Unknown Market";
        const { homeTeam, awayTeam } = parseTeamNames(eventTitle);
        const marketType = detectMarketType(marketQuestion);

        // Skip team totals (we don't want to analyze these)
        if (marketQuestion.toLowerCase().includes("team total")) {
          continue;
        }

        const polymarketMarket: PolymarketMarket = {
          sport: actualSport,
          eventTitle,
          startTime: startTime.toISOString(),
          marketQuestion,
          marketType,
          liquidity,
        };

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
