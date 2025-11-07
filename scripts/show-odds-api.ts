import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_API_HOST =
  process.env.ODDS_API_HOST || "https://api.the-odds-api.com/v4";
const TIME_WINDOW_HOURS = 24; // 24 hours uses a lot of API credits
const VERBOSE = process.env.VERBOSE === "true" || false;

// Bookmakers for weighted consensus (matches ARB_BOOKMAKER_WEIGHTS in .env)
// We only fetch from books we'll use in our de-vig calculation to reduce API costs
// Weights: pinnacle: 0.45 (sharpest/most efficient), betonlineag: 0.15, 
//          draftkings: 0.20, fanduel: 0.20
const BOOKMAKERS = ["pinnacle", "betonlineag", "draftkings", "fanduel"];

// Color palette for different sports
const SPORT_COLORS = [
  "\x1b[1m\x1b[36m", // Bold Cyan
  "\x1b[1m\x1b[35m", // Bold Magenta
  "\x1b[1m\x1b[33m", // Bold Yellow
  "\x1b[1m\x1b[32m", // Bold Green
  "\x1b[1m\x1b[34m", // Bold Blue
];
let sportColorIndex = 0;

export interface OddsApiSport {
  key: string;
  group: string;
  title: string;
  description: string;
  active: boolean;
  has_outrights: boolean;
}

export interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
}

