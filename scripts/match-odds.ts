/**
 * Sportsbook Odds Matcher for Arbitrage Detection
 *
 * Compares Polymarket markets against sportsbook consensus odds to identify
 * potential arbitrage opportunities. This is the data collection stage - it
 * fetches and matches odds from multiple sources for side-by-side comparison.
 *
 * Data Sources:
 * - Polymarket: Reads cached markets from polymarket-markets.json
 * - Sportsbooks: Fetches live odds from Pinnacle, BetOnline, DraftKings, FanDuel
 *
 * Matching Strategy:
 * - Matches by sport, teams, and market type (h2h, spreads, totals)
 * - Includes first-half markets (h2h_h1, spreads_h1, totals_h1)
 * - STRICT line matching: For spreads/totals, only matches exact lines
 *   (e.g., O/U 229.5 must exist in sportsbooks, not 228.5 or 230.5)
 * - Fuzzy team name matching to handle variations (e.g., "LA Lakers" vs "Lakers")
 *
 * API Cost Optimization:
 * - Only fetches sportsbook events that exist in Polymarket data
 * - Only fetches first-half markets for events that need them
 * - Saves ~40+ API calls per run vs fetching all available events
 *
 * Output:
 * - Side-by-side comparison of Polymarket bid/ask vs sportsbook American odds
 * - Both outcomes displayed for each market
 * - Summary of matched vs skipped markets with reasons
 *
 * Next Steps (not yet implemented):
 * - De-vig sportsbook odds to calculate fair probabilities
 * - Calculate edge (fair probability vs Polymarket ask price)
 * - Apply Kelly criterion for position sizing
 * - Filter for +EV opportunities above threshold
 *
 * Usage: npm run match-odds
 */

import axios from "axios";
import fs from "fs";
import "dotenv/config";

// ============================================================================
// TYPES
// ============================================================================

type MarketType = "h2h" | "spreads" | "totals" | "player_props" | "other";

interface PolymarketMarket {
  sport: string;
  eventTitle: string;
  homeTeam?: string;
  awayTeam?: string;
  startTime: string;
  marketQuestion: string;
  marketType: MarketType;
  liquidity: number;
  outcome1Name?: string;
  bestBid?: number;
  bestAsk?: number;
  outcome2Name?: string;
  outcome2Bid?: number;
  outcome2Ask?: number;
  eventSlug?: string;
  marketSlug?: string;
}

interface OddsAPIOutcome {
  name: string;
  price: number; // American odds
  point?: number; // For spreads/totals
}

interface OddsAPIMarket {
  key: string; // "h2h", "spreads", "totals"
  last_update: string;
  outcomes: OddsAPIOutcome[];
}

interface OddsAPIBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsAPIMarket[];
}

interface OddsAPIEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsAPIBookmaker[];
}

interface MatchedMarket {
  polymarket: PolymarketMarket;
  sportsbooks: {
    [bookmaker: string]: {
      market: OddsAPIMarket;
      event: OddsAPIEvent;
    };
  };
  skipReason?: string;
}

// ============================================================================
// CONFIG
// ============================================================================

const ODDS_API_KEY = process.env.ODDS_API_KEY!;
const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const BOOKMAKERS = ["pinnacle", "betonlineag", "draftkings", "fanduel"];

// Sport mapping: Polymarket -> Odds API
const SPORT_MAP: Record<string, string> = {
  nfl: "americanfootball_nfl",
  cfb: "americanfootball_ncaaf",
  nba: "basketball_nba",
  ncaab: "basketball_ncaab",
  cbb: "basketball_ncaab",
  wnba: "basketball_wnba",
  nhl: "icehockey_nhl",
  mlb: "baseball_mlb",
  epl: "soccer_epl",
  lal: "soccer_spain_la_liga",
  sea: "soccer_italy_serie_a",
  bun: "soccer_germany_bundesliga",
  fl1: "soccer_france_ligue_one",
  ere: "soccer_netherlands_eredivisie",
  mls: "soccer_usa_mls",
  mex: "soccer_mexico_ligamx",
  ucl: "soccer_uefa_champs_league",
  uel: "soccer_uefa_europa_league",
  mma: "mma_mixed_martial_arts",
};

