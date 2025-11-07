import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const GAMMA_API = process.env.GAMMA_API || "https://gamma-api.polymarket.com";
const TIME_WINDOW_HOURS = 24;
const MIN_LIQUIDITY = 1000;
const VERBOSE = "true"
//const VERBOSE = "false"

// Color palette for different events (cycles through)
const EVENT_COLORS = [
  "\x1b[1m\x1b[36m", // Bold Cyan
  "\x1b[1m\x1b[35m", // Bold Magenta
  "\x1b[1m\x1b[33m", // Bold Yellow
  "\x1b[1m\x1b[32m", // Bold Green
  "\x1b[1m\x1b[34m", // Bold Blue
];
let eventColorIndex = 0;

interface PolymarketMarket {
  id: string;
  question: string | null;
  slug: string | null;
  outcomes: string | null;
  outcomePrices: string | null;
  active: boolean | null;
  closed: boolean | null;
  acceptingOrders: boolean | null;
  gameStartTime: string | null;
  eventStartTime: string | null;
  bestBid: number | null;
  bestAsk: number | null;
  lastTradePrice: number | null;
  volume24hr: number | null;
  liquidity: string | null;
  liquidityNum: number | null;
  clobTokenIds: string | null;
}

interface PolymarketEvent {
  id: string;
  title: string | null;
  slug: string | null;
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  active: boolean | null;
  closed: boolean | null;
  live: boolean | null;
  ended: boolean | null;
  liquidity: number | null;
  markets: PolymarketMarket[];
  tags: Array<{ id: number; label: string }>;
  category: string | null;
  eventDate: string | null;
}

interface SportMetadata {
  sport: string;
  image: string;
  resolution: string;
  ordering: string;
  tags: string;
  series: string;
}

async function getSportsMetadata(): Promise<SportMetadata[]> {
  if (VERBOSE) {
    console.log("\n🏀 [STEP 1] Fetching sports metadata from Gamma API...");
    console.log(`   └─ Endpoint: ${GAMMA_API}/sports`);
  }

  try {
    const response = await axios.get<SportMetadata[]>(`${GAMMA_API}/sports`);

    if (VERBOSE) {
      console.log(`   ✓ Found ${response.data.length} sports with metadata`);
      response.data.forEach((sport, idx) => {
        console.log(`   ${idx + 1}. ${sport.sport} (tags: ${sport.tags})`);
      });
    }

    // Fix: Add missing tag 102114 (NCAA Basketball) to CBB sport
    // The /sports endpoint doesn't include this tag, but CBB events actually use it
    const sportsData = response.data.map(sport => {
      if (sport.sport === 'cbb') {
        const tags = sport.tags.split(',');
        if (!tags.includes('102114')) {
          return { ...sport, tags: sport.tags + ',102114' };
        }
      }
      return sport;
    });

    return sportsData;
  } catch (error) {
    console.error("   ✗ Failed to fetch sports metadata:", error);
    throw error;
  }
}

async function getEventsForTag(
  tagId: string,
  sportName: string,
): Promise<PolymarketEvent[]> {
  if (VERBOSE) {
    console.log(
      `\n📊 [STEP 2.${tagId}] Fetching events for ${sportName} (tag_id: ${tagId})...`,
    );
  }

  const now = new Date();
  const futureWindow = new Date(
    now.getTime() + TIME_WINDOW_HOURS * 60 * 60 * 1000,
  );

  if (VERBOSE) {
    console.log(
      `   └─ Time window: ${now.toISOString()} → ${futureWindow.toISOString()}`,
    );
    console.log(
      `   └─ Looking for games starting in next ${TIME_WINDOW_HOURS} hours`,
    );
  }

  try {
    const params = {
      tag_id: tagId,
      closed: false,
      active: true,
      limit: 100,
      offset: 0,
    };

    if (VERBOSE) {
      console.log(
        `   └─ Request: GET ${GAMMA_API}/events?${new URLSearchParams(params as any).toString()}`,
      );
    }

    const response = await axios.get<PolymarketEvent[]>(`${GAMMA_API}/events`, {
      params,
    });

    if (VERBOSE) {
      console.log(
        `   ✓ Received ${response.data.length} total events for ${sportName}`,
      );
    }

    // Filter by time window and liquidity
    const filteredEvents = response.data
      .filter((event) => {
        // Check event-level liquidity first
        const eventLiquidity = parseFloat(event.liquidity?.toString() || "0");
        if (eventLiquidity < MIN_LIQUIDITY) {
          if (VERBOSE && event.title?.toLowerCase().includes("wright")) {
            console.log(`   ⚠️  ${event.title} filtered: liquidity $${eventLiquidity} < $${MIN_LIQUIDITY}`);
          }
          return false;
        }

        // Try event-level timestamps first
        let startTime = event.startTime || event.eventDate;

        // If no valid event-level time, check the first market's gameStartTime
        if (!startTime || new Date(startTime) < now) {
          const firstMarket = event.markets?.[0];
          if (firstMarket?.gameStartTime) {
            startTime = firstMarket.gameStartTime;
          } else if (event.endDate) {
            // Fallback to endDate for events (game time is often in endDate for CBB)
            startTime = event.endDate;
          }
        }

        if (!startTime) {
          if (VERBOSE && event.title?.toLowerCase().includes("wright")) {
            console.log(`   ⚠️  ${event.title} filtered: no valid start time`);
          }
          return false;
        }

        const eventStart = new Date(startTime);
        const isInWindow = eventStart >= now && eventStart <= futureWindow;
        
        if (VERBOSE && event.title?.toLowerCase().includes("wright")) {
          console.log(`   🔍 ${event.title}:`);
          console.log(`      Liquidity: $${eventLiquidity}`);
          console.log(`      Start: ${startTime} (${eventStart.toISOString()})`);
          console.log(`      Now: ${now.toISOString()}`);
          console.log(`      Window: ${futureWindow.toISOString()}`);
          console.log(`      In window: ${isInWindow}`);
        }
        
        return isInWindow;
      })
      .map((event) => {
        // Filter markets by liquidity
        const filteredMarkets = event.markets.filter((market) => {
          const marketLiquidity =
            market.liquidityNum || parseFloat(market.liquidity || "0");
          return marketLiquidity >= MIN_LIQUIDITY;
        });

        // Return event with filtered markets
        return {
          ...event,
          markets: filteredMarkets,
        };
      })
      .filter((event) => event.markets.length > 0); // Only keep events with at least one market

    if (VERBOSE) {
      console.log(
        `   ✓ Filtered to ${filteredEvents.length} events starting within ${TIME_WINDOW_HOURS}h window`,
      );
    }

    return filteredEvents;
  } catch (error) {
    console.error(`   ✗ Failed to fetch events for ${sportName}:`, error);
    return [];
  }
}

