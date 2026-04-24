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
  hasNRFI: boolean; // MLB YRFI/NRFI — O/U 0.5 runs 1st inning
  playerPropKeys: Set<string>; // e.g. "player_points", "player_rebounds"
}

interface SportMarketNeeds {
  hasSpreadsOrTotals: boolean;
  hasFirstHalf: boolean;
}

interface PolymarketEventRef {
  key: string;
  home: string;
  away: string;
  startTimeMs: number;
}

interface OddsAPISport {
  key?: string;
  group?: string;
  title?: string;
  description?: string;
  active?: boolean;
  has_outrights?: boolean;
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

const EVENT_MATCH_WINDOW_MS = 3 * 60 * 60 * 1000;

function teamsMatch(left: string, right: string): boolean {
  return left === right || left.includes(right) || right.includes(left);
}

function findMatchingPolymarketEventKey(
  event: OddsAPIEvent,
  polymarketEvents: PolymarketEventRef[],
): string | null {
  const homeNorm = normalizeTeam(event.home_team);
  const awayNorm = normalizeTeam(event.away_team);
  const commenceMs = new Date(event.commence_time).getTime();

  let fallbackKey: string | null = null;
  let bestKey: string | null = null;
  let bestDiffMs = Infinity;

  for (const pmEvent of polymarketEvents) {
    const directMatch =
      teamsMatch(pmEvent.home, homeNorm) && teamsMatch(pmEvent.away, awayNorm);
    const reversedMatch =
      teamsMatch(pmEvent.home, awayNorm) && teamsMatch(pmEvent.away, homeNorm);

    if (!directMatch && !reversedMatch) continue;

    if (!Number.isFinite(commenceMs) || !Number.isFinite(pmEvent.startTimeMs)) {
      if (!fallbackKey) fallbackKey = pmEvent.key;
      continue;
    }

    const timeDiffMs = Math.abs(commenceMs - pmEvent.startTimeMs);
    if (timeDiffMs >= EVENT_MATCH_WINDOW_MS) continue;

    if (timeDiffMs < bestDiffMs) {
      bestDiffMs = timeDiffMs;
      bestKey = pmEvent.key;
    }
  }

  return bestKey ?? fallbackKey;
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

  if (needs.hasNRFI) {
    // 1st-inning totals — non-featured market, only available via event-odds
    markets.push("totals_1st_1_innings", "alternate_totals_1st_1_innings");
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
  polymarketEvents: PolymarketEventRef[],
  markets: string = "h2h,spreads,totals",
): Promise<{ events: OddsAPIEvent[]; matchedEventKeys: Map<string, string> }> {
  try {
    const response = await axios.get<OddsAPIEvent[]>(
      `${ODDS_API_BASE}/sports/${sportKey}/odds`,
      {
        params: {
          apiKey: ODDS_API_KEY,
          regions: "us",
          markets,
          oddsFormat: "american",
          bookmakers: BOOKMAKERS.join(","),
        },
      },
    );

    const allEvents = response.data;
    const matchedEventKeys = new Map<string, string>();

    const events = allEvents.filter((event) => {
      const pmEventKey = findMatchingPolymarketEventKey(event, polymarketEvents);
      if (!pmEventKey) return false;

      matchedEventKeys.set(event.id, pmEventKey);
      return true;
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
const ACTIVE_SPORTS_CACHE_TTL_MS = 30 * 60 * 1000;

let activeSportKeysCache:
  | {
      keys: Set<string>;
      fetchedAtMs: number;
    }
  | null = null;

function getBaseMarketsForSport(pmSport: string): string {
  // Odds API tennis support is match winner only for our purposes. Avoid
  // requesting spreads/totals here because those markets are mostly US-sports
  // coverage and can be unsupported/noisy for tennis tournament keys.
  if (pmSport === "tennis") {
    return "h2h";
  }

  return "h2h,spreads,totals";
}

async function fetchActiveOddsApiSportKeys(): Promise<Set<string> | null> {
  const now = Date.now();

  if (
    activeSportKeysCache &&
    now - activeSportKeysCache.fetchedAtMs < ACTIVE_SPORTS_CACHE_TTL_MS
  ) {
    return activeSportKeysCache.keys;
  }

  try {
    const response = await axios.get<OddsAPISport[]>(`${ODDS_API_BASE}/sports`, {
      params: {
        apiKey: ODDS_API_KEY,
      },
    });

    const keys = new Set(
      (response.data || [])
        .map((sport) => sport.key)
        .filter((key): key is string => Boolean(key)),
    );

    if (keys.size === 0) {
      console.warn(
        "[Odds] /sports returned no active sport keys; keeping tennis fallback behavior",
      );
      return activeSportKeysCache?.keys ?? null;
    }

    activeSportKeysCache = {
      keys,
      fetchedAtMs: now,
    };

    return keys;
  } catch (error: any) {
    console.warn(
      "[Odds] Warning: Could not fetch active sports list; keeping tennis fallback behavior",
      error.response?.data || error.message,
    );
    return activeSportKeysCache?.keys ?? null;
  }
}

async function getOddsApiSportsForPolymarketSport(
  pmSport: string,
  mapped: string | string[],
): Promise<string[]> {
  const oddsApiSports = Array.isArray(mapped) ? mapped : [mapped];

  if (pmSport !== "tennis") {
    return oddsApiSports;
  }

  const activeSportKeys = await fetchActiveOddsApiSportKeys();
  if (!activeSportKeys) {
    console.log(
      `[Odds] Tennis active-sports filter unavailable; using all ${oddsApiSports.length} configured tournament keys`,
    );
    return oddsApiSports;
  }

  const activeTennisSports = oddsApiSports.filter((sportKey) =>
    activeSportKeys.has(sportKey),
  );

  if (activeTennisSports.length === 0) {
    console.log(
      `[Odds] Tennis active-sports filter found 0/${oddsApiSports.length} configured tournament keys; using all keys for this cycle`,
    );
    return oddsApiSports;
  }

  console.log(
    `[Odds] Tennis active-sports filter: ${activeTennisSports.length}/${oddsApiSports.length} tournament keys active`,
  );

  return activeTennisSports;
}

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
  const allPolymarketEventsBySport: Record<string, PolymarketEventRef[]> = {};
  const eventNeedsBySport: Record<string, Map<string, EventMarketNeeds>> = {};
  const sportFallbackNeedsBySport: Record<string, SportMarketNeeds> = {};

  for (const [pmSport, sportMarkets] of Object.entries(marketsBySport)) {
    const allEvents: PolymarketEventRef[] = [];
    const seenEventKeys = new Set<string>();
    const eventNeeds = new Map<string, EventMarketNeeds>();
    let hasSpreadsOrTotals = false;
    let hasFirstHalf = false;

    for (const market of sportMarkets) {
      if (!market) continue;
      if (market.homeTeam && market.awayTeam) {
        const homeNorm = normalizeTeam(market.homeTeam);
        const awayNorm = normalizeTeam(market.awayTeam);
        const eventKey = `${homeNorm}|${awayNorm}|${market.startTime}`;
        if (!seenEventKeys.has(eventKey)) {
          allEvents.push({
            key: eventKey,
            home: homeNorm,
            away: awayNorm,
            startTimeMs: new Date(market.startTime).getTime(),
          });
          seenEventKeys.add(eventKey);
        }

        const needs = eventNeeds.get(eventKey) || {
          hasH2H: false,
          hasSpreads: false,
          hasTotals: false,
          hasFirstHalfH2H: false,
          hasFirstHalfSpreads: false,
          hasFirstHalfTotals: false,
          hasNRFI: false,
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
        } else if (market.marketType === "nrfi") {
          needs.hasNRFI = true;
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

  // One pmSport can fan out to multiple Odds API sport keys (tennis → 30
  // tournament-specific keys). Each oddsApiSport becomes its own fetch task;
  // their results get merged into a single oddsData[pmSport] array below.
  const sportEntries: {
    pmSport: string;
    oddsApiSport: string;
    baseMarkets: string;
  }[] = [];
  for (const pmSport of Object.keys(marketsBySport)) {
    const mapped = SPORT_MAP[pmSport];
    if (!mapped) {
      console.log(`[Odds] No mapping for sport: ${pmSport}`);
      continue;
    }
    const oddsApiSports = await getOddsApiSportsForPolymarketSport(
      pmSport,
      mapped,
    );
    const baseMarkets = getBaseMarketsForSport(pmSport);
    for (const oddsApiSport of oddsApiSports) {
      sportEntries.push({ pmSport, oddsApiSport, baseMarkets });
    }
  }

  const baseTasks = sportEntries.map(
    ({ pmSport, oddsApiSport, baseMarkets }) =>
      () =>
        fetchBaseOddsForSport(
          oddsApiSport,
          allPolymarketEventsBySport[pmSport] || [],
          baseMarkets,
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
    const polymarketEvents = allPolymarketEventsBySport[pmSport] || [];
    const eventNeeds =
      eventNeedsBySport[pmSport] || new Map<string, EventMarketNeeds>();
    const sportFallbackNeeds = sportFallbackNeedsBySport[pmSport] || {
      hasSpreadsOrTotals: false,
      hasFirstHalf: false,
    };

    // Append rather than overwrite: one pmSport may have multiple sport-key
    // fetches (tennis fans out across tournaments).
    oddsData[pmSport] = (oddsData[pmSport] || []).concat(events);

    // Determine which events need alternate line fetches
    for (const event of events) {
      const pmEventKey =
        matchedEventKeys.get(event.id) ||
        findMatchingPolymarketEventKey(event, polymarketEvents);
      let marketsForEvent = pmEventKey
        ? buildEventMarketParams(eventNeeds.get(pmEventKey))
        : [];
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