// ============================================================================
// ODDS API
// ============================================================================

async function fetchOddsForSport(
  sportKey: string,
  eventsNeedingFirstHalf: Set<string>,
  allPolymarketEvents: Set<string>,
): Promise<OddsAPIEvent[]> {
  try {
    // First, fetch main markets (h2h, spreads, totals)
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

    // FILTER: Only keep events that exist in Polymarket
    const allEvents = response.data;
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
        if (match1 || match2) return true;
      }
      return false;
    });

    console.log(
      `  ✓ ${sportKey}: ${events.length}/${allEvents.length} events (filtered to Polymarket events only)`,
    );

    // Fetch alternate lines for ALL events (to match any Polymarket line)
    if (events.length > 0) {
      console.log(`  → Fetching alternate lines for ${events.length} events`);
    }

    for (const event of events) {
      try {
        // Fetch ALL alternate markets to match any Polymarket line
        // This includes: alternate_spreads, alternate_totals, and first-half variants
        const alternateResponse = await axios.get<OddsAPIEvent>(
          `${ODDS_API_BASE}/sports/${sportKey}/events/${event.id}/odds`,
          {
            params: {
              apiKey: ODDS_API_KEY,
              regions: "us",
              markets:
                "alternate_spreads,alternate_totals,h2h_h1,spreads_h1,totals_h1,alternate_spreads_h1,alternate_totals_h1",
              oddsFormat: "american",
              bookmakers: BOOKMAKERS.join(","),
            },
          },
        );

        // Merge alternate markets into the event's bookmakers
        if (alternateResponse.data.bookmakers) {
          for (const altBookmaker of alternateResponse.data.bookmakers) {
            const existingBookmaker = event.bookmakers.find(
              (b) => b.key === altBookmaker.key,
            );
            if (existingBookmaker) {
              // Add alternate markets to existing bookmaker
              existingBookmaker.markets.push(...altBookmaker.markets);
            } else {
              // Add new bookmaker with alternate markets
              event.bookmakers.push(altBookmaker);
            }
          }
        }

        // Rate limit: 30 req/sec
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (error: any) {
        // Silently skip if alternate markets not available for this event
        if (error.response?.status !== 404) {
          console.warn(
            `  Warning: Could not fetch alternate markets for event ${event.id}`,
          );
        }
      }
    }

    return events;
  } catch (error: any) {
    if (error.response?.status === 404) {
      return []; // No events for this sport
    }
    console.error(
      `Error fetching ${sportKey}:`,
      error.response?.data || error.message,
    );
    return [];
  }
}

// ============================================================================
// MATCHING LOGIC
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

function isFirstHalf(question: string): boolean {
  return /\b1h\b/i.test(question) || /first half/i.test(question);
}

function getOddsAPIMarketKey(
  marketType: MarketType,
  isFirstHalf: boolean,
): string {
  if (isFirstHalf) {
    if (marketType === "h2h") return "h2h_h1";
    if (marketType === "spreads") return "spreads_h1";
    if (marketType === "totals") return "totals_h1";
  }
  return marketType;
}

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

    // Try to find a matching market with the exact line (check both featured and alternate)
    let oddsMarket: OddsAPIMarket | undefined;

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
      // For h2h, just find any matching market
      for (const marketKey of possibleMarketKeys) {
        oddsMarket = bookmaker.markets.find((m) => m.key === marketKey);
        if (oddsMarket) break;
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
      result.skipReason = `No sportsbooks offer line ${pmLine} (${pmMarket.eventTitle} - ${pmMarket.marketType}). Available: ${linesStr || "none"}`;
    } else {
      result.skipReason = "No matching markets";
    }
  }

  return result;
}

// ============================================================================
// DISPLAY
// ============================================================================

