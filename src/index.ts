/**
 * Main Trading Loop (Phase 5)
 *
 * Implements the complete arbitrage trading cycle:
 * 1. Discover markets
 * 2. Fetch odds
 * 3. Match markets
 * 4. Analyze opportunities
 * 5. Execute taker orders (immediate)
 * 6. Place new maker orders
 * 7. Evaluate existing maker orders
 * 8. Update positions
 * 9. Fixed sleep interval (15 seconds)
 *
 * Adheres strictly to maker-taker-rules.md
 */

import "dotenv/config";
import { discoverPolymarkets } from "./arb/discovery.js";
import { fetchOddsForMarkets } from "./arb/odds-fetcher.js";
import { matchMarkets } from "./arb/matcher.js";
import { analyzeOpportunities } from "./arb/analyzer.js";
import { fetchWalletState } from "./arb/wallet.js";
import {
  fetchCurrentPositions,
  fetchOpenOrders,
  computeCapitalSummary,
  buildExposureSnapshotsFromPositions,
  EnrichedPosition,
} from "./arb/positions.js";
import { setExposureFromSnapshot } from "./arb/calculator.js";
import { executeTakerOrder, placeMakerOrder } from "./arb/execution.js";
import {
  registerMakerOrder,
  getTrackedMakerOrders,
  removeMakerOrder,
} from "./arb/maker-registry.js";
import { evaluateMakerOrders } from "./arb/maker-management.js";
import { getClobClient } from "./arb/clob.js";
import { TakerOpportunity, MakerOpportunity } from "./arb/types.js";
import {
  fetchBestPricesForTokens,
  enrichMarketsWithClobQuotes,
} from "./arb/orderbook.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

import { POLLING_INTERVAL_MS } from "./arb/config.js";

const DRY_RUN = process.env.DRY_RUN !== "false"; // Default to dry-run for safety

// ============================================================================
// POLLING LOGIC
// ============================================================================

/**
 * Get the fixed polling interval from config.
 * Currently set to 15 seconds for all markets.
 */
function getPollingInterval(): number {
  return POLLING_INTERVAL_MS;
}

// ============================================================================
// POSITION TRACKING
// ============================================================================

/**
 * Build a map of current positions by tokenId for quick lookup.
 * Used to adjust Kelly sizing based on existing exposure.
 */
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
// TAKER EXECUTION
// ============================================================================

/**
 * Execute taker opportunities that meet EV thresholds.
 *
 * Per maker-taker-rules.md:
 * - Only execute if Kelly-constrained size (minus current shares) > 0
 * - Use FOK limit orders at polymarketAsk
 * - Adjust size for existing positions
 */
async function executeTakers(
  takers: TakerOpportunity[],
  positionMap: Map<string, EnrichedPosition>,
  dryRun: boolean,
): Promise<void> {
  if (takers.length === 0) {
    console.log("   No taker opportunities to execute.");
    return;
  }

  console.log(`\n🎯 Executing ${takers.length} taker opportunities...`);

  for (const taker of takers) {
    const currentPosition = positionMap.get(taker.tokenId);
    const currentShares = currentPosition?.shares || 0;

    // Adjust size for existing position (per maker-taker-rules.md)
    const targetShares = taker.kellySize.constrainedShares;
    const sharesToBuy = Math.max(0, targetShares - currentShares);

    // Skip if we already have enough shares
    if (sharesToBuy < taker.minOrderSize) {
      console.log(
        `   ⏭️  Skipping ${taker.marketSlug} (${taker.outcomeName}): already own ${currentShares.toFixed(2)} shares (target: ${targetShares.toFixed(2)})`,
      );
      continue;
    }

    // Create adjusted opportunity with correct size
    const adjustedTaker: TakerOpportunity = {
      ...taker,
      kellySize: {
        ...taker.kellySize,
        constrainedShares: sharesToBuy,
        constrainedSizeUSD: sharesToBuy * taker.polymarketAsk,
      },
    };

    try {
      const result = await executeTakerOrder(adjustedTaker, { dryRun });

      if (dryRun) {
        console.log(
          `   [DRY RUN] Would execute taker: ${taker.marketSlug} (${taker.outcomeName})`,
        );
        console.log(
          `             EV: ${(taker.ev * 100).toFixed(2)}% | Size: ${sharesToBuy.toFixed(2)} shares @ ${(taker.polymarketAsk * 100).toFixed(1)}%`,
        );
      } else {
        if (result.filled) {
          console.log(
            `   ✅ Taker filled: ${taker.marketSlug} (${taker.outcomeName})`,
          );
          console.log(
            `      Order ID: ${result.orderId} | Size: ${sharesToBuy.toFixed(2)} shares`,
          );
        } else {
          console.log(
            `   ⚠️  Taker not filled: ${taker.marketSlug} (${taker.outcomeName})`,
          );
        }
      }
    } catch (error: any) {
      console.error(
        `   ❌ Error executing taker for ${taker.marketSlug}:`,
        error.message,
      );
    }

    // Small delay between orders to avoid rate limiting
    await sleep(100);
  }
}

