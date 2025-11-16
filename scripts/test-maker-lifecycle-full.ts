/**
 * Full Maker Lifecycle Test
 *
 * This script tests the complete maker order lifecycle:
 * 1. Discover markets and analyze opportunities
 * 2. Place up to 5 maker orders
 * 3. Run 5 polling cycles (15s each) to test maker management:
 *    - Evaluate existing orders
 *    - Cancel orders that no longer meet EV thresholds
 *    - Replace orders that are outbid
 *    - Keep orders that are still good
 *
 * Adheres to maker-taker-rules.md
 * DRY_RUN=false npm run test-maker-full
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

// ============================================================================
// CONFIGURATION
// ============================================================================

const DRY_RUN = process.env.DRY_RUN !== "false"; // Default to dry-run
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
  console.log("INITIAL SETUP: PLACING MAKER ORDERS");
  console.log("=".repeat(80));

  // Step 1: Discover markets
  console.log("\n📊 Discovering Polymarket markets...");
  const markets = await discoverPolymarkets();
  await enrichMarketsWithClobQuotes(markets);
  console.log(`   ✓ Found ${markets.length} markets`);

  if (markets.length === 0) {
    console.log("   ❌ No markets found. Exiting.");
    process.exit(1);
  }

  // Step 2: Fetch odds
  console.log("\n📡 Fetching sportsbook odds...");
  const oddsData = await fetchOddsForMarkets(markets);
  console.log(`   ✓ Fetched odds`);

  // Step 3: Match markets
  console.log("\n🔗 Matching markets...");
  const matched = matchMarkets(markets, oddsData);
  const matchedCount = matched.filter(
    (m) => Object.keys(m.sportsbooks).length > 0,
  ).length;
  console.log(`   ✓ Matched ${matchedCount}/${matched.length} markets`);

  // Step 4: Get capital & positions
  console.log("\n💰 Computing capital & positions...");
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
  console.log("\n📈 Analyzing opportunities...");
  const opportunities = analyzeOpportunities(matched, capital.totalCapitalUSD);
  console.log(
    `   ✓ Found ${opportunities.makers.length} maker opportunities`,
  );

  if (opportunities.makers.length === 0) {
    console.log("   ❌ No maker opportunities found. Exiting.");
    process.exit(1);
  }

  // Step 6: Place up to MAX_MAKERS_TO_PLACE maker orders
  console.log(
    `\n💎 Placing up to ${MAX_MAKERS_TO_PLACE} maker orders...`,
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
        `   ⏭️  Skipping ${maker.marketSlug} (${maker.outcomeName}): already own ${currentShares.toFixed(2)} shares`,
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

      if (DRY_RUN) {
        console.log(
          `   [DRY RUN] Would place maker: ${maker.marketSlug} (${maker.outcomeName})`,
        );
        console.log(
          `             EV: ${(maker.ev * 100).toFixed(2)}% | Size: ${sharesToBuy.toFixed(2)} shares @ ${(maker.targetPrice * 100).toFixed(1)}%`,
        );
        
        // In dry-run, simulate order ID for tracking
        const fakeOrderId = `dry-run-${Date.now()}-${placedCount}`;
        registerMakerOrder(fakeOrderId, adjustedMaker, result.preview);
        placedCount++;
      } else {
        if (result.orderId) {
          console.log(
            `   ✅ Maker placed: ${maker.marketSlug} (${maker.outcomeName})`,
          );
          console.log(
            `      Order ID: ${result.orderId} | Size: ${sharesToBuy.toFixed(2)} shares @ ${(maker.targetPrice * 100).toFixed(1)}%`,
          );
          console.log(
            `      EV: ${(maker.ev * 100).toFixed(2)}% | Fair: ${(maker.fairProb * 100).toFixed(1)}%`,
          );

          // Register for tracking
          registerMakerOrder(result.orderId, adjustedMaker, result.preview);
          placedCount++;
        } else {
          console.log(
            `   ⚠️  Maker placement failed: ${maker.marketSlug} (${maker.outcomeName})`,
          );
        }
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

  console.log(`\n✅ Placed ${placedCount} maker orders`);
  
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

  const tracked = getTrackedMakerOrders();
  
  if (tracked.length === 0) {
    console.log("\n⚠️  No maker orders to evaluate. Exiting.");
    return;
  }

  console.log(`\n📋 Currently tracking ${tracked.length} maker orders`);

  // Step 1: Discover markets (to get fresh data)
  console.log("\n📊 Discovering Polymarket markets...");
  const markets = await discoverPolymarkets();
  await enrichMarketsWithClobQuotes(markets);
  console.log(`   ✓ Found ${markets.length} markets`);

  // Step 2: Fetch odds
  console.log("\n📡 Fetching sportsbook odds...");
  const oddsData = await fetchOddsForMarkets(markets);

  // Step 3: Match markets
  console.log("\n🔗 Matching markets...");
  const matched = matchMarkets(markets, oddsData);

  // Step 4: Get capital & positions
  console.log("\n💰 Computing capital & positions...");
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
    `   ✓ Total capital: $${capital.totalCapitalUSD.toFixed(2)}`,
  );

  const enrichedPositions = buildEnrichedPositions(markets, positions);
  const positionMap = buildPositionMap(enrichedPositions);

  // Step 5: Analyze opportunities
  console.log("\n📈 Analyzing opportunities...");
  const opportunities = analyzeOpportunities(matched, capital.totalCapitalUSD);
  console.log(
    `   ✓ Found ${opportunities.makers.length} maker opportunities`,
  );

  // Step 6: Evaluate existing maker orders
  console.log("\n🔍 Evaluating existing maker orders...");

  try {
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
      `   Decisions: ${decision.cancelOrderIds.length} to cancel, ${decision.replacementMakers.length} to replace, ${decision.cleanedUpOrderIds.length} cleaned up`,
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
        `\n   🗑️  Cancelling ${decision.cancelOrderIds.length} orders...`,
      );

      if (DRY_RUN) {
        for (const orderId of decision.cancelOrderIds) {
          console.log(`   [DRY RUN] Would cancel order: ${orderId}`);
          // In dry-run, actually remove from tracking to simulate
          removeMakerOrder(orderId);
        }
      } else {
        const client = await getClobClient();

        for (const orderId of decision.cancelOrderIds) {
          try {
            await client.cancelOrder({ orderID: orderId });
            console.log(`   ✅ Cancelled order: ${orderId}`);

            // Remove from tracking
            removeMakerOrder(orderId);

            await sleep(50);
          } catch (error: any) {
            console.error(`   ❌ Error cancelling ${orderId}:`, error.message);
          }
        }
      }
    }

    // Place replacement orders
    if (decision.replacementMakers.length > 0) {
      console.log(
        `\n   🔄 Placing ${decision.replacementMakers.length} replacement orders...`,
      );

      for (const repl of decision.replacementMakers) {
        const maker = repl.opportunity;

        // Adjust size for existing position
        const currentPosition = positionMap.get(maker.tokenId);
        const currentShares = currentPosition?.shares || 0;
        const targetShares = maker.kellySize.constrainedShares;
        const sharesToBuy = Math.max(0, targetShares - currentShares);

        // Skip if we already have enough shares
        if (sharesToBuy < maker.minOrderSize) {
          console.log(
            `   ⏭️  Skipping replacement for ${maker.marketSlug}: already own ${currentShares.toFixed(2)} shares`,
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
          const result = await placeMakerOrder(adjustedMaker, {
            dryRun: DRY_RUN,
          });

          if (DRY_RUN) {
            console.log(
              `   [DRY RUN] Would replace ${repl.oldOrderId} with new order for ${maker.marketSlug} (${sharesToBuy.toFixed(2)} shares @ ${(maker.targetPrice * 100).toFixed(1)}%)`,
            );
            
            // In dry-run, simulate new order ID
            const fakeOrderId = `dry-run-replacement-${Date.now()}`;
            registerMakerOrder(fakeOrderId, adjustedMaker, result.preview);
          } else {
            if (result.orderId) {
              console.log(
                `   ✅ Replaced ${repl.oldOrderId} with ${result.orderId}`,
              );
              console.log(
                `      ${maker.marketSlug} | ${sharesToBuy.toFixed(2)} shares @ ${(maker.targetPrice * 100).toFixed(1)}%`,
              );

              // Register new order
              registerMakerOrder(result.orderId, adjustedMaker, result.preview);
            }
          }
        } catch (error: any) {
          console.error(
            `   ❌ Error replacing order for ${maker.marketSlug}:`,
            error.message,
          );
        }

        await sleep(100);
      }
    }
  } catch (error: any) {
    console.error("   ❌ Error evaluating maker orders:", error.message);
  }

  // Show final state
  const finalTracked = getTrackedMakerOrders();
  console.log(`\n📋 After evaluation: ${finalTracked.length} maker orders tracked`);
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
  console.log("🧪 MAKER LIFECYCLE TEST");
  console.log("=".repeat(80));
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no real orders)" : "LIVE TRADING"}`);
  console.log(`Max makers to place: ${MAX_MAKERS_TO_PLACE}`);
  console.log(`Polling cycles: ${NUM_POLLING_CYCLES}`);
  console.log(`Polling interval: ${POLLING_INTERVAL_MS / 1000}s`);
  console.log("=".repeat(80));

  if (!DRY_RUN) {
    console.log("\n⚠️  WARNING: LIVE TRADING MODE ENABLED");
    console.log("⚠️  Real orders will be placed on Polymarket");
    console.log("⚠️  Press Ctrl+C within 5 seconds to abort...\n");
    await sleep(5000);
  }

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
      console.log("\n✅ All maker orders have been filled or cancelled. Test complete.");
      break;
    }

    if (i < NUM_POLLING_CYCLES) {
      console.log(
        `\n⏳ Sleeping for ${POLLING_INTERVAL_MS / 1000}s before next cycle...`,
      );
      await sleep(POLLING_INTERVAL_MS);
    }
  }

  // Final summary
  console.log("\n" + "=".repeat(80));
  console.log("TEST COMPLETE");
  console.log("=".repeat(80));

  const finalTracked = getTrackedMakerOrders();
  console.log(`\n📊 Final state: ${finalTracked.length} maker orders still tracked`);
  
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

  console.log("\n✅ Test completed successfully!");
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
