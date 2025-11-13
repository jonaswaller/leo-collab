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

function extractLine(question: string, marketType: MarketType): number | null {
  if (marketType === "totals") {
    const match = question.match(/o\/u\s+(\d+\.?\d*)/i);
    return match && match[1] ? parseFloat(match[1]) : null;
  }

  if (marketType === "spreads") {
    const match = question.match(/\(([+-]?\d+\.?\d*)\)/);
    return match && match[1] ? parseFloat(match[1]) : null;
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
  if (
    pmMarket.marketType === "player_props" ||
    pmMarket.marketType === "other"
  ) {
    result.skipReason = "Unsupported market type";
    return result;
  }

  // Find matching event
  const matchingEvent = oddsEvents.find((event) => {
    const homeMatch = teamsMatch(pmMarket.homeTeam!, event.home_team);
    const awayMatch = teamsMatch(pmMarket.awayTeam!, event.away_team);
    return homeMatch && awayMatch;
  });

  if (!matchingEvent) {
    result.skipReason = "Event not found in sportsbooks";
    return result;
  }

  // Extract line for spreads/totals
  const pmLine = extractLine(pmMarket.marketQuestion, pmMarket.marketType);

  // Determine if this is a first-half market
  const isFirstHalfMarket = isFirstHalf(pmMarket.marketQuestion);

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
  }

  // Match each bookmaker
  for (const bookmaker of matchingEvent.bookmakers) {
    if (!BOOKMAKERS.includes(bookmaker.key)) continue;

    // Try to find a matching market with the exact line
    let oddsMarket = undefined;

    if (pmMarket.marketType === "spreads" || pmMarket.marketType === "totals") {
      // For spreads/totals, find a market that has the exact line
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
      // For h2h, find a 2-way market (exclude 3-way markets with Draw)
      // Some European bookmakers return 3-way markets under the h2h key
      // For NHL, European books offer 3-way "regulation time" markets which are
      // fundamentally different from 2-way "including OT/shootout" markets
      for (const marketKey of possibleMarketKeys) {
        const market = bookmaker.markets.find((m) => m.key === marketKey);
        if (!market) continue;
        
        // Filter out 3-way markets:
        // 1. Must have exactly 2 outcomes
        // 2. Must NOT have a "Draw" outcome
        const hasDrawOutcome = market.outcomes.some(
          (outcome) => outcome.name.toLowerCase() === "draw" || 
                       outcome.name.toLowerCase() === "tie"
        );
        
        if (market.outcomes.length === 2 && !hasDrawOutcome) {
          oddsMarket = market;
          break;
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
