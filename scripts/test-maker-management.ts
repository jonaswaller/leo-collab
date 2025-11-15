/**
 * scripts/test-maker-management.ts
 *
 * Dry-run test for Phase 4 maker order evaluation.
 *
 * This script:
 * - Runs the full discovery → odds → match → analyze pipeline
 * - Simulates having placed a few maker orders (using the current top makers)
 * - Runs evaluateMakerOrders() against the same pipeline snapshot
 * - Logs which orders would be cancelled or reposted
 *
 * NOTE: This does NOT talk to the CLOB for cancels or postings.
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
import { registerMakerOrder } from "../src/arb/maker-registry.js";
import { evaluateMakerOrders } from "../src/arb/maker-management.js";
import { MakerOpportunity } from "../src/arb/types.js";

async function main() {
  console.log("== Phase 4 Maker Management Dry-Run Test ==");

  // 1) Discovery
  console.log("\n📊 Discovering markets...");
  const markets = await discoverPolymarkets();
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

  console.log(
    `   ⚙️  Open orders from CLOB: ${openOrders.length} (will try to match by tokenId)`,
  );
  if (openOrders.length > 0) {
    console.log("   Sample open order:", openOrders[0]);
  }

  if (opportunities.makers.length === 0) {
    console.log("\nNo maker opportunities found, nothing to evaluate.");
    return;
  }

  // 6) Seed the maker registry from REAL open orders that match current maker opportunities.
  const matchedOrderIds: string[] = [];
  const unmatchedOrderIds: string[] = [];

  for (const o of openOrders) {
    // Match by tokenId first; token IDs are globally unique for outcomes.
    const m = opportunities.makers.find((opp) => opp.tokenId === o.asset_id);

    if (!m) {
      unmatchedOrderIds.push(o.id);
      continue;
    }

    const price = parseFloat(o.price ?? "0");
    const size = parseFloat(o.original_size ?? "0");

    registerMakerOrder(o.id, m, {
      tokenID: m.tokenId,
      side: "BUY" as any,
      price,
      size,
      orderType: "GTC" as any,
    });
    matchedOrderIds.push(o.id);
  }

  console.log(
    `\nSeeded maker registry with ${matchedOrderIds.length} real open maker orders.`,
  );
  if (unmatchedOrderIds.length > 0) {
    console.log(
      "⚠️  These open orders could not be matched to any MakerOpportunity (tokenId not in current makers):",
      unmatchedOrderIds,
    );
  }

  // 7) Evaluate maker orders using the CURRENT snapshot of makers + real open orders.
  console.log("\n🔍 Evaluating maker orders (dry-run)...");
  const decision = evaluateMakerOrders(opportunities.makers, openOrders as any);

  console.log("\nDecisions:");
  console.log("  Cancel these orderIds:", decision.cancelOrderIds);
  console.log(
    "  Replacement makers (oldOrderId → marketSlug/outcome/targetPrice):",
  );
  for (const repl of decision.replacementMakers) {
    const m = repl.opportunity;
    console.log({
      oldOrderId: repl.oldOrderId,
      marketSlug: m.marketSlug,
      outcomeName: m.outcomeName,
      targetPrice: m.targetPrice,
      ev: m.ev,
    });
  }

  if (decision.details.length > 0) {
    console.log("\nPer-order reasoning:");
    for (const d of decision.details) {
      console.log(
        `\nOrder ${d.orderId} (${d.marketSlug} outcome ${d.outcome})`,
      );
      console.log(`  Action: ${d.action}`);
      console.log(
        `  EV now: ${
          d.currentEV === null ? "n/a" : d.currentEV.toFixed(4)
        }, EV at placement: ${d.evAtPlacement.toFixed(4)}, minEV: ${d.minEV.toFixed(
          4,
        )}, EV drop: ${d.evDrop.toFixed(4)}`,
      );
      console.log(
        `  Outbid by: ${d.outbidBy.toFixed(
          4,
        )} (>=1 tick? ${d.outbidByAtLeastOneTick})`,
      );
      for (const r of d.reasons) {
        console.log(`  - ${r}`);
      }
    }
  }

  console.log(
    "\n✅ Maker management evaluation logic is wired (no real cancels/posts performed).",
  );
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
