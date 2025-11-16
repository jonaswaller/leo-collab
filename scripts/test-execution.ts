/**
 * scripts/test-execution.ts
 *
 * Lightweight end-to-end sanity check for Phase 3 execution helpers.
 *
 * - Runs the discovery → odds → matcher → analyzer pipeline
 * - Picks the top taker + maker opportunity
 * - Builds execution previews via executeTakerOrder / placeMakerOrder (dry-run)
 *
 * NOTE: This script does NOT place real orders by default.
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
import { executeTakerOrder, placeMakerOrder } from "../src/arb/execution.js";
import { enrichMarketsWithClobQuotes } from "../src/arb/orderbook.js";

async function main() {
  console.log("== Phase 3 Execution Dry-Run Test ==");

  // 1) Discovery
  console.log("\n📊 Discovering markets...");
  const markets = await discoverPolymarkets();
  await enrichMarketsWithClobQuotes(markets);
  console.log(`   ✓ Found ${markets.length} markets`);

  // 2) Odds
  console.log("\n📡 Fetching sportsbook odds...");
  const oddsData = await fetchOddsForMarkets(markets);

  // 3) Match
  console.log("\n🔗 Matching markets...");
  const matched = matchMarkets(markets, oddsData);

  // 4) Capital & exposure
  console.log("\n💰 Computing capital & exposure...");
  const wallet = await fetchWalletState();
  const positions = await fetchCurrentPositions();
  const openOrders = await fetchOpenOrders();
  const exposureSnapshots = buildExposureSnapshotsFromPositions(
    markets,
    positions,
  );
  setExposureFromSnapshot(exposureSnapshots);
  const capital = computeCapitalSummary(
    wallet.usdcBalance,
    positions,
    openOrders,
  );
  console.log(
    `   ✓ Total capital: $${capital.totalCapitalUSD.toFixed(
      2,
    )} (USDC: $${capital.usdcBalance.toFixed(
      2,
    )}, Positions: $${capital.totalPositionValueUSD.toFixed(2)})`,
  );

  // 5) Analyze
  console.log("\n📈 Analyzing opportunities...");
  const opportunities = analyzeOpportunities(matched, capital.totalCapitalUSD);
  console.log(
    `   ✓ Takers: ${opportunities.takers.length}, Makers: ${opportunities.makers.length}`,
  );

  const bestTaker = opportunities.takers[0];
  const bestMaker = opportunities.makers[0];

  if (!bestTaker && !bestMaker) {
    console.log("\nNo opportunities found to test execution.");
    return;
  }

  // 6) Execution previews (dry-run)
  console.log("\n🚀 Building execution previews (DRY RUN, no real orders)...");

  if (bestTaker) {
    console.log("\n--- Best Taker Opportunity ---");
    console.log({
      marketSlug: bestTaker.marketSlug,
      eventSlug: bestTaker.eventSlug,
      eventTitle: bestTaker.eventTitle,
      marketQuestion: bestTaker.marketQuestion,
      tokenId: bestTaker.tokenId,
      fairProb: bestTaker.fairProb,
      polymarketAsk: bestTaker.polymarketAsk,
      ev: bestTaker.ev,
      kellyUSD: bestTaker.kellySize.constrainedSizeUSD,
      kellyShares: bestTaker.kellySize.constrainedShares,
    });

    const takerExec = await executeTakerOrder(bestTaker, { dryRun: true });
    console.log("Taker execution preview:", takerExec.preview);
  }

  if (bestMaker) {
    console.log("\n--- Best Maker Opportunity ---");
    console.log({
      marketSlug: bestMaker.marketSlug,
      eventSlug: bestMaker.eventSlug,
      eventTitle: bestMaker.eventTitle,
      marketQuestion: bestMaker.marketQuestion,
      tokenId: bestMaker.tokenId,
      fairProb: bestMaker.fairProb,
      targetPrice: bestMaker.targetPrice,
      currentBid: bestMaker.currentBid,
      ev: bestMaker.ev,
      kellyUSD: bestMaker.kellySize.constrainedSizeUSD,
      kellyShares: bestMaker.kellySize.constrainedShares,
    });

    const makerExec = await placeMakerOrder(bestMaker, { dryRun: true });
    console.log("Maker execution preview:", makerExec.preview);
  }

  console.log(
    "\n✅ Execution helpers wired correctly (orders can be posted by setting dryRun=false in real loop).",
  );
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