function displayMarketDetails(event: PolymarketEvent) {
  const startTime = event.startTime || event.startDate || event.eventDate;
  const timeUntilStart = startTime
    ? Math.round((new Date(startTime).getTime() - Date.now()) / (1000 * 60))
    : null;

  // Get color for this event and increment for next
  const eventColor = EVENT_COLORS[eventColorIndex % EVENT_COLORS.length];
  eventColorIndex++;

  console.log(
    `\n┌─────────────────────────────────────────────────────────────────`,
  );
  console.log(`│ 🎯 ${event.title}`);
  console.log(
    `├─────────────────────────────────────────────────────────────────`,
  );
  console.log(`│ Event ID:     ${event.id}`);
  console.log(`│ Slug:         ${event.slug}`);
  console.log(`│ Liquidity:    $${event.liquidity?.toFixed(2) || "0"}`);
  console.log(`│ Start Time:   ${startTime || "Unknown"}`);
  console.log(
    `│ Time Until:   ${timeUntilStart ? `${timeUntilStart} minutes` : "Unknown"}`,
  );
  console.log(
    `│ Status:       ${event.live ? "🔴 LIVE" : event.ended ? "✓ ENDED" : "⏳ UPCOMING"}`,
  );
  console.log(`│ Active:       ${event.active ? "✓" : "✗"}`);
  console.log(`│ Closed:       ${event.closed ? "✓" : "✗"}`);
  console.log(`│ Markets:      ${event.markets.length}`);
  console.log(
    `├─────────────────────────────────────────────────────────────────`,
  );

  event.markets.forEach((market, idx) => {
    const outcomes = market.outcomes ? JSON.parse(market.outcomes) : [];
    const prices = market.outcomePrices ? JSON.parse(market.outcomePrices) : [];

    console.log(`│`);
    console.log(
      `│ ${eventColor}Market ${idx + 1}:\x1b[0m ${market.question || "Unknown"}`,
    );
    console.log(`│   ├─ Market ID:        ${market.id}`);
    console.log(`│   ├─ Slug:             ${market.slug}`);
    console.log(`│   ├─ CLOB Token IDs:   ${market.clobTokenIds}`);
    console.log(`│   ├─ Active:           ${market.active ? "✓" : "✗"}`);
    console.log(
      `│   ├─ Accepting Orders: ${market.acceptingOrders ? "✓" : "✗"}`,
    );
    console.log(`│   ├─ Liquidity:        $${market.liquidity || "0"}`);
    console.log(
      `│   ├─ Volume (24h):     $${market.volume24hr?.toFixed(2) || "0"}`,
    );
    console.log(`│   └─ Outcomes & Prices:`);

    outcomes.forEach((outcome: string, i: number) => {
      const price = prices[i];
      const probability = price ? (price * 100).toFixed(2) : "N/A";
      const bid = market.bestBid ? (market.bestBid * 100).toFixed(2) : "N/A";
      const ask = market.bestAsk ? (market.bestAsk * 100).toFixed(2) : "N/A";

      console.log(`│       ${i + 1}. ${outcome}`);
      console.log(`│          Price:     ${probability}% (${price || "N/A"})`);
      console.log(`│          Best Bid:  ${bid}%`);
      console.log(`│          Best Ask:  ${ask}%`);
    });
  });

  console.log(
    `└─────────────────────────────────────────────────────────────────\n`,
  );
}

