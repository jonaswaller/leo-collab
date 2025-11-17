/**
 * Full Maker Lifecycle Test (v2)
 *
 * This script tests the complete maker order lifecycle in a way that closely
 * mirrors the live trading loop:
 * 1. Discover markets and analyze opportunities
 * 2. Place an initial batch of maker orders
 * 3. Run several polling cycles to:
 *    - Evaluate existing maker orders (keep/cancel) per maker-taker-rules.md
 *    - Place a small subset of new maker orders at current analyzer prices
 *
 * This script ALWAYS runs in live mode (no dry run). It will place and cancel
 * real orders on Polymarket. Use with care.
 *
 * Adheres to maker-taker-rules.md
 * npm run test-maker-full
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
  buildEnrichedPositions,
  EnrichedPosition,
} from "../src/arb/positions.js";
import { setExposureFromSnapshot } from "../src/arb/calculator.js";
import { placeMakerOrder } from "../src/arb/execution.js";
import {
  registerMakerOrder,
  getTrackedMakerOrders,
  removeMakerOrder,
} from "../src/arb/maker-registry.js";
import { evaluateMakerOrders } from "../src/arb/maker-management.js";
import { getClobClient } from "../src/arb/clob.js";
import { MakerOpportunity } from "../src/arb/types.js";
import {
  fetchBestPricesForTokens,
  enrichMarketsWithClobQuotes,
} from "../src/arb/orderbook.js";
import { POLLING_INTERVAL_MS } from "../src/arb/config.js";

// Simple ANSI color helpers for clearer logs (no emojis).
const RESET = "\x1b[0m";
const BRIGHT = "\x1b[1m";
const DIM = "\x1b[2m";
const FG_GREEN = "\x1b[32m";
const FG_YELLOW = "\x1b[33m";
const FG_CYAN = "\x1b[36m";
const FG_RED = "\x1b[31m";
const FG_MAGENTA = "\x1b[35m";

// ============================================================================
// CONFIGURATION
// ============================================================================

// IMPORTANT: This test script always runs in LIVE mode (no dry run).
// It will place and cancel real orders on Polymarket.
const DRY_RUN = false;
const MAX_MAKERS_TO_PLACE = 5; // Place up to 5 maker orders
const NUM_POLLING_CYCLES = 5; // Run 5 polling cycles

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPositionMap(
  positions: EnrichedPosition[],
): Map<string, EnrichedPosition> {
  const map = new Map<string, EnrichedPosition>();
  for (const pos of positions) {
    map.set(pos.tokenId, pos);
  }
  return map;
}

// ============================================================================
// INITIAL SETUP: PLACE MAKER ORDERS
// ============================================================================

async function placeInitialMakers(): Promise<void> {
  console.log("\n" + "=".repeat(80));
  console.log(`${BRIGHT}INITIAL SETUP: PLACING INITIAL MAKER ORDERS${RESET}`);
  console.log("=".repeat(80));

  // Step 1: Discover markets
  console.log(`\n${FG_CYAN}STEP 1: Discovering Polymarket markets...${RESET}`);
  const markets = await discoverPolymarkets();
  await enrichMarketsWithClobQuotes(markets);
  console.log(`   ✓ Found ${markets.length} markets`);

  if (markets.length === 0) {
    console.log("   ❌ No markets found. Exiting.");
    process.exit(1);
  }

  // Step 2: Fetch odds
  console.log(`\n${FG_CYAN}STEP 2: Fetching sportsbook odds...${RESET}`);
  const oddsData = await fetchOddsForMarkets(markets);
  console.log(`   ✓ Fetched odds`);

  // Step 3: Match markets
  console.log(`\n${FG_CYAN}STEP 3: Matching markets...${RESET}`);
  const matched = matchMarkets(markets, oddsData);
  const matchedCount = matched.filter(
    (m) => Object.keys(m.sportsbooks).length > 0,
  ).length;
  console.log(`   ✓ Matched ${matchedCount}/${matched.length} markets`);

  // Step 4: Get capital & positions
  console.log(`\n${FG_CYAN}STEP 4: Computing capital & positions...${RESET}`);
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
    `   ✓ Total capital: $${capital.totalCapitalUSD.toFixed(2)} (USDC: $${capital.usdcBalance.toFixed(2)}, Positions: $${capital.totalPositionValueUSD.toFixed(2)})`,
  );

  const enrichedPositions = buildEnrichedPositions(markets, positions);
  const positionMap = buildPositionMap(enrichedPositions);

  // Step 5: Analyze opportunities
  console.log(`\n${FG_CYAN}STEP 5: Analyzing opportunities...${RESET}`);
  const opportunities = analyzeOpportunities(matched, capital.totalCapitalUSD);
  console.log(`   ✓ Found ${opportunities.makers.length} maker opportunities`);

  if (opportunities.makers.length === 0) {
    console.log("   ❌ No maker opportunities found. Exiting.");
    process.exit(1);
  }

  // Step 6: Place up to MAX_MAKERS_TO_PLACE maker orders
  console.log(
    `\n${FG_CYAN}STEP 6: Placing up to ${MAX_MAKERS_TO_PLACE} initial maker orders...${RESET}`,
  );

  let placedCount = 0;
  for (const maker of opportunities.makers) {
    if (placedCount >= MAX_MAKERS_TO_PLACE) break;

    const currentPosition = positionMap.get(maker.tokenId);
    const currentShares = currentPosition?.shares || 0;

    // Adjust size for existing position
    const targetShares = maker.kellySize.constrainedShares;
    const sharesToBuy = Math.max(0, targetShares - currentShares);

    // Skip if we already have enough shares
    if (sharesToBuy < maker.minOrderSize) {
      console.log(
        `   [SKIP] ${maker.marketSlug} (${maker.outcomeName}): already own ${currentShares.toFixed(
          2,
        )} shares`,
      );
      continue;
    }

    // Create adjusted opportunity with correct size
    const adjustedMaker: MakerOpportunity = {
      ...maker,
      kellySize: {
        ...maker.kellySize,
        constrainedShares: sharesToBuy,
        constrainedSizeUSD: sharesToBuy * maker.targetPrice,
      },
    };

    try {
      const result = await placeMakerOrder(adjustedMaker, { dryRun: DRY_RUN });

      if (result.orderId) {
        console.log(
          `   ${FG_GREEN}PLACED${RESET} ${maker.marketSlug} (${maker.outcomeName})`,
        );
        console.log(
          `      Order ID: ${result.orderId} | Size: ${sharesToBuy.toFixed(
            2,
          )} shares @ ${(maker.targetPrice * 100).toFixed(1)}%`,
        );
        console.log(
          `      EV: ${(maker.ev * 100).toFixed(2)}% | Fair: ${(
            maker.fairProb * 100
          ).toFixed(1)}%`,
        );

        // Register for tracking
        registerMakerOrder(result.orderId, adjustedMaker, result.preview);
        placedCount++;
      } else {
        console.log(
          `   ${FG_YELLOW}WARN${RESET} Maker placement failed: ${maker.marketSlug} (${maker.outcomeName})`,
        );
      }
    } catch (error: any) {
      console.error(
        `   ❌ Error placing maker for ${maker.marketSlug}:`,
        error.message,
      );
    }

    // Small delay between orders to avoid rate limiting
    await sleep(100);
  }

  console.log(
    `\n${FG_GREEN}INITIAL PLACEMENT COMPLETE${RESET} - placed ${placedCount} maker orders`,
  );

  const tracked = getTrackedMakerOrders();
  console.log(`\n📋 Currently tracking ${tracked.length} maker orders:`);
  for (const order of tracked) {
    console.log(
      `   - ${order.orderId.substring(0, 12)}... | ${order.marketSlug} (${order.outcome === 1 ? "Outcome 1" : "Outcome 2"})`,
    );
    console.log(
      `     Price: ${(order.targetPrice * 100).toFixed(1)}% | Size: ${order.size.toFixed(2)} shares | EV: ${(order.evAtPlacement * 100).toFixed(2)}%`,
    );
  }
}

// ============================================================================
// POLLING CYCLE: EVALUATE AND MANAGE MAKERS
// ============================================================================

async function runPollingCycle(cycleNumber: number): Promise<void> {
  console.log("\n" + "=".repeat(80));
  console.log(`POLLING CYCLE ${cycleNumber} - ${new Date().toISOString()}`);
  console.log("=".repeat(80));

  // Step 1: Discover markets (to get fresh data)
  console.log(`\n${FG_CYAN}STEP 1: Discovering Polymarket markets...${RESET}`);
  const markets = await discoverPolymarkets();
  await enrichMarketsWithClobQuotes(markets);
  console.log(`   ✓ Found ${markets.length} markets`);

  // Step 2: Fetch odds
  console.log(`\n${FG_CYAN}STEP 2: Fetching sportsbook odds...${RESET}`);
  const oddsData = await fetchOddsForMarkets(markets);

  // Step 3: Match markets
  console.log(`\n${FG_CYAN}STEP 3: Matching markets...${RESET}`);
  const matched = matchMarkets(markets, oddsData);

  // Step 4: Get capital & positions
  console.log(`\n${FG_CYAN}STEP 4: Computing capital & positions...${RESET}`);
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

  console.log(`   ✓ Total capital: $${capital.totalCapitalUSD.toFixed(2)}`);

  const enrichedPositions = buildEnrichedPositions(markets, positions);
  const positionMap = buildPositionMap(enrichedPositions);

  // Step 5: Analyze opportunities
  console.log(`\n${FG_CYAN}STEP 5: Analyzing opportunities...${RESET}`);
  const opportunities = analyzeOpportunities(matched, capital.totalCapitalUSD);
  console.log(`   ✓ Found ${opportunities.makers.length} maker opportunities`);

  // Step 6: Evaluate existing maker orders
  console.log(
    `\n${FG_CYAN}STEP 6: Evaluating existing maker orders...${RESET}`,
  );

  try {
    // Build tokenId -> MakerOpportunity lookup so we can match open orders
    // to current opportunities.
    const makersByToken = new Map<string, MakerOpportunity>();
    for (const m of opportunities.makers) {
      makersByToken.set(m.tokenId, m);
    }

    // Fetch current open orders from CLOB
    // Fetch live best bid/ask for all tracked maker tokenIds
    const openOrders = await fetchOpenOrders();

    // Seed / refresh registry from ALL open maker orders that match current
    // MakerOpportunity tokenIds, so the test fully reflects live behaviour.
    for (const o of openOrders) {
      const opp = makersByToken.get(o.asset_id);
      if (!opp) continue;

      const price = parseFloat(o.price ?? "0");
      const size = parseFloat(o.original_size ?? "0");

      registerMakerOrder(o.id, opp, {
        tokenID: opp.tokenId,
        side: "BUY" as any,
        price,
        size,
        orderType: "GTC" as any,
      });
    }

    const tracked = getTrackedMakerOrders();

    if (tracked.length === 0) {
      console.log("\nNo maker orders to evaluate in this cycle.");
      return;
    }

    console.log(
      `\nCurrently tracking ${tracked.length} maker orders before evaluation`,
    );

    // Fetch live best bid/ask for all tracked maker tokenIds
    const tokenIds = tracked.map((t) => t.tokenId);
    const liveBestPrices = await fetchBestPricesForTokens(tokenIds);

    // Filter makers for evaluation (exclude fully satisfied positions)
    const makersForEvaluation = opportunities.makers.filter((maker) => {
      const currentPosition = positionMap.get(maker.tokenId);
      const currentShares = currentPosition?.shares || 0;
      const targetShares = maker.kellySize.constrainedShares;
      return currentShares < targetShares - 1e-6;
    });

    // Run evaluation logic
    const decision = evaluateMakerOrders(
      makersForEvaluation,
      openOrders as any,
      liveBestPrices,
    );

    // Log summary
    console.log(
      `   Evaluation decisions: ${decision.cancelOrderIds.length} to cancel, ${decision.cleanedUpOrderIds.length} cleaned up`,
    );

    // Log detailed reasoning
    if (decision.details.length > 0) {
      console.log("\n   📝 Detailed evaluation:");
      for (const detail of decision.details) {
        console.log(
          `   - Order ${detail.orderId.substring(0, 12)}... (${detail.marketSlug}):`,
        );
        console.log(`     Action: ${detail.action}`);
        console.log(
          `     Current EV: ${detail.currentEV !== null ? (detail.currentEV * 100).toFixed(2) + "%" : "N/A"} | EV at placement: ${(detail.evAtPlacement * 100).toFixed(2)}%`,
        );
        console.log(
          `     Min EV: ${(detail.minEV * 100).toFixed(2)}% | EV drop: ${(detail.evDrop * 100).toFixed(2)}%`,
        );
        if (detail.outbidByAtLeastOneTick) {
          console.log(
            `     Outbid by: ${(detail.outbidBy * 100).toFixed(2)}% (>= 1 tick)`,
          );
        }
        for (const reason of detail.reasons) {
          console.log(`     • ${reason}`);
        }
      }
    }

    // Cancel orders
    if (decision.cancelOrderIds.length > 0) {
      console.log(
        `\n   Cancelling ${decision.cancelOrderIds.length} orders on CLOB...`,
      );

      const client = await getClobClient();

      for (const orderId of decision.cancelOrderIds) {
        try {
          await client.cancelOrder({ orderID: orderId });
          console.log(`   ${FG_GREEN}CANCELLED${RESET} order: ${orderId}`);

          // Remove from tracking
          removeMakerOrder(orderId);

          await sleep(50);
        } catch (error: any) {
          console.error(
            `${FG_RED}ERROR${RESET} cancelling ${orderId}:`,
            error.message,
          );
        }
      }
    }
  } catch (error: any) {
    console.error("   ❌ Error evaluating maker orders:", error.message);
  }

  // Show final state
  const finalTracked = getTrackedMakerOrders();
  console.log(
    `\nAfter evaluation: ${finalTracked.length} maker orders tracked`,
  );
  for (const order of finalTracked) {
    console.log(
      `   - ${order.orderId.substring(0, 12)}... | ${order.marketSlug}`,
    );
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log(`${BRIGHT}MAKER LIFECYCLE TEST (LIVE MODE)${RESET}`);
  console.log("=".repeat(80));
  console.log("Mode: LIVE TRADING (no dry run)");
  console.log(`Max makers to place: ${MAX_MAKERS_TO_PLACE}`);
  console.log(`Polling cycles: ${NUM_POLLING_CYCLES}`);
  console.log(`Polling interval: ${POLLING_INTERVAL_MS / 1000}s`);
  console.log("=".repeat(80));

  console.log(
    `\n${FG_RED}WARNING${RESET}: This script will place and cancel REAL orders on Polymarket.`,
  );
  console.log(
    `${FG_RED}Press Ctrl+C within 5 seconds to abort if this is not intended.${RESET}\n`,
  );
  await sleep(5000);

  // Phase 1: Place initial maker orders
  await placeInitialMakers();

  const tracked = getTrackedMakerOrders();
  if (tracked.length === 0) {
    console.log("\n❌ No maker orders were placed. Exiting.");
    process.exit(1);
  }

  // Phase 2: Run polling cycles
  console.log(
    `\n\n${"=".repeat(80)}\nSTARTING POLLING CYCLES\n${"=".repeat(80)}`,
  );

  for (let i = 1; i <= NUM_POLLING_CYCLES; i++) {
    await runPollingCycle(i);

    const remainingTracked = getTrackedMakerOrders();
    if (remainingTracked.length === 0) {
      console.log(
        `\n${FG_GREEN}All maker orders have been filled or cancelled. Test complete.${RESET}`,
      );
      break;
    }

    if (i < NUM_POLLING_CYCLES) {
      console.log(
        `\nSleeping for ${POLLING_INTERVAL_MS / 1000}s before next cycle...`,
      );
      await sleep(POLLING_INTERVAL_MS);
    }
  }

  // Final summary
  console.log("\n" + "=".repeat(80));
  console.log(`${BRIGHT}TEST COMPLETE${RESET}`);
  console.log("=".repeat(80));

  const finalTracked = getTrackedMakerOrders();
  console.log(
    `\nFinal state: ${finalTracked.length} maker orders still tracked`,
  );

  if (finalTracked.length > 0) {
    console.log("\n📋 Remaining orders:");
    for (const order of finalTracked) {
      console.log(
        `   - ${order.orderId.substring(0, 12)}... | ${order.marketSlug}`,
      );
      console.log(
        `     Price: ${(order.targetPrice * 100).toFixed(1)}% | Size: ${order.size.toFixed(2)} shares`,
      );
    }
  }

  console.log(`\n${FG_GREEN}Test completed successfully.${RESET}`);
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n🛑 Received SIGINT, shutting down...");
  process.exit(0);
});

main().catch((error) => {
  console.error("❌ Fatal error:", error);
  console.error(error.stack);
  process.exit(1);
});
