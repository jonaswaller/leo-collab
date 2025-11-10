/**
 * Polymarket Sports Market Fetcher
 *
 * Fetches and displays upcoming sports markets from Polymarket within a configurable
 * time window. Designed for sports arbitrage by providing clean, tradeable market data
 * that can be compared against sportsbook odds.
 *
 * Features:
 * - Fetches sports events and markets from Polymarket Gamma API
 * - Filters for supported sports (matching Odds API coverage)
 * - Parses team names from event titles
 * - Classifies market types (h2h, spreads, totals, player_props, other)
 * - Accurately detects sport using event category and tags
 * - Filters by minimum liquidity threshold (configurable via MIN_LIQUIDITY)
 * - **Filters out phantom markets** (markets in API but not tradeable on platform)
 * - Displays both sides of each market with bid/ask prices
 * - Implements batched API calls with rate limiting for optimal performance
 * - Provides direct Polymarket URLs for each market
 *
 * Output includes:
 * - Sport, event title, teams, start time
 * - Market question and type classification
 * - **Both outcomes** with bid/ask prices for each side
 *   - Outcome 1: Primary outcome (e.g., Team A, Over, Yes)
 *   - Outcome 2: Complement outcome (e.g., Team B, Under, No)
 * - Bid/Ask prices (bestBid = highest buy offer, bestAsk = lowest sell offer)
 * - Liquidity (sum of liquidityNum + liquidityClob from Gamma API)
 * - Direct links to Polymarket event and market pages
 * - Summary statistics by sport and market type
 *
 * Phantom Market Detection:
 * - Filters markets with spreads > 90% (e.g., 0.01/0.99)
 * - Filters markets with $0 liquidity AND spreads > 50%
 * - Filters markets with bid < 2% AND ask > 98%
 * - Ensures only real, tradeable markets are displayed
 *
 * Usage: npm run fetch-sports
 * Debug mode: DEBUG=true npm run fetch-sports
 */

import axios from "axios";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface SportMetadata {
  sport: string;
  image?: string;
  resolution?: string;
  ordering?: string;
  tags: string; // comma-separated tag IDs
  series?: string;
}

interface PolymarketEvent {
  id: string;
  title: string | null;
  slug: string | null;
  startDate?: string | null;
  startTime?: string | null;
  eventDate?: string | null;
  endDate?: string | null;
  closed?: boolean | null;
  active?: boolean | null;
  markets?: PolymarketMarket[];
  tags?: Array<{ id: string; label: string; slug: string }> | null;
  category?: string | null;
}

interface PolymarketMarket {
  id: string;
  question: string | null;
  slug?: string | null;
  liquidityNum?: number | null;
  liquidityClob?: number | null;
  liquidityAmm?: number | null;
  liquidity?: string | null;
  gameStartTime?: string | null;
  eventStartTime?: string | null;
  closed?: boolean | null;
  active?: boolean | null;
  // Price data
  outcomes?: string | null; // Stringified JSON array ["Team A", "Team B"]
  outcomePrices?: string | null; // Stringified JSON array
  lastTradePrice?: number | null;
  bestBid?: number | null;
  bestAsk?: number | null;
  spread?: number | null;
}

type MarketType = "h2h" | "spreads" | "totals" | "player_props" | "other";

