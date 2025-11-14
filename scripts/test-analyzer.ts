/**
 * Test script for analyzer module (full pipeline test)
 *
 * Runs the complete arbitrage detection pipeline:
 * 1. Discovery → 2. Odds Fetching → 3. Matching → 4. Analysis
 *
 * Run: npx tsx src/arb/test-analyzer.ts
 */

import "dotenv/config";
import { discoverPolymarkets } from "../src/arb/discovery.js";
import { fetchOddsForMarkets } from "../src/arb/odds-fetcher.js";
import { matchMarkets } from "../src/arb/matcher.js";
import { analyzeOpportunities } from "../src/arb/analyzer.js";
import { fetchWalletState } from "../src/arb/wallet.js";
import {
  fetchCurrentPositions,
  fetchOpenOrders,
  computeCapitalSummary,
  buildExposureSnapshotsFromPositions,
} from "../src/arb/positions.js";
import { setExposureFromSnapshot } from "../src/arb/calculator.js";

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

  // Step 4: Get capital for Kelly sizing
  console.log("💰 Step 4: Calculating available capital...");
  const wallet = await fetchWalletState();
  const positions = await fetchCurrentPositions();
  const openOrders = await fetchOpenOrders();
  const exposureSnapshots = buildExposureSnapshotsFromPositions(
    markets,
    positions,
  );
  const totalExposure = exposureSnapshots.reduce(
    (sum, snap) => sum + snap.exposureUSD,
    0,
  );
  console.log(
    `   ✓ Built ${exposureSnapshots.length} exposure snapshots (position exposure: $${totalExposure.toFixed(
      2,
    )})`,
  );
  setExposureFromSnapshot(exposureSnapshots);
  const capital = computeCapitalSummary(
    wallet.usdcBalance,
    positions,
    openOrders,
  );
  console.log(
    `   ✓ Total capital: $${capital.totalCapitalUSD.toFixed(2)} (USDC: $${capital.usdcBalance.toFixed(2)} + Positions: $${capital.totalPositionValueUSD.toFixed(2)})\n`,
  );

  // Step 5: Analyze opportunities
  console.log("📈 Step 5: Analyzing opportunities...");
  const startAnalyze = Date.now();
  const opportunities = analyzeOpportunities(matched, capital.totalCapitalUSD);
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
        const fairProb = (opp.fairProb * 100).toFixed(2);
        const polyAsk = (opp.polymarketAsk * 100).toFixed(2);
        const kellyUSD = opp.kellySize.constrainedSizeUSD.toFixed(0);
        const kellyShares = opp.kellySize.constrainedShares.toFixed(0);

        // Determine which market type for display
        const marketTypeDisplay = opp.marketQuestion
          .toLowerCase()
          .includes("spread")
          ? "spreads"
          : opp.marketQuestion.toLowerCase().includes("o/u") ||
              opp.marketQuestion.toLowerCase().includes("total")
            ? "totals"
            : "h2h";

        console.log(
          `\n   ${i + 1}. ${opp.sport.toUpperCase()} - ${opp.eventTitle}`,
        );
        console.log(`      ${opp.marketQuestion}`);
        console.log(`      ${opp.outcomeName}: +${evPct}% EV`);
        console.log(
          `      True Prob: ${fairProb}% | Polymarket Ask: ${polyAsk}%`,
        );
        console.log(
          `      Method: ${marketTypeDisplay === "h2h" ? "Power" : "Probit"} | Kelly: $${kellyUSD} (${kellyShares} shares)`,
        );
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
        const fairProb = (opp.fairProb * 100).toFixed(2);
        const marginPct = (opp.margin * 100).toFixed(1);
        const targetPrice = (opp.targetPrice * 100).toFixed(1);
        const currentBid = opp.currentBid
          ? (opp.currentBid * 100).toFixed(1)
          : "N/A";
        const kellyUSD = opp.kellySize.constrainedSizeUSD.toFixed(0);
        const kellyShares = opp.kellySize.constrainedShares.toFixed(0);

        // Determine which market type for display
        const marketTypeDisplay = opp.marketQuestion
          .toLowerCase()
          .includes("spread")
          ? "spreads"
          : opp.marketQuestion.toLowerCase().includes("o/u") ||
              opp.marketQuestion.toLowerCase().includes("total")
            ? "totals"
            : "h2h";

        console.log(
          `\n   ${i + 1}. ${opp.sport.toUpperCase()} - ${opp.eventTitle}`,
        );
        console.log(`      ${opp.marketQuestion}`);
        console.log(
          `      ${opp.outcomeName} BID @ ${targetPrice}% (cur: ${currentBid}%)`,
        );
        console.log(`      True Prob: ${fairProb}% | Margin: ${marginPct}%`);
        console.log(
          `      Method: ${marketTypeDisplay === "h2h" ? "Power" : "Probit"} | EV: +${evPct}% | Kelly: $${kellyUSD} (${kellyShares} shares)`,
        );
      });
  }

  // Show de-vigging method info
  console.log("\n\n📐 DE-VIGGING METHODS:");
  console.log(
    "   • Moneylines (H2H): Power/Shin method (corrects favorite-longshot bias)",
  );
  console.log("   • Spreads: Probit method (symmetric 2-way markets)");
  console.log("   • Totals: Probit method (symmetric 2-way markets)");
  console.log("   • 3-way markets: Power method (home/draw/away)");

  console.log("\n\n⚖️  BOOKMAKER WEIGHTS:");
  console.log("   Tier 1 (Sharp books - 80%):");
  console.log("     • Pinnacle: 40%");
  console.log("     • BetOnline: 20%");
  console.log("     • BetAnySports: 10%");
  console.log("     • LowVig: 10%");
  console.log("   Tier 2 (Euro/Regional - 15%):");
  console.log("     • Marathon Bet: 5%");
  console.log("     • Unibet (combined): 5%");
  console.log("     • 888sport: 5%");
  console.log("   Tier 3 (US Recreational - 5%):");
  console.log("     • DraftKings: 2%");
  console.log("     • FanDuel: 2%");
  console.log("     • BetMGM/Caesars: 1%");

  console.log("\n\n✅ Full pipeline test complete!\n");
}

main().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