export interface OddsApiMarket {
  key: string;
  last_update?: string;
  outcomes: OddsApiOutcome[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
}

export interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

/**
 * Fuzzy match team names to handle variations
 * Examples: "Thunder" matches "Oklahoma City Thunder"
 *          "Lakers" matches "Los Angeles Lakers"
 */
function teamNamesMatch(name1: string, name2: string): boolean {
  const n1 = name1.toLowerCase().trim();
  const n2 = name2.toLowerCase().trim();
  
  // Exact match
  if (n1 === n2) return true;
  
  // One contains the other
  if (n1.includes(n2) || n2.includes(n1)) return true;
  
  // Extract last word (team name) and compare
  const last1 = n1.split(' ').pop() || '';
  const last2 = n2.split(' ').pop() || '';
  
  return last1 === last2;
}

/**
 * Fetches list of active sports from Odds API
 */
async function getSports(): Promise<OddsApiSport[]> {
  if (VERBOSE) {
    console.log("\n🏀 [STEP 1] Fetching active sports from Odds API...");
    console.log(`   └─ Endpoint: ${ODDS_API_HOST}/sports`);
  }

  try {
    const response = await axios.get<OddsApiSport[]>(
      `${ODDS_API_HOST}/sports`,
      {
        params: {
          apiKey: ODDS_API_KEY,
        },
      },
    );

    if (VERBOSE) {
      console.log(`   ✓ Found ${response.data.length} active sports`);
      response.data.slice(0, 5).forEach((sport, idx) => {
        console.log(`   ${idx + 1}. ${sport.title} (${sport.key})`);
      });
      if (response.data.length > 5) {
        console.log(`   ... and ${response.data.length - 5} more`);
      }
    }

    return response.data;
  } catch (error) {
    console.error("   ✗ Failed to fetch sports:", error);
    throw error;
  }
}

interface OddsApiEventBasic {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

/**
 * Fetches events for a specific sport (free, no API cost)
 */
async function getEventsForSport(
  sportKey: string,
  sportTitle: string,
): Promise<OddsApiEventBasic[]> {
  if (VERBOSE) {
    console.log(`\n📊 [STEP 2] Fetching events for ${sportTitle}...`);
  }

  const now = new Date();
  const futureWindow = new Date(
    now.getTime() + TIME_WINDOW_HOURS * 60 * 60 * 1000,
  );

  try {
    const params: any = {
      apiKey: ODDS_API_KEY,
    };

    if (VERBOSE) {
      console.log(
        `   └─ Request: GET ${ODDS_API_HOST}/sports/${sportKey}/events (FREE)`,
      );
    }

    const response = await axios.get<OddsApiEventBasic[]>(
      `${ODDS_API_HOST}/sports/${sportKey}/events`,
      { params },
    );

    if (VERBOSE) {
      console.log(`   ✓ Found ${response.data.length} events for ${sportTitle}`);
    }

    // Filter events by time window
    const filteredEvents = response.data.filter((event) => {
      const commenceTime = new Date(event.commence_time);
      return commenceTime >= now && commenceTime <= futureWindow;
    });

    if (VERBOSE && filteredEvents.length !== response.data.length) {
      console.log(
        `   ℹ️  Filtered to ${filteredEvents.length} events within ${TIME_WINDOW_HOURS}h window`,
      );
    }

    return filteredEvents;
  } catch (error: any) {
    if (error.response?.status === 429) {
      console.error(`   ✗ Rate limited! Slow down requests.`);
    } else if (error.response?.status === 422) {
      console.error(
        `   ✗ No events available for ${sportTitle} (might be off-season)`,
      );
    } else {
      console.error(
        `   ✗ Failed to fetch events for ${sportTitle}:`,
        error.message,
      );
    }
    return [];
  }
}

/**
 * Fetches ALL available markets for a specific event
 * This is expensive - costs based on number of unique markets returned
 */
async function getMarketsForEvent(
  sportKey: string,
  eventId: string,
  eventTitle: string,
): Promise<OddsApiEvent | null> {
  if (VERBOSE) {
    console.log(`\n   📈 Fetching markets for: ${eventTitle}`);
    console.log(`   └─ Market types: h2h (moneyline), spreads, totals (O/U)`);
    console.log(`   └─ Bookmakers: ${BOOKMAKERS.join(", ")}`);
  }

  try {
    const params: any = {
      apiKey: ODDS_API_KEY,
      regions: "us",
      oddsFormat: "american",
      // Explicitly request core market types
      // h2h = moneyline (winner), spreads = point spreads, totals = over/under
      markets: "h2h,spreads,totals",
      // Only fetch from bookmakers we care about (reduces API cost & noise)
      bookmakers: BOOKMAKERS.join(","),
    };

    const response = await axios.get<OddsApiEvent>(
      `${ODDS_API_HOST}/sports/${sportKey}/events/${eventId}/odds`,
      { params },
    );

    // Check rate limit headers
    const remaining = response.headers["x-requests-remaining"];
    const used = response.headers["x-requests-used"];
    const lastCost = response.headers["x-requests-last"];

    if (VERBOSE) {
      const bookmakerCount = response.data.bookmakers.length;
      const totalMarkets = response.data.bookmakers.reduce(
        (sum, book) => sum + book.markets.length,
        0,
      );
      const uniqueMarketTypes = new Set(
        response.data.bookmakers.flatMap((b) => b.markets.map((m) => m.key))
      );
      
      console.log(`   ✓ Found ${bookmakerCount} bookmaker(s) with ${totalMarkets} market entries`);
      console.log(`   ✓ Market types returned: ${Array.from(uniqueMarketTypes).join(", ")}`);
      console.log(
        `   ℹ️  API Usage: ${used} used, ${remaining} remaining (last cost: ${lastCost} credit(s))`,
      );
    }

    return response.data;
  } catch (error: any) {
    if (error.response?.status === 429) {
      console.error(`   ✗ Rate limited! Slow down requests.`);
    } else {
      console.error(`   ✗ Failed to fetch markets:`, error.message);
    }
    return null;
  }
}

/**
 * Search for a specific matchup and return odds (MAIN EXPORT for other scripts)
 * This is PM-driven: only fetch odds for games that exist on Polymarket
 */
export async function getOddsForMatchup(
  sportKey: string,        // "basketball_nba"
  homeTeam: string,        // "Sacramento Kings" or "Kings"
  awayTeam: string,        // "Oklahoma City Thunder" or "Thunder"
): Promise<OddsApiEvent | null> {
  
  // Step 1: Get all events for this sport (FREE - no API cost)
  const events = await getEventsForSport(sportKey, sportKey);
  
  if (events.length === 0) {
    return null;
  }
  
  // Step 2: Find the matching event by team names (fuzzy match)
  const matchedEvent = events.find(event => {
    const homeMatch = teamNamesMatch(event.home_team, homeTeam);
    const awayMatch = teamNamesMatch(event.away_team, awayTeam);
    return homeMatch && awayMatch;
  });
  
  if (!matchedEvent) {
    return null;
  }
  
  // Step 3: Fetch odds for JUST THIS EVENT (costs credits)
  return await getMarketsForEvent(
    sportKey,
    matchedEvent.id,
    `${matchedEvent.away_team} @ ${matchedEvent.home_team}`
  );
}

function getMarketTypeLabel(marketKey: string): string {
  const labels: Record<string, string> = {
    h2h: "💰 MONEYLINE",
    spreads: "📊 SPREAD",
    totals: "🎯 TOTALS (O/U)",
    h2h_lay: "💰 MONEYLINE (Lay)",
    outrights: "🏆 OUTRIGHT",
    player_props: "👤 PLAYER PROPS",
  };
  return labels[marketKey] || `❓ ${marketKey.toUpperCase()}`;
}

function displayEventDetails(event: OddsApiEvent) {
  const commenceTime = new Date(event.commence_time);
  const timeUntilStart = Math.round(
    (commenceTime.getTime() - Date.now()) / (1000 * 60),
  );
  const hours = Math.floor(timeUntilStart / 60);
  const mins = timeUntilStart % 60;
  const timeDisplay =
    hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  // Get color for this sport
  const sportColor = SPORT_COLORS[sportColorIndex % SPORT_COLORS.length];

  // Count unique market types across all bookmakers
  const marketTypes = new Set<string>();
  event.bookmakers.forEach((book) => {
    book.markets.forEach((market) => marketTypes.add(market.key));
  });

  console.log(
    `\n┌${"─".repeat(80)}┐`,
  );
  console.log(
    `│ ${sportColor}${event.sport_title}\x1b[0m: ${event.away_team} @ ${event.home_team}`.padEnd(91) + "│",
  );
  console.log(
    `├${"─".repeat(80)}┤`,
  );
  console.log(`│ 🆔 Event ID:      ${event.id}`.padEnd(91) + "│");
  console.log(`│ ⏰ Starts:        ${event.commence_time} (in ${timeDisplay})`.padEnd(91) + "│");
  console.log(`│ 📚 Bookmakers:    ${event.bookmakers.length}`.padEnd(91) + "│");
  console.log(`│ 📊 Market Types:  ${Array.from(marketTypes).join(", ")}`.padEnd(91) + "│");
  console.log(
    `├${"─".repeat(80)}┤`,
  );

  // Show all bookmakers (we only fetch the 4 we care about)
  event.bookmakers.forEach((bookmaker, idx) => {
    console.log(`│`);
    console.log(`│ 📚 \x1b[1m${bookmaker.title}\x1b[0m`.padEnd(91) + "│");
    console.log(`│    Updated: ${new Date(bookmaker.last_update).toLocaleString()}`.padEnd(91) + "│");
    console.log(`│`);

    bookmaker.markets.forEach((market) => {
      const marketLabel = getMarketTypeLabel(market.key);
      console.log(`│    ${marketLabel}`.padEnd(91) + "│");
      
      market.outcomes.forEach((outcome) => {
        const point = outcome.point ? ` (${outcome.point > 0 ? "+" : ""}${outcome.point})` : "";
        const odds = outcome.price > 0 ? `+${outcome.price}` : `${outcome.price}`;
        console.log(
          `│       • ${outcome.name}${point}: \x1b[33m${odds}\x1b[0m`.padEnd(100) + "│",
        );
      });
    });
  });

  console.log(
    `└${"─".repeat(80)}┘\n`,
  );
}

async function main() {
  console.log("\n" +
    "═".repeat(80),
  );
  console.log(" ".repeat(28) + "📊 ODDS API SPORTS SCANNER");
  console.log(
    "═".repeat(80),
  );
  console.log(
    `  ⏰ Time Window:     Next ${TIME_WINDOW_HOURS} hours (pre-match only)`,
  );
  console.log(
    `  📊 Markets:         Moneyline (h2h), Spreads, Totals (O/U)`,
  );
  console.log(
    `  📚 Bookmakers:      Pinnacle, BetOnline, DraftKings, FanDuel`,
  );
  console.log(
    `  🌐 API Endpoint:    ${ODDS_API_HOST}`,
  );
  console.log(
    "═".repeat(80) + "\n",
  );

  if (!ODDS_API_KEY) {
    console.error("❌ ERROR: ODDS_API_KEY not found in .env file!");
    console.error("   Please add ODDS_API_KEY=your_key_here to your .env file\n");
    process.exit(1);
  }

  try {
    // Step 1: Get all active sports
    const sports = await getSports();

    console.log(`\n🎯 Scanning ALL ${sports.length} active sports...`);
    console.log(`📊 Market Types: h2h (moneyline), spreads, totals (O/U)`);
    console.log(`📚 Bookmakers: ${BOOKMAKERS.length} selected (${BOOKMAKERS.join(", ")})`);
    console.log(
      `⚠️  API Cost: Each event costs based on number of markets & bookmakers returned\n`,
    );

    // Step 2: Fetch events for each sport (free)
    let totalEventsFound = 0;
    let totalBookmakersFound = 0;
    let totalSportsWithEvents = 0;
    let totalMarketsFound = 0;
    const marketTypeCount = new Map<string, number>();
    const sportEventMap = new Map<string, number>();

    for (const sport of sports) {
      sportColorIndex++;

      // Step 2a: Get events (free, no cost)
      const events = await getEventsForSport(sport.key, sport.title);

      if (events.length > 0) {
        totalSportsWithEvents++;
        totalEventsFound += events.length;
        sportEventMap.set(sport.title, events.length);

        console.log(`\n\x1b[36m▶ ${sport.title}: Found ${events.length} upcoming event(s)\x1b[0m`);

        // Step 2b: For each event, get ALL markets (costs credits)
        for (const event of events) {
          const eventTitle = `${event.away_team} @ ${event.home_team}`;
          const eventWithOdds = await getMarketsForEvent(
            sport.key,
            event.id,
            eventTitle,
          );

          if (eventWithOdds) {
            totalBookmakersFound += eventWithOdds.bookmakers.length;
            
            // Count market types
            eventWithOdds.bookmakers.forEach((book) => {
              book.markets.forEach((market) => {
                totalMarketsFound++;
                marketTypeCount.set(
                  market.key,
                  (marketTypeCount.get(market.key) || 0) + 1,
                );
              });
            });

            displayEventDetails(eventWithOdds);
          }

          // Delay to avoid rate limiting (30 req/sec = ~35ms between requests)
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      // Small delay between sports
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log(
      "\n\x1b[1m\x1b[97m" + "═".repeat(80) + "\x1b[0m",
    );
    console.log("\x1b[1m\x1b[97m" + " ".repeat(35) + "SUMMARY" + " ".repeat(38) + "\x1b[0m");
    console.log("\x1b[1m\x1b[97m" + "═".repeat(80) + "\x1b[0m\n");

    console.log("\x1b[1m\x1b[36m📊 OVERALL STATISTICS\x1b[0m");
    console.log("\x1b[90m" + "─".repeat(80) + "\x1b[0m");
    console.log(`  \x1b[97mSports Scanned:\x1b[0m            ${sports.length}`);
    console.log(`  \x1b[97mSports with Events:\x1b[0m        \x1b[32m${totalSportsWithEvents}\x1b[0m`);
    console.log(`  \x1b[97mTotal Events Found:\x1b[0m        \x1b[32m${totalEventsFound}\x1b[0m`);
    console.log(`  \x1b[97mTotal Bookmakers:\x1b[0m          \x1b[32m${totalBookmakersFound}\x1b[0m`);
    console.log(`  \x1b[97mTotal Market Entries:\x1b[0m      \x1b[32m${totalMarketsFound}\x1b[0m`);
    console.log(`  \x1b[97mTime Window:\x1b[0m               Next ${TIME_WINDOW_HOURS} hours (pre-match)`);

    if (marketTypeCount.size > 0) {
      console.log("\n\x1b[1m\x1b[36m📈 MARKET TYPE BREAKDOWN\x1b[0m");
      console.log("\x1b[90m" + "─".repeat(80) + "\x1b[0m");
      Array.from(marketTypeCount.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, count]) => {
          const label = getMarketTypeLabel(type);
          console.log(`  ${label}: \x1b[32m${count}\x1b[0m entries`);
        });
    }

    if (sportEventMap.size > 0) {
      console.log("\n\x1b[1m\x1b[36m🏆 EVENTS BY SPORT\x1b[0m");
      console.log("\x1b[90m" + "─".repeat(80) + "\x1b[0m");
      Array.from(sportEventMap.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([sport, count]) => {
          console.log(`  \x1b[97m${sport}:\x1b[0m \x1b[32m${count}\x1b[0m event(s)`);
        });
    }

    console.log("\n\x1b[1m\x1b[97m" + "═".repeat(80) + "\x1b[0m\n");
  } catch (error) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  }
}

// Only run main if this script is executed directly (not imported)
// In ES modules, check if this file is the entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
