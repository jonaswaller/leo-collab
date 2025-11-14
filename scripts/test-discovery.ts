/**
 * Test script for discovery module
 * Run: npx tsx src/arb/test-discovery.ts
 */

import { discoverPolymarkets } from "../src/arb/discovery.js";

async function main() {
  console.log("🧪 Testing Polymarket discovery module...\n");

  const startTime = Date.now();
  const markets = await discoverPolymarkets();
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n✅ Discovery complete in ${duration}s`);
  console.log(`📊 Found ${markets.length} markets\n`);

  // Group by sport
  const bySport = markets.reduce(
    (acc, m) => {
      acc[m.sport] = (acc[m.sport] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  console.log("Markets by sport:");
  Object.entries(bySport)
    .sort(([, a], [, b]) => b - a)
    .forEach(([sport, count]) => {
      console.log(`  • ${sport}: ${count}`);
    });

  // Show a few sample markets
  console.log("\n📋 Sample markets:");
  markets.slice(0, 3).forEach((m) => {
    console.log(`\n  ${m.sport.toUpperCase()} - ${m.eventTitle}`);
    console.log(`  ${m.marketQuestion}`);
    console.log(
      `  Type: ${m.marketType} | Liquidity: $${m.liquidity.toFixed(0)}`,
    );
    if (m.bestBid !== undefined && m.bestAsk !== undefined) {
      console.log(
        `  ${m.outcome1Name}: ${(m.bestBid * 100).toFixed(1)}% / ${(m.bestAsk * 100).toFixed(1)}%`,
      );
    }
  });

  console.log("\n✅ Test complete!\n");
}

main().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
