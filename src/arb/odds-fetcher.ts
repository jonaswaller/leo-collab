/**
 * Sportsbook Odds Fetcher
 *
 * Fetches odds from The Odds API for sports betting markets.
 * Refactored from scripts/match-odds.ts to be reusable in a loop.
 *
 * Key optimizations:
 * - Only fetches events that exist in Polymarket (saves API credits)
 * - Fetches alternate lines for relevant events; falls back to broader set when needed to avoid misses
 * - Parallelizes sport-level and event-level fetches with concurrency limiter
 * - Respects rate limits (30 req/sec)
 */

import axios from "axios";
import { OddsAPIEvent, PolymarketMarket } from "./types.js";
import {
  ODDS_API_KEY,
  ODDS_API_BASE,
  BOOKMAKERS,
  SPORT_MAP,
} from "./config.js";

interface EventMarketNeeds {
  hasH2H: boolean;
  hasSpreads: boolean;
  hasTotals: boolean;
  hasFirstHalfH2H: boolean;
  hasFirstHalfSpreads: boolean;
  hasFirstHalfTotals: boolean;
  playerPropKeys: Set<string>; // e.g. "player_points", "player_rebounds"
}

interface SportMarketNeeds {
  hasSpreadsOrTotals: boolean;
  hasFirstHalf: boolean;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

function isFirstHalf(question: string): boolean {
  return /\b1h\b/i.test(question) || /first half/i.test(question);
}

function statTypeToOddsAPIKey(statType: string, sport: string): string | null {
  if (["nba", "ncaab", "cbb", "wnba"].includes(sport)) {
    const map: Record<string, string> = {
      points: "player_points", rebounds: "player_rebounds",
      assists: "player_assists", threes: "player_threes",
      blocks: "player_blocks", steals: "player_steals",
    };
    return map[statType] || null;
  }
  if (sport === "mlb") {
    const map: Record<string, string> = {
      strikeouts: "pitcher_strikeouts", hits: "batter_hits",
      "home runs": "batter_home_runs", "total bases": "batter_total_bases",
      rbis: "batter_rbis",
    };
    return map[statType] || null;
  }
  if (sport === "nhl") {
    const map: Record<string, string> = {
      points: "player_points", assists: "player_assists",
      goals: "player_goals", "shots on goal": "player_shots_on_goal",
      saves: "player_total_saves",
    };
    return map[statType] || null;
  }
  if (["nfl", "cfb"].includes(sport)) {
    const map: Record<string, string> = {
      "pass yards": "player_pass_yds", "rush yards": "player_rush_yds",
      "reception yards": "player_reception_yds", receptions: "player_receptions",
      "pass attempts": "player_pass_attempts", "pass completions": "player_pass_completions",
      "pass touchdowns": "player_pass_tds", "rush attempts": "player_rush_attempts",
      tackles: "player_tackles_assists", sacks: "player_sacks",
    };
    return map[statType] || null;
  }
  return null;
}

function buildEventMarketParams(needs?: EventMarketNeeds): string[] {
  if (!needs) return [];

  const markets: string[] = [];

  if (needs.hasFirstHalfH2H) {
    markets.push("h2h_h1");
  }

  if (needs.hasFirstHalfSpreads) {
    markets.push("spreads_h1", "alternate_spreads_h1");
  }

  if (needs.hasFirstHalfTotals) {
    markets.push("totals_h1", "alternate_totals_h1");
  }

  if (needs.hasSpreads) {
    markets.push("alternate_spreads");
  }

  if (needs.hasTotals) {
    markets.push("alternate_totals");
  }

  // Player prop market keys — request both base and alternate lines
  for (const key of needs.playerPropKeys) {
    markets.push(key);
    markets.push(`${key}_alternate`);
  }

  return markets;
}

/**
 * Run async tasks with bounded concurrency AND rate limiting.
 *
 * Odds API docs: 30 req/sec limit, but recommend spacing requests out
 * rather than sending concurrently. Temporary 429s can occur even below
 * the limit due to uneven server-side distribution.
 *
 * Strategy: allow up to `concurrency` in-flight requests, but enforce
 * a minimum `minIntervalMs` between request START times. This gives
 * parallelism (overlapping network I/O) without bursting.
 *
 * With concurrency=8 and minIntervalMs=50 we get max ~20 req/sec with
 * up to 8 in flight — well under the 30/sec hard limit.
 */
async function runRateLimited<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  minIntervalMs: number = 50,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  let lastStartTime = 0;

