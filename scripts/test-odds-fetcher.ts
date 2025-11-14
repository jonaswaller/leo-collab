/**
 * Test script for odds-fetcher module
 *
 * Verifies that we can fetch sportsbook odds for Polymarket markets.
 *
 * Run: npx tsx src/arb/test-odds-fetcher.ts
 */

import "dotenv/config";
import { discoverPolymarkets } from "../src/arb/discovery.js";
import { fetchOddsForMarkets } from "../src/arb/odds-fetcher.js";

async function main() {
  console.log("🧪 Testing odds fetcher module...\n");

  // Step 1: Get Polymarket markets
  console.log("📊 Step 1: Discovering Polymarket markets...");
  const markets = await discoverPolymarkets();
  console.log(`   ✓ Found ${markets.length} markets\n`);

  // Group by sport for display
  const marketsBySport = markets.reduce(
    (acc, m) => {
      acc[m.sport] = (acc[m.sport] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  console.log("   Markets by sport:");
  Object.entries(marketsBySport)
    .sort(([, a], [, b]) => b - a)
    .forEach(([sport, count]) => {
      console.log(`     • ${sport}: ${count}`);
    });

  // Step 2: Fetch odds
  console.log("\n📡 Step 2: Fetching sportsbook odds...");
  const startTime = Date.now();
  const oddsData = await fetchOddsForMarkets(markets);
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`   ✓ Fetched odds in ${duration}s\n`);

  // Step 3: Analyze results
  console.log("📈 Step 3: Analyzing results...\n");

  let totalEvents = 0;
  let totalBookmakers = 0;
  let totalMarkets = 0;

  for (const [sport, events] of Object.entries(oddsData)) {
    if (events.length === 0) continue;

    totalEvents += events.length;

    // Count bookmakers and markets
    let sportBookmakers = 0;
    let sportMarkets = 0;

    for (const event of events) {
      sportBookmakers += event.bookmakers.length;
      for (const bookmaker of event.bookmakers) {
        sportMarkets += bookmaker.markets.length;
      }
    }

    totalBookmakers += sportBookmakers;
    totalMarkets += sportMarkets;

    const avgBookmakers = (sportBookmakers / events.length).toFixed(1);
    const avgMarkets = (sportMarkets / events.length).toFixed(1);

    console.log(`   ${sport.toUpperCase()}:`);
    console.log(`     • Events: ${events.length}`);
    console.log(`     • Avg bookmakers per event: ${avgBookmakers}`);
    console.log(`     • Avg markets per event: ${avgMarkets}`);
  }

  console.log(`\n   TOTALS:`);
  console.log(`     • Events: ${totalEvents}`);
  console.log(`     • Bookmakers: ${totalBookmakers}`);
  console.log(`     • Markets: ${totalMarkets}`);

  // Step 4: Show sample event
  console.log("\n📋 Sample Event:\n");

  for (const [sport, events] of Object.entries(oddsData)) {
    if (events.length > 0) {
      const event = events[0];
      if (!event) continue; // Skip if undefined

      console.log(`   Sport: ${sport.toUpperCase()}`);
      console.log(`   Event: ${event.away_team} @ ${event.home_team}`);
      console.log(
        `   Commence: ${new Date(event.commence_time).toLocaleString()}`,
      );
      console.log(`   Bookmakers: ${event.bookmakers.length}`);

      // Show markets from first bookmaker
      if (event.bookmakers.length > 0) {
        const bookmaker = event.bookmakers[0];
        if (!bookmaker) continue; // Skip if undefined

        console.log(`\n   ${bookmaker.title} markets:`);

        // Group markets by type
        const marketTypes = new Set(bookmaker.markets.map((m) => m.key));
        for (const marketType of marketTypes) {
          const marketsOfType = bookmaker.markets.filter(
            (m) => m.key === marketType,
          );
          console.log(`     • ${marketType}: ${marketsOfType.length} lines`);
        }
      }

      break; // Only show first event
    }
  }

  console.log("\n✅ Test complete!\n");
}

main().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