async function main() {
  console.log(
    "═══════════════════════════════════════════════════════════════════",
  );
  console.log("🎲 POLYMARKET SPORTS MARKETS SCANNER");
  console.log(
    "═══════════════════════════════════════════════════════════════════",
  );
  console.log(
    `⏰ Scanning for games starting within next ${TIME_WINDOW_HOURS} hours`,
  );
  console.log(`💰 Minimum liquidity: $${MIN_LIQUIDITY.toLocaleString()}`);
  console.log(`🌐 Gamma API: ${GAMMA_API}`);
  console.log(
    "═══════════════════════════════════════════════════════════════════\n",
  );

  try {
    // Step 1: Get all sports metadata
    const sports = await getSportsMetadata();

    // Step 2: For each sport, fetch events
    const seenEventIds = new Set<string>();
    const uniqueEvents: PolymarketEvent[] = [];
    const eventsBySport = new Map<string, PolymarketEvent[]>();

    for (const sport of sports) {
      const tagIds = sport.tags.split(",").filter((t) => t.trim());
      const sportEvents: PolymarketEvent[] = [];

      for (const tagId of tagIds) {
        const events = await getEventsForTag(tagId.trim(), sport.sport);

        // Deduplicate by event ID
        events.forEach((event) => {
          if (!seenEventIds.has(event.id)) {
            seenEventIds.add(event.id);
            uniqueEvents.push(event);
            sportEvents.push(event);
          }
        });
      }

      if (sportEvents.length > 0) {
        eventsBySport.set(sport.sport, sportEvents);
      }
    }

    // Step 3: Display each unique event and its markets
    let totalMarketsFound = 0;
    uniqueEvents.forEach((event) => {
      totalMarketsFound += event.markets.length;
      displayMarketDetails(event);
    });

    // Step 4: Display enhanced summary
    console.log("\n\x1b[1m\x1b[97m" + "═".repeat(80) + "\x1b[0m");
    console.log("\x1b[1m\x1b[97m" + " ".repeat(32) + "SUMMARY" + " ".repeat(41) + "\x1b[0m");
    console.log("\x1b[1m\x1b[97m" + "═".repeat(80) + "\x1b[0m\n");

    // Overall stats
    console.log("\x1b[1m\x1b[36mOVERALL STATISTICS\x1b[0m");
    console.log("\x1b[90m" + "─".repeat(80) + "\x1b[0m");
    console.log(`  \x1b[97mTotal Sports Scanned:\x1b[0m        ${sports.length}`);
    console.log(`  \x1b[97mSports with Events:\x1b[0m          \x1b[32m${eventsBySport.size}\x1b[0m`);
    console.log(`  \x1b[97mTotal Events Found:\x1b[0m          \x1b[32m${uniqueEvents.length}\x1b[0m`);
    console.log(`  \x1b[97mTotal Markets Found:\x1b[0m         \x1b[32m${totalMarketsFound}\x1b[0m`);
    console.log(`  \x1b[97mTime Window:\x1b[0m                 Past ${TIME_WINDOW_HOURS} hours`);
    console.log(`  \x1b[97mMin Liquidity Filter:\x1b[0m        $${MIN_LIQUIDITY.toLocaleString()}`);

    if (eventsBySport.size > 0) {
      console.log("\n\x1b[1m\x1b[36mBREAKDOWN BY SPORT\x1b[0m");
      console.log("\x1b[90m" + "─".repeat(80) + "\x1b[0m");

      // Sort sports by number of events (descending)
      const sortedSports = Array.from(eventsBySport.entries()).sort(
        (a, b) => b[1].length - a[1].length
      );

      sortedSports.forEach(([sportName, events], idx) => {
        const totalMarkets = events.reduce((sum, e) => sum + e.markets.length, 0);
        console.log(
          `\n  \x1b[1m\x1b[33m[${idx + 1}] ${sportName.toUpperCase()}\x1b[0m`
        );
        console.log(`      Events:  \x1b[32m${events.length}\x1b[0m`);
        console.log(`      Markets: \x1b[32m${totalMarkets}\x1b[0m`);

        events.forEach((event, eventIdx) => {
          const startTime = event.startTime || event.startDate || event.eventDate;
          const timeAgo = startTime
            ? Math.round((Date.now() - new Date(startTime).getTime()) / (1000 * 60))
            : null;
          const timeStr = timeAgo !== null ? `${timeAgo}m ago` : "Unknown";
          
          console.log(
            `      ${eventIdx + 1}. \x1b[97m${event.title}\x1b[0m`
          );
          console.log(
            `         \x1b[90mMarkets: ${event.markets.length} | Liquidity: $${event.liquidity?.toFixed(0) || "0"} | Started: ${timeStr}\x1b[0m`
          );
        });
      });
    }

    console.log("\n\x1b[1m\x1b[97m" + "═".repeat(80) + "\x1b[0m\n");
  } catch (error) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  }
}

main();
