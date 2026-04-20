/**
 * Market Matcher
 *
 * Matches Polymarket markets to sportsbook events and extracts odds.
 * Refactored from scripts/match-odds.ts to be reusable in a loop.
 *
 * Key logic:
 * - Fuzzy team name matching
 * - Exact line matching for spreads/totals (critical!)
 * - Market type alignment (h2h, spreads, totals, first-half)
 */

import {
  PolymarketMarket,
  OddsAPIEvent,
  MatchedMarket,
  MarketType,
} from "./types.js";
import { BOOKMAKERS } from "./config.js";

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

function teamsMatch(pm: string, odds: string): boolean {
  const pmNorm = normalizeTeam(pm);
  const oddsNorm = normalizeTeam(odds);

  if (pmNorm === oddsNorm) return true;
  if (pmNorm.includes(oddsNorm) || oddsNorm.includes(pmNorm)) return true;

  return false;
}

function playerStatToOddsKey(statType: string, sport: string): string | null {
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

function extractLine(question: string, marketType: MarketType): number | null {
  if (marketType === "totals") {
    const match = question.match(/o\/u\s+(\d+\.?\d*)/i);
    return match && match[1] ? parseFloat(match[1]) : null;
  }

  if (marketType === "spreads") {
    const match = question.match(/\(([+-]?\d+\.?\d*)\)/);
    return match && match[1] ? parseFloat(match[1]) : null;
  }

  // NRFI ("Will there be a run scored in the first inning?") is conceptually
  // an Over/Under 0.5 market on 1st-inning runs. No line in the question —
  // it's always 0.5.
  if (marketType === "nrfi") {
    return 0.5;
  }

  return null;
}

function extractSpreadTeam(question: string): string | null {
  const match = question.match(/spread:\s*([^(]+)\s*\(/i);
  return match && match[1] ? match[1].trim() : null;
}

function isFirstHalf(question: string): boolean {
  return /\b1h\b/i.test(question) || /first half/i.test(question);
}

function getOddsAPIMarketKey(
  marketType: MarketType,
  isFirstHalfMarket: boolean,
): string {
  if (isFirstHalfMarket) {
    if (marketType === "h2h") return "h2h_h1";
    if (marketType === "spreads") return "spreads_h1";
    if (marketType === "totals") return "totals_h1";
  }
  return marketType;
}

const EVENT_MATCH_WINDOW_MS = 3 * 60 * 60 * 1000;

function findMatchingOddsEvent(
  pmMarket: PolymarketMarket,
  oddsEvents: OddsAPIEvent[],
): OddsAPIEvent | undefined {
  const pmStartMs = new Date(pmMarket.startTime).getTime();

  let fallbackEvent: OddsAPIEvent | undefined;
  let bestEvent: OddsAPIEvent | undefined;
  let bestDiffMs = Infinity;

  for (const event of oddsEvents) {
    const homeMatch = teamsMatch(pmMarket.homeTeam!, event.home_team);
    const awayMatch = teamsMatch(pmMarket.awayTeam!, event.away_team);
    const homeMatchReversed = teamsMatch(pmMarket.homeTeam!, event.away_team);
    const awayMatchReversed = teamsMatch(pmMarket.awayTeam!, event.home_team);
    const namesMatch =
      (homeMatch && awayMatch) || (homeMatchReversed && awayMatchReversed);

    if (!namesMatch) continue;

    const commenceMs = new Date(event.commence_time).getTime();
    if (!Number.isFinite(pmStartMs) || !Number.isFinite(commenceMs)) {
      if (!fallbackEvent) fallbackEvent = event;
      continue;
    }

    const timeDiffMs = Math.abs(commenceMs - pmStartMs);
    if (timeDiffMs >= EVENT_MATCH_WINDOW_MS) {
      console.log(
        `[Match] Rejected ${pmMarket.homeTeam}/${pmMarket.awayTeam}: names match but time diff ${(timeDiffMs / 3600000).toFixed(1)}h (pm=${pmMarket.startTime}, odds=${event.commence_time})`,
      );
      continue;
    }

    if (timeDiffMs < bestDiffMs) {
      bestDiffMs = timeDiffMs;
      bestEvent = event;
    }
  }

  return bestEvent ?? fallbackEvent;
}

// ============================================================================
// MAIN MATCHING LOGIC
// ============================================================================

function matchMarket(
  pmMarket: PolymarketMarket,
  oddsEvents: OddsAPIEvent[],
): MatchedMarket {
  const result: MatchedMarket = {
    polymarket: pmMarket,
    sportsbooks: {},
  };

  // Skip if no teams
  if (!pmMarket.homeTeam || !pmMarket.awayTeam) {
    result.skipReason = "No team names";
    return result;
  }

  // Skip unsupported types
  if (pmMarket.marketType === "other") {
    result.skipReason = "Unsupported market type";
    return result;
  }

  // Find the closest sportsbook event that matches team names and falls
  // inside the 3h time window. This avoids depending on API array order when
  // the same teams appear multiple times (back-to-backs, doubleheaders).
  const matchingEvent = findMatchingOddsEvent(pmMarket, oddsEvents);

  if (!matchingEvent) {
    result.skipReason = "Event not found in sportsbooks";
    return result;
  }

  // Extract line for spreads/totals
  const pmLine = extractLine(pmMarket.marketQuestion, pmMarket.marketType);

  // Determine if this is a first-half market
  const isFirstHalfMarket = isFirstHalf(pmMarket.marketQuestion);

  // Handle player props separately
  if (pmMarket.marketType === "player_props") {
    if (!pmMarket.playerName || !pmMarket.playerStatType || pmMarket.playerLine === undefined) {
      result.skipReason = "Missing player prop fields";
      return result;
    }

    const oddsAPIKey = playerStatToOddsKey(pmMarket.playerStatType, pmMarket.sport);
    if (!oddsAPIKey) {
      result.skipReason = `Unsupported player stat type: ${pmMarket.playerStatType}`;
      return result;
    }

    const pmPlayerNorm = normalizeTeam(pmMarket.playerName);

    for (const bookmaker of matchingEvent.bookmakers) {
      if (!BOOKMAKERS.includes(bookmaker.key)) continue;

      const market = bookmaker.markets.find((m) => m.key === oddsAPIKey);
      if (!market) continue;

      // Find outcomes matching this player AND line
      // Player props use `description` for player name, `name` is "Over"/"Under"
      const matchingOutcomes = market.outcomes.filter((o) => {
        if (o.point === undefined || !o.description) return false;
        if (Math.abs(o.point - pmMarket.playerLine!) >= 0.01) return false;
        const oddsPlayerNorm = normalizeTeam(o.description);
        return pmPlayerNorm === oddsPlayerNorm ||
          pmPlayerNorm.includes(oddsPlayerNorm) ||
          oddsPlayerNorm.includes(pmPlayerNorm);
      });

      if (matchingOutcomes.length > 0) {
        // Build a synthetic market with just this player's outcomes at this line
        result.sportsbooks[bookmaker.key] = {
          market: { ...market, outcomes: matchingOutcomes },
          event: matchingEvent,
        };
      }
    }

    if (Object.keys(result.sportsbooks).length === 0) {
      // Check what's available for debugging
      const availablePlayers = new Set<string>();
      for (const bookmaker of matchingEvent.bookmakers) {
        const market = bookmaker.markets.find((m) => m.key === oddsAPIKey);
        if (market) {
          for (const o of market.outcomes) {
            availablePlayers.add(`${o.name} (${o.point})`);
          }
        }
      }
      result.skipReason = availablePlayers.size > 0
        ? `Player prop not found: ${pmMarket.playerName} ${pmMarket.playerStatType} ${pmMarket.playerLine}`
        : `No ${oddsAPIKey} market available for this event`;
    }

    return result;
  }

  // Build list of possible market keys to check (featured + alternate)
  const possibleMarketKeys: string[] = [];
  if (pmMarket.marketType === "h2h") {
    possibleMarketKeys.push(isFirstHalfMarket ? "h2h_h1" : "h2h");
  } else if (pmMarket.marketType === "spreads") {
    if (isFirstHalfMarket) {
      possibleMarketKeys.push("spreads_h1", "alternate_spreads_h1");
    } else {
      possibleMarketKeys.push("spreads", "alternate_spreads");
    }
  } else if (pmMarket.marketType === "totals") {
    if (isFirstHalfMarket) {
      possibleMarketKeys.push("totals_h1", "alternate_totals_h1");
    } else {
      possibleMarketKeys.push("totals", "alternate_totals");
    }
  } else if (pmMarket.marketType === "nrfi") {
    // NRFI/YRFI = Over/Under 0.5 runs in 1st inning. Non-featured market on
    // the Odds API, only available through event-odds / alternate endpoints.
    possibleMarketKeys.push(
      "totals_1st_1_innings",
      "alternate_totals_1st_1_innings",
    );
  }

  // Match each bookmaker
  for (const bookmaker of matchingEvent.bookmakers) {
    if (!BOOKMAKERS.includes(bookmaker.key)) continue;

    // Try to find a matching market with the exact line
    let oddsMarket = undefined;

    if (
      pmMarket.marketType === "spreads" ||
      pmMarket.marketType === "totals" ||
      pmMarket.marketType === "nrfi"
    ) {
      // For spreads/totals/nrfi, find a market that has the exact line
      if (pmLine === null) continue;

      for (const marketKey of possibleMarketKeys) {
        const market = bookmaker.markets.find((m) => m.key === marketKey);
        if (!market) continue;

        const hasMatchingLine = market.outcomes.some((outcome) => {
          if (outcome.point === undefined) return false;
          return Math.abs(outcome.point - pmLine) < 0.01;
        });

        if (hasMatchingLine) {
          oddsMarket = market;
          break;
        }
      }
    } else {
      // For h2h markets
      // Soccer uses 3-way markets (team1/draw/team2)
      // Other sports use 2-way markets (team1/team2)
      const isSoccer =
        pmMarket.sport.includes("soccer") ||
        pmMarket.sport.includes("wcq") ||
        pmMarket.sport.includes("epl") ||
        pmMarket.sport.includes("lal") ||
        pmMarket.sport.includes("sea") ||
        pmMarket.sport.includes("bun") ||
        pmMarket.sport.includes("fl1") ||
        pmMarket.sport.includes("ere") ||
        pmMarket.sport.includes("mls") ||
        pmMarket.sport.includes("mex") ||
        pmMarket.sport.includes("ucl") ||
        pmMarket.sport.includes("uel") ||
        pmMarket.sport.includes("wc") ||
        pmMarket.sport.includes("cwc");

      for (const marketKey of possibleMarketKeys) {
        const market = bookmaker.markets.find((m) => m.key === marketKey);
        if (!market) continue;

        const hasDrawOutcome = market.outcomes.some(
          (outcome) =>
            outcome.name.toLowerCase() === "draw" ||
            outcome.name.toLowerCase() === "tie",
        );

        // For soccer, accept 3-way markets
        // For other sports, only accept 2-way markets (no draw)
        if (isSoccer) {
          // Accept any h2h market for soccer (2-way or 3-way)
          oddsMarket = market;
          break;
        } else {
          // For non-soccer, exclude 3-way markets
          if (market.outcomes.length === 2 && !hasDrawOutcome) {
            oddsMarket = market;
            break;
          }
        }
      }
    }

    if (!oddsMarket) continue;

    result.sportsbooks[bookmaker.key] = {
      market: oddsMarket,
      event: matchingEvent,
    };
  }

  // Set skip reason if no matches
  if (Object.keys(result.sportsbooks).length === 0) {
    if (pmLine !== null) {
      // Collect available lines from sportsbooks for debugging
      const availableLines = new Set<number>();
      for (const bookmaker of matchingEvent.bookmakers) {
        if (!BOOKMAKERS.includes(bookmaker.key)) continue;

        for (const marketKey of possibleMarketKeys) {
          const market = bookmaker.markets.find((m) => m.key === marketKey);
          if (market) {
            for (const outcome of market.outcomes) {
              if (outcome.point !== undefined) {
                availableLines.add(outcome.point);
              }
            }
          }
        }
      }

      const linesStr = Array.from(availableLines)
        .sort((a, b) => a - b)
        .join(", ");
      result.skipReason = `No sportsbooks offer line ${pmLine}. Available: ${linesStr || "none"}`;
    } else {
      result.skipReason = "No matching markets";
    }
  }

  return result;
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

/**
 * Match Polymarket markets to sportsbook events
 *
 * @param markets - Polymarket markets from discovery
 * @param oddsData - Sportsbook odds from odds-fetcher
 * @returns Array of matched markets (with skip reasons for unmatched)
 */
export function matchMarkets(
  markets: PolymarketMarket[],
  oddsData: Record<string, OddsAPIEvent[]>,
): MatchedMarket[] {
  const allMatches: MatchedMarket[] = [];

  // Group markets by sport for efficient matching
  const marketsBySport = markets.reduce(
    (acc, market) => {
      if (!acc[market.sport]) acc[market.sport] = [];
      acc[market.sport]!.push(market);
      return acc;
    },
    {} as Record<string, PolymarketMarket[]>,
  );

  // Match each sport's markets
  for (const [sport, sportMarkets] of Object.entries(marketsBySport)) {
    const oddsEvents = oddsData[sport] || [];

    for (const market of sportMarkets) {
      if (!market) continue;
      const match = matchMarket(market, oddsEvents);
      allMatches.push(match);
    }
  }

  return allMatches;
}