interface MarketDisplay {
  sport: string;
  eventTitle: string;
  homeTeam?: string;
  awayTeam?: string;
  startTime: Date;
  marketQuestion: string;
  marketType: MarketType;
  liquidity: number;
  // Polymarket prices (0-1 probability scale)
  // Outcome 1 (primary - e.g., Team A, Yes, Over)
  outcome1Name?: string;
  bestBid?: number; // Outcome 1 bid
  bestAsk?: number; // Outcome 1 ask
  lastPrice?: number;
  // Outcome 2 (complement - e.g., Team B, No, Under)
  outcome2Name?: string;
  outcome2Bid?: number; // = 1 - bestAsk
  outcome2Ask?: number; // = 1 - bestBid
  eventSlug?: string;
  marketSlug?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
const MIN_LIQUIDITY = 0;
const HOURS_AHEAD = 6;
const DEBUG = process.env.DEBUG === "true";

// Rate limiting: GAMMA /events allows 100 req/10s
// We'll batch at 80 req/10s to be safe (8 concurrent requests per second)
const BATCH_SIZE = 80;
const BATCH_DELAY_MS = 10000; // 10 seconds

// Create axios instance for Gamma API
const axGamma = axios.create({
  baseURL: GAMMA_API_BASE,
  timeout: 10000,
});

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Fetch all sports metadata from Gamma API
 * Returns sports with their associated tag IDs for filtering
 */
async function getSportsMetadata(): Promise<SportMetadata[]> {
  try {
    const { data } = await axGamma.get<SportMetadata[]>("/sports");
    console.log(`✓ Fetched ${data.length} sports from Polymarket`);
    return data;
  } catch (error: any) {
    console.error("Error fetching sports metadata:", error.message);
    throw error;
  }
}

/**
 * Fetch events for a specific sport within the time window
 * NOTE: API date filtering seems unreliable, so we fetch all active events
 * and filter client-side for better accuracy
 */
async function fetchEventsForSport(
  tagId: string,
  startMin: string,
  startMax: string,
): Promise<PolymarketEvent[]> {
  try {
    // Fetch all active events for this tag
    // We'll filter by time client-side since API filtering is unreliable
    const { data } = await axGamma.get<PolymarketEvent[]>("/events", {
      params: {
        tag_id: tagId,
        closed: false,
        limit: 100,
        include_tag: true, // Include tag data to help with sport detection
        // NOTE: Removing start_date filters - they don't seem to work reliably
        // We'll validate dates client-side instead
      },
    });
    return data || [];
  } catch (error: any) {
    // Silently handle errors for individual sports (some may have no events)
    if (error.response?.status !== 404) {
      console.warn(`Warning: Error fetching events for tag ${tagId}`);
    }
    return [];
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate liquidity from market data
 * Tries multiple fields and formats
 */
function calculateLiquidity(market: PolymarketMarket): number {
  // Try liquidityNum first (most reliable)
  if (typeof market.liquidityNum === "number" && market.liquidityNum > 0) {
    return market.liquidityNum;
  }

  // Try summing CLOB + AMM
  const clobLiq = market.liquidityClob || 0;
  const ammLiq = market.liquidityAmm || 0;
  if (clobLiq + ammLiq > 0) {
    return clobLiq + ammLiq;
  }

  // Try parsing liquidity string
  if (market.liquidity) {
    const parsed = parseFloat(market.liquidity);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 0;
}

/**
 * Extract start time from event or market
 * Tries multiple date fields in priority order
 */
function extractStartTime(
  event: PolymarketEvent,
  market?: PolymarketMarket,
): Date | null {
  // Priority 1: event.startTime (primary for sports)
  if (event.startTime) {
    const date = new Date(event.startTime);
    if (!isNaN(date.getTime())) return date;
  }

  // Priority 2: market.gameStartTime
  if (market?.gameStartTime) {
    const date = new Date(market.gameStartTime);
    if (!isNaN(date.getTime())) return date;
  }

  // Priority 3: market.eventStartTime
  if (market?.eventStartTime) {
    const date = new Date(market.eventStartTime);
    if (!isNaN(date.getTime())) return date;
  }

  // Priority 4: event.eventDate
  if (event.eventDate) {
    const date = new Date(event.eventDate);
    if (!isNaN(date.getTime())) return date;
  }

  // Priority 5: event.startDate (fallback)
  if (event.startDate) {
    const date = new Date(event.startDate);
    if (!isNaN(date.getTime())) return date;
  }

  return null;
}

/**
 * Validate that a start time is within the desired window
 */
function isWithinTimeWindow(
  startTime: Date,
  windowStart: Date,
  windowEnd: Date,
): boolean {
  return startTime >= windowStart && startTime <= windowEnd;
}

/**
 * Format date for display
 */
function formatDateTime(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  return date.toLocaleString("en-US", options);
}

/**
 * Format liquidity as currency
 */
function formatLiquidity(amount: number): string {
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/**
 * Truncate text to fit in column
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}

/**
 * Parse team names from event title
 * Handles various formats: "Team A vs Team B", "Team A @ Team B", "Team A v Team B"
 */
function parseTeamNames(eventTitle: string): {
  homeTeam?: string;
  awayTeam?: string;
} {
  // Common separators
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

  // No clear separator found
  return {};
}

/**
 * Detect market type from question text
 */
function detectMarketType(question: string): MarketType {
  const q = question.toLowerCase();

  // Totals (over/under)
  if (q.includes("o/u") || q.includes("over/under") || q.includes("total")) {
    return "totals";
  }

  // Spreads (point handicaps)
  if (
    q.includes("spread:") ||
    q.includes("spread ") ||
    /\(-\d+\.?\d*\)/.test(question) || // matches (-3.5)
    /\(\+\d+\.?\d*\)/.test(question) || // matches (+3.5)
    /[+-]\d+\.5\b/.test(question) // matches -3.5 or +3.5 (not dates)
  ) {
    return "spreads";
  }

  // Player props
  if (
    q.includes("player") ||
    q.includes("points") ||
    q.includes("assists") ||
    q.includes("rebounds")
  ) {
    return "player_props";
  }

  // Moneyline (h2h) - default for "Will X win" or team names
  if (q.includes("will") && q.includes("win")) {
    return "h2h";
  }

  if (q.includes("draw") || q.includes("tie")) {
    return "h2h"; // 3-way moneyline
  }

  // Default to h2h for team vs team without modifiers
  if (q.includes("vs") || q.includes("@")) {
    return "h2h";
  }

  return "other";
}

/**
 * Detect actual sport from event tags
 * Tags contain sport-specific identifiers we can use to fix misclassification
 */
function detectSportFromEvent(
  event: PolymarketEvent,
  fallbackSport: string,
): string {
  // Use category if available (most reliable)
  if (event.category) {
    const cat = event.category.toLowerCase();
    // Map categories to sport codes
    if (cat.includes("hockey") || cat.includes("nhl")) return "nhl";
    if (cat.includes("basketball") && cat.includes("college")) return "ncaab";
    if (cat.includes("basketball") && cat.includes("nba")) return "nba";
    if (cat.includes("football") && cat.includes("college")) return "cfb";
    if (cat.includes("football") && cat.includes("nfl")) return "nfl";
    if (cat.includes("baseball")) return "mlb";
    if (cat.includes("soccer") || cat.includes("football")) {
      // Try to get specific league from tags
    }
  }

  // Check tags for sport-specific identifiers
  if (event.tags && event.tags.length > 0) {
    const tagIds = event.tags.map((t) => t.id);

    // Sport-specific tag IDs (from the /sports endpoint - most specific tags first)
    if (tagIds.includes("899")) return "nhl"; // NHL tag
    if (tagIds.includes("745")) return "nba"; // NBA tag
    if (tagIds.includes("450")) return "nfl"; // NFL tag
    if (tagIds.includes("100381")) return "mlb"; // MLB tag
    if (tagIds.includes("100351")) return "cfb"; // CFB tag
    if (tagIds.includes("100149")) return "ncaab"; // NCAAB tag
    if (tagIds.includes("101178")) return "cbb"; // CBB tag
    if (tagIds.includes("100254")) return "wnba"; // WNBA tag

    // Soccer leagues (most specific first)
    if (tagIds.includes("82")) return "epl"; // EPL
    if (tagIds.includes("780")) return "lal"; // La Liga
    if (tagIds.includes("1494")) return "bun"; // Bundesliga
    if (tagIds.includes("306")) return "epl"; // EPL series tag
    if (tagIds.includes("102070")) return "fl1"; // Ligue 1
    if (tagIds.includes("101962")) return "sea"; // Serie A
    if (tagIds.includes("101735")) return "ere"; // Eredivisie
    if (tagIds.includes("100100")) return "mls"; // MLS
    if (tagIds.includes("102448")) return "mex"; // Liga MX
    if (tagIds.includes("102561")) return "arg"; // Argentina
    if (tagIds.includes("100977")) return "ucl"; // UCL
    if (tagIds.includes("101787")) return "uel"; // UEL
    // if (tagIds.includes("102564")) return "tur"; // Turkish Super League - NOT in Odds API
    // if (tagIds.includes("102593")) return "rus"; // Russian League - NOT in Odds API
    // if (tagIds.includes("102008")) return "itc"; // Italian Cup - NOT in Odds API

    // eSports (NOT SUPPORTED by Odds API)
    // if (tagIds.includes("100780")) return "csgo";
    // if (tagIds.includes("102366")) return "dota2";
    // if (tagIds.includes("65")) return "lol";
    // if (tagIds.includes("101672")) return "valorant";

    // Cricket
    if (tagIds.includes("101977")) return "ipl"; // IPL
    if (tagIds.includes("102815")) return "odi"; // ODI
    if (tagIds.includes("102810")) return "t20"; // T20
    // if (tagIds.includes("102808")) return "csa"; // CSA - NOT in Odds API

    // Tennis (NOT SUPPORTED - Odds API only has specific tournaments)
    // if (tagIds.includes("101232")) return "atp";
    // if (tagIds.includes("102123")) return "wta";

    // MMA
    if (
      tagIds.includes("100639") &&
      (event.title || "").toLowerCase().includes("ufc")
    ) {
      return "mma";
    }
  }

  // Fallback to the sport we were querying
  return fallbackSport;
}

/**
 * Construct Polymarket URL slug (shortened for display)
 */
function constructUrl(eventSlug?: string, marketSlug?: string): string {
  if (marketSlug) {
    return marketSlug;
  }
  if (eventSlug) {
    return eventSlug;
  }
  return "N/A";
}

// ============================================================================
// MAIN LOGIC
// ============================================================================

/**
 * Process a batch of tag requests in parallel
 */
async function processBatch(
  batch: Array<{ sport: SportMetadata; tagId: string }>,
  startMin: string,
  startMax: string,
): Promise<Array<{ sport: SportMetadata; events: PolymarketEvent[] }>> {
  const promises = batch.map(async ({ sport, tagId }) => {
    const events = await fetchEventsForSport(tagId, startMin, startMax);
    return { sport, tagId, events };
  });

  const results = await Promise.allSettled(promises);

  return results
    .filter((r) => r.status === "fulfilled")
    .map(
      (r) =>
        (
          r as PromiseFulfilledResult<{
            sport: SportMetadata;
            tagId: string;
            events: PolymarketEvent[];
          }>
        ).value,
    )
    .filter((r) => r.events.length > 0);
}

/**
 * Sleep utility for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch all upcoming sports markets within the time window
 */
async function getAllUpcomingSportsMarkets(): Promise<MarketDisplay[]> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + HOURS_AHEAD * 60 * 60 * 1000);

  const startMin = now.toISOString();
  const startMax = windowEnd.toISOString();

  console.log(`\n🔍 Searching for sports markets...`);
  console.log(
    `   Time window: ${formatDateTime(now)} to ${formatDateTime(windowEnd)}`,
  );
  console.log(`   Min liquidity: ${formatLiquidity(MIN_LIQUIDITY)}\n`);

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

  console.log(
    `📡 Fetching data for ${requests.length} tags across ${sports.length} sports...`,
  );
  console.log(
    `   (Processing in batches of ${BATCH_SIZE} to respect rate limits)\n`,
  );

  // Step 3: Process requests in batches to respect rate limits
  const allResults: Array<{ sport: SportMetadata; events: PolymarketEvent[] }> =
    [];
  const startTime = Date.now();

  for (let i = 0; i < requests.length; i += BATCH_SIZE) {
    const batch = requests.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(requests.length / BATCH_SIZE);

    console.log(
      `⚡ Processing batch ${batchNum}/${totalBatches} (${batch.length} requests)...`,
    );

    const batchResults = await processBatch(batch, startMin, startMax);
    allResults.push(...batchResults);

    // Rate limiting: wait before next batch (except on last batch)
    if (i + BATCH_SIZE < requests.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  const fetchDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Data fetched in ${fetchDuration}s\n`);

  // Step 4: Extract and filter markets from events
  const allMarkets: MarketDisplay[] = [];
  let totalEvents = 0;
  let totalMarketsScanned = 0;
  let marketsFilteredByLiquidity = 0;

  for (const { sport, events } of allResults) {
    if (events.length > 0) {
      console.log(`  • ${sport.sport}: ${events.length} events`);
      totalEvents += events.length;
    }

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

      // Detect the actual sport from event metadata (fixes misclassification)
      const actualSport = detectSportFromEvent(event, sport.sport);

      for (const market of event.markets) {
        totalMarketsScanned++;

        // Skip closed/inactive markets
        if (market.closed || market.active === false) continue;

        // Calculate liquidity
        const liquidity = calculateLiquidity(market);

        // Filter by minimum liquidity
        if (liquidity < MIN_LIQUIDITY) {
          marketsFilteredByLiquidity++;
          continue;
        }

        // CRITICAL: Filter out phantom markets (markets that appear in API but don't exist)
        // Phantom markets have extreme spreads like 0.01/0.99 (1%/99%)
        const hasBidAsk =
          market.bestBid !== null &&
          market.bestBid !== undefined &&
          market.bestAsk !== null &&
          market.bestAsk !== undefined;

        if (hasBidAsk) {
          const spread = market.bestAsk! - market.bestBid!;

          // If spread > 90% OR (liquidity is $0 AND spread > 50%), it's a phantom market
          if (spread > 0.9 || (liquidity === 0 && spread > 0.5)) {
            marketsFilteredByLiquidity++; // Count as filtered
            continue;
          }

          // Also filter if bid < 2% AND ask > 98% (essentially untradeable)
          if (market.bestBid! < 0.02 && market.bestAsk! > 0.98) {
            marketsFilteredByLiquidity++;
            continue;
          }
        }

        // Get start time (prefer market-specific, fall back to event)
        const startTime = extractStartTime(event, market) || eventStartTime;

        const eventTitle = event.title || "Unknown Event";
        const marketQuestion = market.question || "Unknown Market";
        const { homeTeam, awayTeam } = parseTeamNames(eventTitle);
        const marketType = detectMarketType(marketQuestion);

        const marketDisplay: MarketDisplay = {
          sport: actualSport,
          eventTitle,
          startTime,
          marketQuestion,
          marketType,
          liquidity,
        };

        // Add optional fields
        if (homeTeam) marketDisplay.homeTeam = homeTeam;
        if (awayTeam) marketDisplay.awayTeam = awayTeam;
        if (event.slug) marketDisplay.eventSlug = event.slug;
        if (market.slug) marketDisplay.marketSlug = market.slug;

        // Parse outcome names for binary markets
        let outcomes: string[] = [];
        try {
          if (market.outcomes) {
            outcomes = JSON.parse(market.outcomes);
          }
        } catch {
          // Default outcome names if parsing fails
          outcomes = ["Yes", "No"];
        }

        // Add outcome names
        if (outcomes.length >= 2) {
          if (outcomes[0]) marketDisplay.outcome1Name = outcomes[0];
          if (outcomes[1]) marketDisplay.outcome2Name = outcomes[1];
        }

        // Add price data for Outcome 1 (primary)
        if (market.bestBid !== null && market.bestBid !== undefined) {
          marketDisplay.bestBid = market.bestBid;
        }
        if (market.bestAsk !== null && market.bestAsk !== undefined) {
          marketDisplay.bestAsk = market.bestAsk;
        }
        if (
          market.lastTradePrice !== null &&
          market.lastTradePrice !== undefined
        ) {
          marketDisplay.lastPrice = market.lastTradePrice;
        }

        // Calculate complement prices (Outcome 2)
        if (
          marketDisplay.bestBid !== undefined &&
          marketDisplay.bestAsk !== undefined
        ) {
          // Outcome 2 prices (complement)
          // Team B bid = 1 - Team A ask (per mentor's advice)
          marketDisplay.outcome2Bid = 1 - marketDisplay.bestAsk;
          // Team B ask = 1 - Team A bid (per mentor's advice)
          marketDisplay.outcome2Ask = 1 - marketDisplay.bestBid;
        }

        allMarkets.push(marketDisplay);
      }
    }
  }

  // Filter out sports not supported by Odds API
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
    "ipl",
    "odi",
    "t20",
    "mma",
  ];

  const supportedMarkets = allMarkets.filter((m) =>
    SUPPORTED_SPORTS.includes(m.sport),
  );
  const filteredBySport = allMarkets.length - supportedMarkets.length;

  // Deduplicate markets by unique key (market slug or event title + market question)
  const seen = new Set<string>();
  const uniqueMarkets = supportedMarkets.filter((market) => {
    const key = market.marketSlug
      ? `market:${market.marketSlug}`
      : `${market.eventSlug || market.eventTitle}:${market.marketQuestion}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  console.log(`\n📊 Scan complete:`);
  console.log(`   • Events found: ${totalEvents}`);
  console.log(`   • Markets scanned: ${totalMarketsScanned}`);
  console.log(
    `   • Filtered by liquidity (<$${MIN_LIQUIDITY}): ${marketsFilteredByLiquidity}`,
  );
  console.log(`   • Filtered by unsupported sport: ${filteredBySport}`);
  console.log(`   • Markets matching criteria: ${supportedMarkets.length}`);
  console.log(`   • Unique markets: ${uniqueMarkets.length}\n`);

  return uniqueMarkets;
}

/**
 * Display markets in a formatted table
 */
function formatTable(markets: MarketDisplay[]): void {
  if (markets.length === 0) {
    console.log("No markets found matching the criteria.\n");
    return;
  }

  // Sort by start time, then by sport
  markets.sort((a, b) => {
    const timeDiff = a.startTime.getTime() - b.startTime.getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.sport.localeCompare(b.sport);
  });

  // Column widths
  const COL_SPORT = 6;
  const COL_EVENT = 30;
  const COL_TIME = 20;
  const COL_MARKET = 35;
  const COL_MARKET_TYPE = 10;
  const COL_OUTCOME = 25;
  const COL_BID = 8;
  const COL_ASK = 8;
  const COL_LIQUIDITY = 12;

  // Header
  const separator = "━".repeat(
    COL_SPORT +
      COL_EVENT +
      COL_TIME +
      COL_MARKET +
      COL_MARKET_TYPE +
      COL_OUTCOME +
      COL_BID +
      COL_ASK +
      COL_LIQUIDITY +
      8, // spaces between columns (9 columns = 8 spaces)
  );
  console.log(
    `\nUpcoming Sports Markets (Next ${HOURS_AHEAD} Hours, Liquidity >= ${formatLiquidity(MIN_LIQUIDITY)})`,
  );
  console.log(separator);

  const header = [
    "Sport".padEnd(COL_SPORT),
    "Teams/Event".padEnd(COL_EVENT),
    "Start Time".padEnd(COL_TIME),
    "Market".padEnd(COL_MARKET),
    "Type".padEnd(COL_MARKET_TYPE),
    "Outcome".padEnd(COL_OUTCOME),
    "Bid".padEnd(COL_BID),
    "Ask".padEnd(COL_ASK),
    "Liquidity".padEnd(COL_LIQUIDITY),
  ].join(" ");
  console.log(header);
  console.log(separator);

  // Rows - show both outcomes for each market
  for (const market of markets) {
    // Outcome 1 row
    const bid1 = market.bestBid !== undefined ? market.bestBid.toFixed(3) : "—";
    const ask1 = market.bestAsk !== undefined ? market.bestAsk.toFixed(3) : "—";
    const outcome1 = market.outcome1Name || "Outcome 1";

    const row1 = [
      truncate(market.sport, COL_SPORT).padEnd(COL_SPORT),
      truncate(market.eventTitle, COL_EVENT).padEnd(COL_EVENT),
      formatDateTime(market.startTime).padEnd(COL_TIME),
      truncate(market.marketQuestion, COL_MARKET).padEnd(COL_MARKET),
      market.marketType.padEnd(COL_MARKET_TYPE),
      truncate(outcome1, COL_OUTCOME).padEnd(COL_OUTCOME),
      bid1.padEnd(COL_BID),
      ask1.padEnd(COL_ASK),
      formatLiquidity(market.liquidity).padEnd(COL_LIQUIDITY),
    ].join(" ");
    console.log(row1);

    // Outcome 2 row (if available)
    if (market.outcome2Bid !== undefined && market.outcome2Ask !== undefined) {
      const bid2 = market.outcome2Bid.toFixed(3);
      const ask2 = market.outcome2Ask.toFixed(3);
      const outcome2 = market.outcome2Name || "Outcome 2";

      const row2 = [
        "".padEnd(COL_SPORT), // Empty sport column
        "".padEnd(COL_EVENT), // Empty event column
        "".padEnd(COL_TIME), // Empty time column
        "".padEnd(COL_MARKET), // Empty market column
        "".padEnd(COL_MARKET_TYPE), // Empty type column
        truncate(outcome2, COL_OUTCOME).padEnd(COL_OUTCOME),
        bid2.padEnd(COL_BID),
        ask2.padEnd(COL_ASK),
        "".padEnd(COL_LIQUIDITY), // Empty liquidity column
      ].join(" ");
      console.log(row2);
    }

    // Add market URL if available
    // if (market.marketSlug) {
    //   console.log(`   🔗 https://polymarket.com/event/${market.marketSlug}`);
    // } else if (market.eventSlug) {
    //   console.log(`   🔗 https://polymarket.com/event/${market.eventSlug}`);
    // }

    // Add a subtle separator between markets
    console.log("─".repeat(separator.length));
  }

  console.log(separator);

  // Summary
  const uniqueEvents = new Set(markets.map((m) => m.eventTitle)).size;
  console.log(
    `Total: ${markets.length} markets across ${uniqueEvents} events\n`,
  );
}

// ============================================================================
// ENTRY POINT
// ============================================================================

async function main() {
  try {
    const markets = await getAllUpcomingSportsMarkets();
    formatTable(markets);

    // Summary stats by market type
    const byType = markets.reduce(
      (acc, m) => {
        acc[m.marketType] = (acc[m.marketType] || 0) + 1;
        return acc;
      },
      {} as Record<MarketType, number>,
    );

    console.log("\n📈 Markets by Type:");
    Object.entries(byType)
      .sort(([, a], [, b]) => b - a)
      .forEach(([type, count]) => {
        console.log(`   • ${type}: ${count}`);
      });

    // Summary by sport
    const bySport = markets.reduce(
      (acc, m) => {
        acc[m.sport] = (acc[m.sport] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    console.log("\n🏆 Markets by Sport:");
    Object.entries(bySport)
      .sort(([, a], [, b]) => b - a)
      .forEach(([sport, count]) => {
        console.log(`   • ${sport}: ${count}`);
      });

    console.log("");
  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  }
}

// Run the main function
main();
