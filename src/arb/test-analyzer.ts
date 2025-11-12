/**
 * Test script for analyzer module (full pipeline test)
 *
 * Runs the complete arbitrage detection pipeline:
 * 1. Discovery → 2. Odds Fetching → 3. Matching → 4. Analysis
 *
 * Run: npx tsx src/arb/test-analyzer.ts
 */

import "dotenv/config";
import { discoverPolymarkets } from "./discovery.js";
import { fetchOddsForMarkets } from "./odds-fetcher.js";
import { matchMarkets } from "./matcher.js";
import { analyzeOpportunities } from "./analyzer.js";

async function main() {
  console.log("🧪 Testing full arbitrage pipeline...\n");
  console.log("=".repeat(80));

  // Step 1: Discovery
  console.log("\n📊 Step 1: Discovering Polymarket markets...");
  const startDiscovery = Date.now();
  const markets = await discoverPolymarkets();
  const discoveryTime = ((Date.now() - startDiscovery) / 1000).toFixed(1);
  console.log(`   ✓ Found ${markets.length} markets in ${discoveryTime}s\n`);

  // Step 2: Fetch odds
  console.log("📡 Step 2: Fetching sportsbook odds...");
  const startOdds = Date.now();
  const oddsData = await fetchOddsForMarkets(markets);
  const oddsTime = ((Date.now() - startOdds) / 1000).toFixed(1);

  let totalOddsEvents = 0;
  for (const events of Object.values(oddsData)) {
    totalOddsEvents += events.length;
  }
  console.log(
    `   ✓ Fetched odds for ${totalOddsEvents} events in ${oddsTime}s\n`,
  );

  // Step 3: Match markets
  console.log("🔗 Step 3: Matching markets...");
  const startMatch = Date.now();
  const matched = matchMarkets(markets, oddsData);
  const matchTime = ((Date.now() - startMatch) / 1000).toFixed(1);

  const matchedCount = matched.filter(
    (m) => Object.keys(m.sportsbooks).length > 0,
  ).length;
  console.log(
    `   ✓ Matched ${matchedCount}/${matched.length} markets in ${matchTime}s\n`,
  );

  // Step 4: Analyze opportunities
  console.log("📈 Step 4: Analyzing opportunities...");
  const startAnalyze = Date.now();
  const opportunities = analyzeOpportunities(matched);
  const analyzeTime = ((Date.now() - startAnalyze) / 1000).toFixed(1);
  console.log(`   ✓ Analysis complete in ${analyzeTime}s\n`);

  // Display results
  console.log("=".repeat(80));
  console.log("📊 RESULTS");
  console.log("=".repeat(80));

  const totalTime = ((Date.now() - startDiscovery) / 1000).toFixed(1);

  console.log(`\n⏱️  Total Pipeline Time: ${totalTime}s`);
  console.log(`   • Discovery: ${discoveryTime}s`);
  console.log(`   • Odds Fetching: ${oddsTime}s`);
  console.log(`   • Matching: ${matchTime}s`);
  console.log(`   • Analysis: ${analyzeTime}s`);

  console.log(`\n💰 TAKER OPPORTUNITIES (immediate execution):`);
  console.log(`   • Total: ${opportunities.takers.length}`);

  if (opportunities.takers.length > 0) {
    // Group by EV range
    const strongTakers = opportunities.takers.filter((t) => t.ev > 0.05);
    const goodTakers = opportunities.takers.filter(
      (t) => t.ev > 0.03 && t.ev <= 0.05,
    );
    const weakTakers = opportunities.takers.filter((t) => t.ev <= 0.03);

    console.log(`   • Strong +EV (>5%): ${strongTakers.length}`);
    console.log(`   • Good +EV (3-5%): ${goodTakers.length}`);
    console.log(`   • Weak +EV (<3%): ${weakTakers.length}`);

    // Show top 5 taker opportunities
    console.log(`\n🎯 Top 5 Taker Opportunities:`);
    opportunities.takers
      .sort((a, b) => b.ev - a.ev)
      .slice(0, 5)
      .forEach((opp, i) => {
        const evPct = (opp.ev * 100).toFixed(2);
        const kellyUSD = opp.kellySize.constrainedSizeUSD.toFixed(0);
        const kellyShares = opp.kellySize.constrainedShares.toFixed(0);
        console.log(
          `\n   ${i + 1}. ${opp.sport.toUpperCase()} - ${opp.eventTitle}`,
        );
        console.log(`      ${opp.marketQuestion}`);
        console.log(`      ${opp.outcomeName}: +${evPct}% EV`);
        console.log(`      Kelly: $${kellyUSD} (${kellyShares} shares)`);
      });
  }

  console.log(`\n\n🏦 MAKER OPPORTUNITIES (limit orders):`);
  console.log(`   • Total: ${opportunities.makers.length}`);

  if (opportunities.makers.length > 0) {
    // Group by EV range
    const strongMakers = opportunities.makers.filter((m) => m.ev > 0.05);
    const goodMakers = opportunities.makers.filter(
      (m) => m.ev > 0.03 && m.ev <= 0.05,
    );
    const weakMakers = opportunities.makers.filter((m) => m.ev <= 0.03);

    console.log(`   • Strong +EV (>5%): ${strongMakers.length}`);
    console.log(`   • Good +EV (3-5%): ${goodMakers.length}`);
    console.log(`   • Weak +EV (<3%): ${weakMakers.length}`);

    // Show top 10 maker opportunities
    console.log(`\n💎 Top 10 Maker Opportunities:`);
    opportunities.makers
      .sort((a, b) => b.ev - a.ev)
      .slice(0, 10)
      .forEach((opp, i) => {
        const evPct = (opp.ev * 100).toFixed(2);
        const marginPct = (opp.margin * 100).toFixed(1);
        const targetPrice = (opp.targetPrice * 100).toFixed(1);
        const currentBid = opp.currentBid
          ? (opp.currentBid * 100).toFixed(1)
          : "N/A";
        const kellyUSD = opp.kellySize.constrainedSizeUSD.toFixed(0);

        console.log(
          `\n   ${i + 1}. ${opp.sport.toUpperCase()} - ${opp.eventTitle}`,
        );
        console.log(`      ${opp.marketQuestion}`);
        console.log(
          `      ${opp.outcomeName} BID @ ${targetPrice}% (cur: ${currentBid}%)`,
        );
        console.log(
          `      Margin: ${marginPct}% | EV: +${evPct}% | Kelly: $${kellyUSD}`,
        );
      });
  }

  console.log("\n\n✅ Full pipeline test complete!\n");
}

main().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