  // Mutex so only one worker acquires the next task + delay at a time
  let lock: Promise<void> = Promise.resolve();

  async function worker() {
    while (true) {
      // Acquire next task under lock to enforce spacing
      const taskIndex = await new Promise<number>((resolve) => {
        lock = lock.then(async () => {
          if (nextIndex >= tasks.length) {
            resolve(-1);
            return;
          }
          // Enforce minimum interval between request starts
          const now = Date.now();
          const elapsed = now - lastStartTime;
          if (elapsed < minIntervalMs) {
            await new Promise((r) => setTimeout(r, minIntervalMs - elapsed));
          }
          lastStartTime = Date.now();
          resolve(nextIndex++);
        });
      });

      if (taskIndex === -1) break;
      results[taskIndex] = await tasks[taskIndex]!();
    }
  }

  const workerCount = Math.min(concurrency, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Phase 1: Fetch base odds (h2h, spreads, totals) for a single sport
 * and filter to events that exist in Polymarket.
 */
async function fetchBaseOddsForSport(
  sportKey: string,
  allPolymarketEvents: Set<string>,
): Promise<{ events: OddsAPIEvent[]; matchedEventKeys: Map<string, string> }> {
  try {
    const response = await axios.get<OddsAPIEvent[]>(
      `${ODDS_API_BASE}/sports/${sportKey}/odds`,
      {
        params: {
          apiKey: ODDS_API_KEY,
          regions: "us",
          markets: "h2h,spreads,totals",
          oddsFormat: "american",
          bookmakers: BOOKMAKERS.join(","),
        },
      },
    );

    const allEvents = response.data;
    const matchedEventKeys = new Map<string, string>();

    const events = allEvents.filter((event) => {
      const homeNorm = normalizeTeam(event.home_team);
      const awayNorm = normalizeTeam(event.away_team);

      for (const pmEventKey of allPolymarketEvents) {
        const [pmHome, pmAway] = pmEventKey.split("|");
        if (!pmHome || !pmAway) continue;

        const match1 =
          (homeNorm.includes(pmHome) || pmHome.includes(homeNorm)) &&
          (awayNorm.includes(pmAway) || pmAway.includes(awayNorm));
        const match2 =
          (homeNorm.includes(pmAway) || pmAway.includes(homeNorm)) &&
          (awayNorm.includes(pmHome) || pmHome.includes(awayNorm));

        if (match1 || match2) {
          matchedEventKeys.set(event.id, pmEventKey);
          return true;
        }
      }
      return false;
    });

    return { events, matchedEventKeys };
  } catch (error: any) {
    if (error.response?.status === 404) {
      return { events: [], matchedEventKeys: new Map() };
    }
    console.error(
      `[Odds] Error fetching ${sportKey}:`,
      error.response?.data || error.message,
    );
    return { events: [], matchedEventKeys: new Map() };
  }
}

/**
 * Phase 2: Fetch alternate lines for a single event and merge into it.
 * Returns the event (mutated with alternate markets merged in).
 */
async function fetchAndMergeAlternates(
  sportKey: string,
  event: OddsAPIEvent,
  marketsForEvent: string[],
  usedFallback: boolean,
): Promise<void> {
  try {
    const alternateResponse = await axios.get<OddsAPIEvent>(
      `${ODDS_API_BASE}/sports/${sportKey}/events/${event.id}/odds`,
      {
        params: {
          apiKey: ODDS_API_KEY,
          regions: "us",
          markets: marketsForEvent.join(","),
          oddsFormat: "american",
          bookmakers: BOOKMAKERS.join(","),
        },
      },
    );

    if (usedFallback) {
      console.log(
        `[Odds] Fallback alternates for ${sportKey} event ${event.id} (${event.home_team} vs ${event.away_team}): ${marketsForEvent.join(",")}`,
      );
    }

    // Merge alternate markets into the event's bookmakers
    if (alternateResponse.data.bookmakers) {
      for (const altBookmaker of alternateResponse.data.bookmakers) {
        const existingBookmaker = event.bookmakers.find(
          (b) => b.key === altBookmaker.key,
        );
        if (existingBookmaker) {
          existingBookmaker.markets.push(...altBookmaker.markets);
        } else {
          event.bookmakers.push(altBookmaker);
        }
      }
    }
  } catch (error: any) {
    if (error.response?.status !== 404) {
      console.warn(
        `[Odds] Warning: Could not fetch alternate markets for event ${event.id}`,
      );
    }
  }
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

// Odds API: 30 req/sec hard limit, docs recommend spacing over seconds.
// concurrency = max in-flight, interval = min ms between request starts.
// Phase 1: 8 concurrent, 50ms spacing → max ~20 req/sec
// Phase 2: 8 concurrent, 50ms spacing → max ~20 req/sec
const CONCURRENCY = 8;
const MIN_INTERVAL_MS = 50;

/**
 * Fetch sportsbook odds for Polymarket markets
 *
 * @param markets - Array of Polymarket markets from discovery
 * @returns Odds data grouped by sport
 */
export async function fetchOddsForMarkets(
  markets: PolymarketMarket[],
): Promise<Record<string, OddsAPIEvent[]>> {
  // Step 1: Group markets by sport
  const marketsBySport = markets.reduce(
    (acc, market) => {
      if (!acc[market.sport]) acc[market.sport] = [];
      acc[market.sport]!.push(market);
      return acc;
    },
    {} as Record<string, PolymarketMarket[]>,
  );

  // Step 2: Build sets of Polymarket events per sport
  const allPolymarketEventsBySport: Record<string, Set<string>> = {};
  const eventNeedsBySport: Record<string, Map<string, EventMarketNeeds>> = {};
  const sportFallbackNeedsBySport: Record<string, SportMarketNeeds> = {};

  for (const [pmSport, sportMarkets] of Object.entries(marketsBySport)) {
    const allEvents = new Set<string>();
    const eventNeeds = new Map<string, EventMarketNeeds>();
    let hasSpreadsOrTotals = false;
    let hasFirstHalf = false;

    for (const market of sportMarkets) {
      if (!market) continue;
      if (market.homeTeam && market.awayTeam) {
        const homeNorm = normalizeTeam(market.homeTeam);
        const awayNorm = normalizeTeam(market.awayTeam);
        const eventKey = `${homeNorm}|${awayNorm}`;
        allEvents.add(eventKey);

        const needs = eventNeeds.get(eventKey) || {
          hasH2H: false,
          hasSpreads: false,
          hasTotals: false,
          hasFirstHalfH2H: false,
          hasFirstHalfSpreads: false,
          hasFirstHalfTotals: false,
          playerPropKeys: new Set<string>(),
        };

        const firstHalf = isFirstHalf(market.marketQuestion);

        if (market.marketType === "player_props") {
          if (market.playerStatType) {
            const oddsKey = statTypeToOddsAPIKey(market.playerStatType, pmSport);
            if (oddsKey) {
              needs.playerPropKeys.add(oddsKey);
            }
          }
        } else if (market.marketType === "h2h") {
          if (firstHalf) {
            needs.hasFirstHalfH2H = true;
            hasFirstHalf = true;
          } else {
            needs.hasH2H = true;
          }
        } else if (market.marketType === "spreads") {
          if (firstHalf) {
            needs.hasFirstHalfSpreads = true;
            hasFirstHalf = true;
          } else {
            needs.hasSpreads = true;
            hasSpreadsOrTotals = true;
          }
        } else if (market.marketType === "totals") {
          if (firstHalf) {
            needs.hasFirstHalfTotals = true;
            hasFirstHalf = true;
          } else {
            needs.hasTotals = true;
            hasSpreadsOrTotals = true;
          }
        }

        eventNeeds.set(eventKey, needs);
      }
    }

    allPolymarketEventsBySport[pmSport] = allEvents;
    eventNeedsBySport[pmSport] = eventNeeds;
    sportFallbackNeedsBySport[pmSport] = {
      hasSpreadsOrTotals,
      hasFirstHalf,
    };
  }

  // =========================================================================
  // Phase 1: Fetch base odds for ALL sports concurrently
  // =========================================================================

  const sportEntries: { pmSport: string; oddsApiSport: string }[] = [];
  for (const pmSport of Object.keys(marketsBySport)) {
    const oddsApiSport = SPORT_MAP[pmSport];
    if (!oddsApiSport) {
      console.log(`[Odds] No mapping for sport: ${pmSport}`);
      continue;
    }
    sportEntries.push({ pmSport, oddsApiSport });
  }

  const baseTasks = sportEntries.map(({ pmSport, oddsApiSport }) => () =>
    fetchBaseOddsForSport(
      oddsApiSport,
      allPolymarketEventsBySport[pmSport] || new Set<string>(),
    ),
  );

  const baseResults = await runRateLimited(baseTasks, CONCURRENCY, MIN_INTERVAL_MS);

  // Assemble oddsData and collect alternate fetch requests
  const oddsData: Record<string, OddsAPIEvent[]> = {};

  interface AlternateTask {
    sportKey: string;
    event: OddsAPIEvent;
    marketsForEvent: string[];
    usedFallback: boolean;
  }
  const alternateTasks: AlternateTask[] = [];

  for (let i = 0; i < sportEntries.length; i++) {
    const { pmSport, oddsApiSport } = sportEntries[i]!;
    const { events, matchedEventKeys } = baseResults[i]!;
    const eventNeeds =
      eventNeedsBySport[pmSport] || new Map<string, EventMarketNeeds>();
    const sportFallbackNeeds = sportFallbackNeedsBySport[pmSport] || {
      hasSpreadsOrTotals: false,
      hasFirstHalf: false,
    };

    oddsData[pmSport] = events;

    // Determine which events need alternate line fetches
    for (const event of events) {
      const pmEventKey =
        matchedEventKeys.get(event.id) ||
        `${normalizeTeam(event.home_team)}|${normalizeTeam(event.away_team)}`;
      let marketsForEvent = buildEventMarketParams(eventNeeds.get(pmEventKey));
      let usedFallback = false;

      if (marketsForEvent.length === 0) {
        const fallbackMarkets: string[] = [];
        if (sportFallbackNeeds.hasSpreadsOrTotals) {
          fallbackMarkets.push("alternate_spreads", "alternate_totals");
        }
        if (sportFallbackNeeds.hasFirstHalf) {
          fallbackMarkets.push(
            "h2h_h1",
            "spreads_h1",
            "totals_h1",
            "alternate_spreads_h1",
            "alternate_totals_h1",
          );
        }
        marketsForEvent = Array.from(new Set(fallbackMarkets));
        usedFallback = marketsForEvent.length > 0;
      }

      if (marketsForEvent.length === 0) continue;

      alternateTasks.push({
        sportKey: oddsApiSport,
        event,
        marketsForEvent,
        usedFallback,
      });
    }
  }

  // =========================================================================
  // Phase 2: Fetch all alternate lines concurrently (bounded)
  // =========================================================================

  if (alternateTasks.length > 0) {
    const altFns = alternateTasks.map(
      ({ sportKey, event, marketsForEvent, usedFallback }) =>
        () =>
          fetchAndMergeAlternates(
            sportKey,
            event,
            marketsForEvent,
            usedFallback,
          ),
    );

    await runRateLimited(altFns, CONCURRENCY, MIN_INTERVAL_MS);
  }

  return oddsData;
}