function displayMatches(matches: MatchedMarket[]) {
  const matched = matches.filter((m) => Object.keys(m.sportsbooks).length > 0);
  const skipped = matches.filter(
    (m) => Object.keys(m.sportsbooks).length === 0,
  );

  console.log(`\n${"=".repeat(120)}`);
  console.log(`MATCHED MARKETS: ${matched.length}`);
  console.log(`${"=".repeat(120)}\n`);

  for (const match of matched) {
    const pm = match.polymarket;
    const bookmakers = Object.keys(match.sportsbooks);

    console.log(`┌${"─".repeat(118)}┐`);
    console.log(
      `│ ${pm.sport.toUpperCase().padEnd(6)} ${pm.eventTitle.padEnd(109)}│`,
    );
    console.log(`│ ${pm.marketQuestion.padEnd(117)}│`);
    console.log(`├${"─".repeat(118)}┤`);

    // Polymarket
    console.log(`│ POLYMARKET:`.padEnd(120) + "│");
    if (
      pm.outcome1Name &&
      pm.bestBid !== undefined &&
      pm.bestAsk !== undefined
    ) {
      const bid = (pm.bestBid * 100).toFixed(1);
      const ask = (pm.bestAsk * 100).toFixed(1);
      console.log(
        `│   ${pm.outcome1Name.padEnd(30)} Bid: ${bid.padStart(5)}%  Ask: ${ask.padStart(5)}%`.padEnd(
          120,
        ) + "│",
      );
    }
    if (
      pm.outcome2Name &&
      pm.outcome2Bid !== undefined &&
      pm.outcome2Ask !== undefined
    ) {
      const bid = (pm.outcome2Bid * 100).toFixed(1);
      const ask = (pm.outcome2Ask * 100).toFixed(1);
      console.log(
        `│   ${pm.outcome2Name.padEnd(30)} Bid: ${bid.padStart(5)}%  Ask: ${ask.padStart(5)}%`.padEnd(
          120,
        ) + "│",
      );
    }

    console.log(`│`.padEnd(120) + "│");
    console.log(`│ SPORTSBOOKS (${bookmakers.length}):`.padEnd(120) + "│");

    // Sportsbooks - only show outcomes matching the Polymarket line
    const pmLine = extractLine(pm.marketQuestion, pm.marketType);

    for (const bookKey of bookmakers) {
      const bookData = match.sportsbooks[bookKey];
      if (!bookData) continue;
      const { market } = bookData;
      console.log(`│   ${bookKey.toUpperCase()}:`.padEnd(120) + "│");

      for (const outcome of market.outcomes) {
        // For spreads/totals with alternate lines, only show the matching line
        if (pm.marketType === "spreads" || pm.marketType === "totals") {
          if (pmLine !== null && outcome.point !== undefined) {
            // Skip if this outcome doesn't match the Polymarket line
            if (Math.abs(outcome.point - pmLine) >= 0.01) continue;
          }
        }

        const price =
          outcome.price > 0 ? `+${outcome.price}` : `${outcome.price}`;
        const point =
          outcome.point !== undefined
            ? ` (${outcome.point > 0 ? "+" : ""}${outcome.point})`
            : "";
        console.log(
          `│     ${outcome.name.padEnd(30)} ${price.padStart(6)}${point}`.padEnd(
            120,
          ) + "│",
        );
      }
    }

    console.log(`└${"─".repeat(118)}┘\n`);
  }

  // Skipped summary
  if (skipped.length > 0) {
    console.log(`\n${"=".repeat(120)}`);
    console.log(`SKIPPED MARKETS: ${skipped.length}`);
    console.log(`${"=".repeat(120)}\n`);

    const reasons: Record<string, number> = {};
    for (const match of skipped) {
      const reason = match.skipReason || "Unknown";
      reasons[reason] = (reasons[reason] || 0) + 1;
    }

    for (const [reason, count] of Object.entries(reasons).sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`  • ${reason}: ${count}`);
    }
    console.log("");
  }

  // Stats
  console.log(`\n📊 Summary:`);
  console.log(`   • Matched: ${matched.length}`);
  console.log(`   • Skipped: ${skipped.length}`);
  console.log(`   • Total: ${matches.length}\n`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("🎯 Matching Polymarket markets with Sportsbook odds\n");

  // Load cached Polymarket data
  if (!fs.existsSync("polymarket-markets.json")) {
    console.error("❌ polymarket-markets.json not found");
    console.error("   Run: npm run fetch-sports\n");
    process.exit(1);
  }

  const cached = JSON.parse(
    fs.readFileSync("polymarket-markets.json", "utf-8"),
  );
  console.log(
    `📂 Loaded ${cached.markets.length} markets (${cached.timestamp})\n`,
  );

  // Group by sport
  const marketsBySport = cached.markets.reduce(
    (acc: any, market: PolymarketMarket) => {
      if (!acc[market.sport]) acc[market.sport] = [];
      acc[market.sport].push(market);
      return acc;
    },
    {},
  );

  console.log(`📊 Polymarket breakdown:`);
  for (const [sport, markets] of Object.entries(marketsBySport) as [
    string,
    PolymarketMarket[],
  ][]) {
    const uniqueEvents = new Set(markets.map((m) => m.eventTitle)).size;
    console.log(
      `   • ${sport}: ${markets.length} markets across ${uniqueEvents} events`,
    );
  }
  console.log("");

  // Build sets of ALL Polymarket events and those needing first-half markets
  const allPolymarketEventsBySport: Record<string, Set<string>> = {};
  const eventsNeedingFirstHalfBySport: Record<string, Set<string>> = {};

  for (const [pmSport, markets] of Object.entries(marketsBySport) as [
    string,
    PolymarketMarket[],
  ][]) {
    const allEvents = new Set<string>();
    const eventsNeedingFirstHalf = new Set<string>();

    for (const market of markets) {
      if (market.homeTeam && market.awayTeam) {
        // Normalize team names for matching
        const homeNorm = normalizeTeam(market.homeTeam);
        const awayNorm = normalizeTeam(market.awayTeam);
        const eventKey = `${homeNorm}|${awayNorm}`;
        allEvents.add(eventKey);

        if (isFirstHalf(market.marketQuestion)) {
          eventsNeedingFirstHalf.add(eventKey);
        }
      }
    }

    allPolymarketEventsBySport[pmSport] = allEvents;
    eventsNeedingFirstHalfBySport[pmSport] = eventsNeedingFirstHalf;

    if (eventsNeedingFirstHalf.size > 0) {
      console.log(
        `  ${pmSport}: ${eventsNeedingFirstHalf.size}/${allEvents.size} events need 1H markets`,
      );
    }
  }

  // Fetch odds for each sport
  console.log("📡 Fetching sportsbook odds...\n");
  const oddsData: Record<string, OddsAPIEvent[]> = {};

  for (const [pmSport, markets] of Object.entries(marketsBySport)) {
    const oddsApiSport = SPORT_MAP[pmSport];
    if (!oddsApiSport) {
      console.log(`  ⊘ ${pmSport}: No Odds API mapping`);
      continue;
    }

    const allPolymarketEvents =
      allPolymarketEventsBySport[pmSport] || new Set();
    const eventsNeedingFirstHalf =
      eventsNeedingFirstHalfBySport[pmSport] || new Set();
    const events = await fetchOddsForSport(
      oddsApiSport,
      eventsNeedingFirstHalf,
      allPolymarketEvents,
    );
    oddsData[pmSport] = events;

    // Rate limit: 30 req/sec
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log("\n✅ Odds fetched\n");

  // Match markets
  console.log("🔍 Matching markets...\n");
  const allMatches: MatchedMarket[] = [];

  for (const [pmSport, markets] of Object.entries(marketsBySport) as [
    string,
    PolymarketMarket[],
  ][]) {
    const oddsEvents = oddsData[pmSport] || [];

    for (const market of markets) {
      const match = matchMarket(market, oddsEvents);
      allMatches.push(match);
    }
  }

  // Display
  displayMatches(allMatches);
}

main().catch((error) => {
  console.error("\n❌ Error:", error.message);
  process.exit(1);
});
