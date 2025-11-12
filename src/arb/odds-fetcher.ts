/**
 * Sportsbook Odds Fetcher
 *
 * Fetches odds from The Odds API for sports betting markets.
 * Refactored from scripts/match-odds.ts to be reusable in a loop.
 *
 * Key optimizations:
 * - Only fetches events that exist in Polymarket (saves API credits)
 * - Fetches alternate lines for ALL events (to match any Polymarket line)
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

async function fetchOddsForSport(
  sportKey: string,
  eventsNeedingFirstHalf: Set<string>,
  allPolymarketEvents: Set<string>,
): Promise<OddsAPIEvent[]> {
  try {
    // Step 1: Fetch main markets (h2h, spreads, totals)
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

    // Step 2: Filter to only events that exist in Polymarket
    // This saves API credits by not fetching alternate lines for irrelevant events
    const events = allEvents.filter((event) => {
      const homeNorm = normalizeTeam(event.home_team);
      const awayNorm = normalizeTeam(event.away_team);

      for (const pmEventKey of allPolymarketEvents) {
        const [pmHome, pmAway] = pmEventKey.split("|");
        if (!pmHome || !pmAway) continue;

        // Check both orderings (home/away can be flipped)
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

    // Step 3: Fetch alternate lines for ALL matched events
    // This ensures we can match any Polymarket line (e.g., O/U 228.5, 229.5, 230.5)
    for (const event of events) {
      try {
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

        // Rate limit: 30 req/sec = ~33ms between requests
        await sleep(50);
      } catch (error: any) {
        // Silently skip if alternate markets not available for this event
        if (error.response?.status !== 404) {
          console.warn(
            `[Odds] Warning: Could not fetch alternate markets for event ${event.id}`,
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
      `[Odds] Error fetching ${sportKey}:`,
      error.response?.data || error.message,
    );
    return [];
  }
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

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
      acc[market.sport]!.push(market); // Non-null assertion since we just created it
      return acc;
    },
    {} as Record<string, PolymarketMarket[]>,
  );

  // Step 2: Build sets of Polymarket events per sport
  // This allows us to filter Odds API results to only relevant events
  const allPolymarketEventsBySport: Record<string, Set<string>> = {};
  const eventsNeedingFirstHalfBySport: Record<string, Set<string>> = {};

  for (const [pmSport, sportMarkets] of Object.entries(marketsBySport)) {
    const allEvents = new Set<string>();
    const eventsNeedingFirstHalf = new Set<string>();

    for (const market of sportMarkets) {
      if (!market) continue; // Skip undefined markets
      if (market.homeTeam && market.awayTeam) {
        // Normalize team names for matching
        const homeNorm = normalizeTeam(market.homeTeam);
        const awayNorm = normalizeTeam(market.awayTeam);
        const eventKey = `${homeNorm}|${awayNorm}`;
        allEvents.add(eventKey);

        // Track if this event needs first-half markets
        if (isFirstHalf(market.marketQuestion)) {
          eventsNeedingFirstHalf.add(eventKey);
        }
      }
    }

    allPolymarketEventsBySport[pmSport] = allEvents;
    eventsNeedingFirstHalfBySport[pmSport] = eventsNeedingFirstHalf;
  }

  // Step 3: Fetch odds for each sport
  const oddsData: Record<string, OddsAPIEvent[]> = {};

  for (const [pmSport, sportMarkets] of Object.entries(marketsBySport)) {
    const oddsApiSport = SPORT_MAP[pmSport];
    if (!oddsApiSport) {
      console.log(`[Odds] No mapping for sport: ${pmSport}`);
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

    // Rate limit between sports: 30 req/sec
    await sleep(100);
  }

  return oddsData;
}
