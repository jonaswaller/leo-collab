import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const GAMMA_API = process.env.GAMMA_API || "https://gamma-api.polymarket.com";
const TIME_WINDOW_HOURS = 6;
const VERBOSE = process.env.VERBOSE === "true" || false;

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

    return response.data;
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

    // Filter by time window
    const filteredEvents = response.data.filter((event) => {
      const startTime = event.startTime || event.startDate || event.eventDate;
      if (!startTime) return false;

      const eventStart = new Date(startTime);
      return eventStart >= now && eventStart <= futureWindow;
    });

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
  console.log(`🌐 Gamma API: ${GAMMA_API}`);
  console.log(
    "═══════════════════════════════════════════════════════════════════\n",
  );

  try {
    // Step 1: Get all sports metadata
    const sports = await getSportsMetadata();

    // Step 2: For each sport, fetch events
    let totalEventsFound = 0;
    let totalMarketsFound = 0;

    for (const sport of sports) {
      const tagIds = sport.tags.split(",").filter((t) => t.trim());

      for (const tagId of tagIds) {
        const events = await getEventsForTag(tagId.trim(), sport.sport);
        totalEventsFound += events.length;

        // Step 3: Display each event and its markets
        events.forEach((event) => {
          totalMarketsFound += event.markets.length;
          displayMarketDetails(event);
        });
      }
    }

    console.log(
      "\n═══════════════════════════════════════════════════════════════════",
    );
    console.log("📈 SUMMARY");
    console.log(
      "═══════════════════════════════════════════════════════════════════",
    );
    console.log(`✓ Total Sports Scanned:     ${sports.length}`);
    console.log(`✓ Total Events Found:       ${totalEventsFound}`);
    console.log(`✓ Total Markets Found:      ${totalMarketsFound}`);
    console.log(`✓ Time Window:              ${TIME_WINDOW_HOURS} hours`);
    console.log(
      "═══════════════════════════════════════════════════════════════════\n",
    );
  } catch (error) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  }
}

main();
