/**
 * Test script for matcher module
 *
 * Verifies that we can match Polymarket markets to sportsbook events.
 *
 * Run: npx tsx src/arb/test-matcher.ts
 */

import "dotenv/config";
import { discoverPolymarkets } from "./discovery.js";
import { fetchOddsForMarkets } from "./odds-fetcher.js";
import { matchMarkets } from "./matcher.js";

async function main() {
  console.log("🧪 Testing matcher module...\n");

  // Step 1: Get Polymarket markets
  console.log("📊 Step 1: Discovering Polymarket markets...");
  const markets = await discoverPolymarkets();
  console.log(`   ✓ Found ${markets.length} markets\n`);

  // Step 2: Fetch odds
  console.log("📡 Step 2: Fetching sportsbook odds...");
  const oddsData = await fetchOddsForMarkets(markets);

  let totalOddsEvents = 0;
  for (const events of Object.values(oddsData)) {
    totalOddsEvents += events.length;
  }
  console.log(`   ✓ Fetched odds for ${totalOddsEvents} events\n`);

  // Step 3: Match markets
  console.log("🔗 Step 3: Matching markets...");
  const startTime = Date.now();
  const matched = matchMarkets(markets, oddsData);
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`   ✓ Matched in ${duration}s\n`);

  // Step 4: Analyze results
  console.log("📈 Step 4: Analyzing results...\n");

  const matchedMarkets = matched.filter(
    (m) => Object.keys(m.sportsbooks).length > 0,
  );
  const skippedMarkets = matched.filter(
    (m) => Object.keys(m.sportsbooks).length === 0,
  );

  console.log(`   TOTALS:`);
  console.log(`     • Total markets: ${matched.length}`);
  console.log(`     • Matched: ${matchedMarkets.length}`);
  console.log(`     • Skipped: ${skippedMarkets.length}`);
  console.log(
    `     • Match rate: ${((matchedMarkets.length / matched.length) * 100).toFixed(1)}%`,
  );

  // Breakdown by sport
  console.log(`\n   MATCHED BY SPORT:`);
  const matchedBySport = matchedMarkets.reduce(
    (acc, m) => {
      const sport = m.polymarket.sport;
      acc[sport] = (acc[sport] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  for (const [sport, count] of Object.entries(matchedBySport).sort(
    ([, a], [, b]) => b - a,
  )) {
    const avgBookmakers =
      matchedMarkets
        .filter((m) => m.polymarket.sport === sport)
        .reduce((sum, m) => sum + Object.keys(m.sportsbooks).length, 0) / count;
    console.log(
      `     • ${sport}: ${count} markets (avg ${avgBookmakers.toFixed(1)} bookmakers)`,
    );
  }

  // Breakdown by market type
  console.log(`\n   MATCHED BY TYPE:`);
  const matchedByType = matchedMarkets.reduce(
    (acc, m) => {
      const type = m.polymarket.marketType;
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  for (const [type, count] of Object.entries(matchedByType).sort(
    ([, a], [, b]) => b - a,
  )) {
    console.log(`     • ${type}: ${count}`);
  }

  // Skip reasons
  console.log(`\n   SKIP REASONS:`);
  const skipReasons = skippedMarkets.reduce(
    (acc, m) => {
      const reason = m.skipReason || "Unknown";
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  for (const [reason, count] of Object.entries(skipReasons).sort(
    ([, a], [, b]) => b - a,
  )) {
    // Truncate long reasons
    const shortReason =
      reason.length > 60 ? reason.substring(0, 57) + "..." : reason;
    console.log(`     • ${shortReason}: ${count}`);
  }

  // Step 5: Show sample matched market
  console.log(`\n📋 Sample Matched Market:\n`);

  const sampleMatch = matchedMarkets[0];
  if (sampleMatch) {
    const pm = sampleMatch.polymarket;
    console.log(`   Sport: ${pm.sport.toUpperCase()}`);
    console.log(`   Event: ${pm.eventTitle}`);
    console.log(`   Market: ${pm.marketQuestion}`);
    console.log(`   Type: ${pm.marketType}`);
    console.log(
      `   Bookmakers matched: ${Object.keys(sampleMatch.sportsbooks).length}`,
    );

    console.log(`\n   Polymarket prices:`);
    if (
      pm.outcome1Name &&
      pm.bestBid !== undefined &&
      pm.bestAsk !== undefined
    ) {
      console.log(
        `     • ${pm.outcome1Name}: ${(pm.bestBid * 100).toFixed(1)}% / ${(pm.bestAsk * 100).toFixed(1)}%`,
      );
    }
    if (
      pm.outcome2Name &&
      pm.outcome2Bid !== undefined &&
      pm.outcome2Ask !== undefined
    ) {
      console.log(
        `     • ${pm.outcome2Name}: ${(pm.outcome2Bid * 100).toFixed(1)}% / ${(pm.outcome2Ask * 100).toFixed(1)}%`,
      );
    }

    console.log(`\n   Sportsbook odds:`);
    for (const [bookmakerKey, bookData] of Object.entries(
      sampleMatch.sportsbooks,
    )) {
      const market = bookData.market;
      console.log(`     ${bookmakerKey}:`);
      for (const outcome of market.outcomes.slice(0, 2)) {
        // Show first 2 outcomes
        const price =
          outcome.price > 0 ? `+${outcome.price}` : `${outcome.price}`;
        const point =
          outcome.point !== undefined
            ? ` (${outcome.point > 0 ? "+" : ""}${outcome.point})`
            : "";
        console.log(`       • ${outcome.name}: ${price}${point}`);
      }
    }
  }

  console.log("\n✅ Test complete!\n");
}

main().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