// ============================================================================
// MAKER PLACEMENT
// ============================================================================

/**
 * Place new maker orders for opportunities that meet EV thresholds.
 *
 * Per maker-taker-rules.md:
 * - Place GTC limit bids at targetPrice
 * - Register order metadata for tracking
 * - Adjust size for existing positions
 */
async function placeNewMakers(
  makers: MakerOpportunity[],
  positionMap: Map<string, EnrichedPosition>,
  dryRun: boolean,
): Promise<void> {
  if (makers.length === 0) {
    console.log("   No maker opportunities to place.");
    return;
  }

  console.log(`\n💎 Placing ${makers.length} maker orders...`);

  for (const maker of makers) {
    const currentPosition = positionMap.get(maker.tokenId);
    const currentShares = currentPosition?.shares || 0;

    // Adjust size for existing position
    const targetShares = maker.kellySize.constrainedShares;
    const sharesToBuy = Math.max(0, targetShares - currentShares);

    // Skip if we already have enough shares
    if (sharesToBuy < maker.minOrderSize) {
      console.log(
        `   ⏭️  Skipping ${maker.marketSlug} (${maker.outcomeName}): already own ${currentShares.toFixed(2)} shares (target: ${targetShares.toFixed(2)})`,
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
      const result = await placeMakerOrder(adjustedMaker, { dryRun });

      if (dryRun) {
        console.log(
          `   [DRY RUN] Would place maker: ${maker.marketSlug} (${maker.outcomeName})`,
        );
        console.log(
          `             EV: ${(maker.ev * 100).toFixed(2)}% | Size: ${sharesToBuy.toFixed(2)} shares @ ${(maker.targetPrice * 100).toFixed(1)}%`,
        );
      } else {
        if (result.orderId) {
          console.log(
            `   ✅ Maker placed: ${maker.marketSlug} (${maker.outcomeName})`,
          );
          console.log(
            `      Order ID: ${result.orderId} | Size: ${sharesToBuy.toFixed(2)} shares @ ${(maker.targetPrice * 100).toFixed(1)}%`,
          );

          // Register for tracking (per maker-taker-rules.md)
          registerMakerOrder(result.orderId, adjustedMaker, result.preview);
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
}

// ============================================================================
// MAKER EVALUATION & MANAGEMENT
// ============================================================================

/**
 * Evaluate existing maker orders and cancel/replace as needed.
 *
 * Per maker-taker-rules.md:
 * - Cancel if currentEV < minEV
 * - Cancel if EV dropped > 2% vs placement
 * - Cancel if outbid by >= 1 tick (and repost if EV still good)
 * - Cancel if out-of-model (tokenId not in current opportunities)
 */
async function evaluateExistingMakers(
  currentMakers: MakerOpportunity[],
  positionMap: Map<string, EnrichedPosition>,
  dryRun: boolean,
): Promise<void> {
  const trackedOrders = getTrackedMakerOrders();

  if (trackedOrders.length === 0) {
    console.log("   No maker orders to evaluate.");
    return;
  }

  console.log(
    `\n🔍 Evaluating ${trackedOrders.length} existing maker orders...`,
  );

  try {
    // Fetch current open orders from CLOB
    const openOrders = await fetchOpenOrders();

    // Fetch live best bid/ask for all tracked maker tokenIds
    const tokenIds = trackedOrders.map((t) => t.tokenId);
    const liveBestPrices = await fetchBestPricesForTokens(tokenIds);

    // Enforce "fully satisfied" rule:
    // if current shares for a token already meet/exceed the Kelly target
    // for this cycle, treat remaining maker size as unnecessary and
    // drop that MakerOpportunity from evaluation so it will be cancelled
    // as "out-of-model" by evaluateMakerOrders.
    const makersForEvaluation = currentMakers.filter((maker) => {
      const currentPosition = positionMap.get(maker.tokenId);
      const currentShares = currentPosition?.shares || 0;
      const targetShares = maker.kellySize.constrainedShares;
      // small epsilon to avoid float noise
      return currentShares < targetShares - 1e-6;
    });

    // Run evaluation logic (with live CLOB best bids for outbid detection)
    const decision = evaluateMakerOrders(
      makersForEvaluation,
      openOrders as any,
      liveBestPrices,
    );

    // Log summary
    console.log(
      `   Decisions: ${decision.cancelOrderIds.length} to cancel, ${decision.replacementMakers.length} to replace, ${decision.cleanedUpOrderIds.length} cleaned up`,
    );

    // Cancel orders
    if (decision.cancelOrderIds.length > 0) {
      console.log(
        `\n   Cancelling ${decision.cancelOrderIds.length} orders...`,
      );

      if (dryRun) {
        for (const orderId of decision.cancelOrderIds) {
          console.log(`   [DRY RUN] Would cancel order: ${orderId}`);
        }
      } else {
        const client = await getClobClient();

        for (const orderId of decision.cancelOrderIds) {
          try {
            await client.cancelOrder({ orderID: orderId });
            console.log(`   ✅ Cancelled order: ${orderId}`);

            // Remove from tracking
            removeMakerOrder(orderId);

            // Small delay to avoid rate limiting
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
        `\n   Placing ${decision.replacementMakers.length} replacement orders...`,
      );

      for (const repl of decision.replacementMakers) {
        const maker = repl.opportunity;

        // Adjust size for existing position (per maker-taker-rules.md)
        const currentPosition = positionMap.get(maker.tokenId);
        const currentShares = currentPosition?.shares || 0;
        const targetShares = maker.kellySize.constrainedShares;
        const sharesToBuy = Math.max(0, targetShares - currentShares);

        // Skip if we already have enough shares
        if (sharesToBuy < maker.minOrderSize) {
          console.log(
            `   ⏭️  Skipping replacement for ${maker.marketSlug} (${maker.outcomeName}): already own ${currentShares.toFixed(2)} shares (target: ${targetShares.toFixed(2)})`,
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
          const result = await placeMakerOrder(adjustedMaker, { dryRun });

          if (dryRun) {
            console.log(
              `   [DRY RUN] Would replace ${repl.oldOrderId} with new order for ${maker.marketSlug} (${sharesToBuy.toFixed(2)} shares)`,
            );
          } else {
            if (result.orderId) {
              console.log(
                `   ✅ Replaced ${repl.oldOrderId} with ${result.orderId} (${sharesToBuy.toFixed(2)} shares)`,
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

        // Small delay between orders
        await sleep(100);
      }
    }

    // Log detailed reasoning if verbose
    if (process.env.VERBOSE === "true" && decision.details.length > 0) {
      console.log("\n   Detailed evaluation:");
      for (const detail of decision.details) {
        console.log(
          `   - Order ${detail.orderId.substring(0, 8)}... (${detail.marketSlug}):`,
        );
        console.log(`     Action: ${detail.action}`);
        for (const reason of detail.reasons) {
          console.log(`     • ${reason}`);
        }
      }
    }
  } catch (error: any) {
    console.error("   ❌ Error evaluating maker orders:", error.message);
  }
}

// ============================================================================
// MARKET STATE HANDLER
// ============================================================================

/**
 * Cancel all orders for markets that have started or closed.
 *
 * Per tentative-gameplan.md:
 * - Pre-game (active=true, closed=false): normal trading
 * - Live (game started): cancel all orders for this market
 * - Closed (closed=true): stop trading
 */
async function handleMarketStates(
  markets: any[],
  dryRun: boolean,
): Promise<void> {
  const now = Date.now();
  const trackedOrders = getTrackedMakerOrders();

  if (trackedOrders.length === 0) {
    return;
  }

  const ordersToCancel: string[] = [];

  // Build map of market slugs to start times
  const marketStartTimes = new Map<string, number>();
  for (const market of markets) {
    if (market.marketSlug && market.startTime) {
      const startTime = new Date(market.startTime).getTime();
      marketStartTimes.set(market.marketSlug, startTime);
    }
  }

  // Check each tracked order
  for (const order of trackedOrders) {
    const startTime = marketStartTimes.get(order.marketSlug);

    if (startTime && now >= startTime) {
      // Game has started - cancel this order
      ordersToCancel.push(order.orderId);
    }
  }

  if (ordersToCancel.length > 0) {
    console.log(
      `\n⚠️  Cancelling ${ordersToCancel.length} orders for live/closed markets...`,
    );

    if (dryRun) {
      for (const orderId of ordersToCancel) {
        console.log(`   [DRY RUN] Would cancel order: ${orderId}`);
      }
    } else {
      const client = await getClobClient();

      for (const orderId of ordersToCancel) {
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
}

// ============================================================================
// MAIN LOOP
// ============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCycle(cycleNumber: number): Promise<number> {
  console.log("\n" + "=".repeat(80));
  console.log(`CYCLE ${cycleNumber} - ${new Date().toISOString()}`);
  console.log("=".repeat(80));

  const cycleStart = Date.now();

  try {
    // Step 1: Discover markets
    console.log("\n📊 Step 1: Discovering Polymarket markets...");
    const startDiscovery = Date.now();
    const markets = await discoverPolymarkets();
    // Enrich markets with live CLOB prices so all downstream logic uses fresh Polymarket quotes
    await enrichMarketsWithClobQuotes(markets);
    const discoveryTime = ((Date.now() - startDiscovery) / 1000).toFixed(1);
    console.log(`   ✓ Found ${markets.length} markets in ${discoveryTime}s`);

    if (markets.length === 0) {
      console.log("   No markets found. Sleeping...");
      return POLLING_INTERVAL_MS;
    }

    // Step 2: Fetch odds
    console.log("\n📡 Step 2: Fetching sportsbook odds...");
    const startOdds = Date.now();
    const oddsData = await fetchOddsForMarkets(markets);
    const oddsTime = ((Date.now() - startOdds) / 1000).toFixed(1);
    console.log(`   ✓ Fetched odds in ${oddsTime}s`);

    // Step 3: Match markets
    console.log("\n🔗 Step 3: Matching markets...");
    const startMatch = Date.now();
    const matched = matchMarkets(markets, oddsData);
    const matchTime = ((Date.now() - startMatch) / 1000).toFixed(1);
    const matchedCount = matched.filter(
      (m) => Object.keys(m.sportsbooks).length > 0,
    ).length;
    console.log(
      `   ✓ Matched ${matchedCount}/${matched.length} markets in ${matchTime}s`,
    );

    // Step 4: Get capital & positions
    console.log("\n💰 Step 4: Computing capital & positions...");
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
    console.log(`   ✓ Open orders: ${capital.openOrderCount}`);
    console.log(`   ✓ Positions: ${positions.length}`);

    // Build position map for quick lookup
    const enrichedPositions = await import("./arb/positions.js").then((m) =>
      m.buildEnrichedPositions(markets, positions),
    );
    const positionMap = buildPositionMap(enrichedPositions);

    // Step 5: Analyze opportunities
    console.log("\n📈 Step 5: Analyzing opportunities...");
    const startAnalyze = Date.now();
    const opportunities = analyzeOpportunities(
      matched,
      capital.totalCapitalUSD,
    );
    const analyzeTime = ((Date.now() - startAnalyze) / 1000).toFixed(1);
    console.log(
      `   ✓ Found ${opportunities.takers.length} takers, ${opportunities.makers.length} makers in ${analyzeTime}s`,
    );

    // Step 6: Execute takers (immediate)
    console.log("\n🎯 Step 6: Executing taker orders...");
    await executeTakers(opportunities.takers, positionMap, DRY_RUN);

    // Step 7: Place new maker orders
    console.log("\n💎 Step 7: Placing new maker orders...");
    await placeNewMakers(opportunities.makers, positionMap, DRY_RUN);

    // Step 8: Evaluate existing maker orders
    console.log("\n🔍 Step 8: Evaluating existing maker orders...");
    await evaluateExistingMakers(opportunities.makers, positionMap, DRY_RUN);

    // Step 9: Handle market states (cancel orders for live/closed markets)
    console.log("\n⚠️  Step 9: Checking market states...");
    await handleMarketStates(markets, DRY_RUN);

    // Step 10: Get polling interval
    const sleepDuration = getPollingInterval();
    const sleepSeconds = (sleepDuration / 1000).toFixed(0);

    const cycleTime = ((Date.now() - cycleStart) / 1000).toFixed(1);
    console.log("\n" + "=".repeat(80));
    console.log(`CYCLE ${cycleNumber} COMPLETE in ${cycleTime}s`);
    console.log(`Next cycle in ${sleepSeconds}s`);
    console.log("=".repeat(80));

    return sleepDuration;
  } catch (error: any) {
    console.error("\n❌ Error in cycle:", error);
    console.error(error.stack);

    // On error, sleep for standard duration before retrying
    return POLLING_INTERVAL_MS;
  }
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🚀 POLYMARKET ARBITRAGE BOT - PHASE 5");
  console.log("=".repeat(80));
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no real orders)" : "LIVE TRADING"}`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log("=".repeat(80));

  if (!DRY_RUN) {
    console.log("\n⚠️  WARNING: LIVE TRADING MODE ENABLED");
    console.log("⚠️  Real orders will be placed on Polymarket");
    console.log("⚠️  Press Ctrl+C within 5 seconds to abort...\n");
    await sleep(5000);
  }

  let cycleNumber = 1;

  while (true) {
    const sleepDuration = await runCycle(cycleNumber);
    cycleNumber++;

    // Sleep before next cycle
    await sleep(sleepDuration);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n🛑 Received SIGINT, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n\n🛑 Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});

// Start the bot
main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
