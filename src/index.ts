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
  buildExposureSnapshotsFromMakerOrders,
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
import { saveWager, updateWagerCLV } from "./storage/operations.js";
import { trackMakerFills } from "./storage/tracking.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

import { POLLING_INTERVAL_MS, CLV_UPDATE_WINDOW_MS } from "./arb/config.js";

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
      const result = await executeTakerOrder(
        adjustedTaker,
        adjustedTaker.eventStartTime || new Date().toISOString(),
        { dryRun },
      );

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

          // Save to DB (Phase 5 addition)
          await saveWager({
            order_id: result.orderId!,
            market_slug: taker.marketSlug,
            event_slug: taker.eventSlug,
            sport: taker.sport,
            market_type: taker.marketType,
            outcome: taker.outcome,
            side: "BUY",
            order_type: "TAKER",
            price: taker.polymarketAsk,
            size_filled: sharesToBuy,
            ev_at_placement: taker.ev,
            fair_prob_at_placement: taker.fairProb,
            bookmakers: taker.bookmakers,
            event_start_time:
              taker.eventStartTime && typeof taker.eventStartTime === "string"
                ? new Date(taker.eventStartTime)
                : undefined,
          });
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
      bookmakers: maker.bookmakers,
      kellySize: {
        ...maker.kellySize,
        constrainedShares: sharesToBuy,
        constrainedSizeUSD: sharesToBuy * maker.targetPrice,
      },
    };

    // Sanity check to avoid re-placing if we are already tracking an order for this outcome
    // The loop above might not have caught it if the positions map wasn't perfectly in sync
    // or if there are pending orders not yet in 'positions'.
    // We check our local registry for an active order for this tokenId.
    const existingTracked = (await getTrackedMakerOrders()).find(
      (o) => o.tokenId === maker.tokenId,
    );
    if (existingTracked) {
      console.log(
        `   ⏭️  Skipping ${maker.marketSlug}: active maker order ${existingTracked.orderId.substring(0, 8)} already exists.`,
      );
      continue;
    }

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
          await registerMakerOrder(
            result.orderId,
            adjustedMaker,
            result.preview,
            adjustedMaker.eventStartTime,
          );
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
 * Evaluate existing maker orders and cancel as needed.
 *
 * Per maker-taker-rules.md:
 * - Cancel if currentEV < minEV
 * - Cancel if EV dropped > 2% vs placement
 * - Cancel if outbid by >= 1 tick
 * - Cancel if out-of-model (tokenId not in current opportunities)
 * - Cancel remaining size once filledShares >= current-cycle Kelly target
 *
 * Any new maker orders (including "replacements") are handled by the
 * placement phase using fresh MakerOpportunity[] from the analyzer.
 */
async function evaluateExistingMakers(
  currentMakers: MakerOpportunity[],
  positionMap: Map<string, EnrichedPosition>,
  dryRun: boolean,
): Promise<void> {
  try {
    // Build a lookup from tokenId -> MakerOpportunity so we can match
    // open CLOB orders to current maker opportunities.
    const makersByToken = new Map<string, MakerOpportunity>();
    for (const m of currentMakers) {
      makersByToken.set(m.tokenId, m);
    }

    // Fetch current open orders from CLOB
    const openOrders = await fetchOpenOrders();

    // Seed / refresh the maker registry from ALL open maker orders that match
    // current MakerOpportunity tokenIds. This ensures that the bot always
    // evaluates and manages every relevant open maker order each cycle,
    // including those that may have been placed before this process started.
    for (const o of openOrders) {
      const opp = makersByToken.get(o.asset_id);
      if (!opp) continue;

      const price = parseFloat(o.price ?? "0");
      const size = parseFloat(o.original_size ?? "0");

      await registerMakerOrder(
        o.id,
        opp,
        {
          tokenID: opp.tokenId,
          // This registry is only used for evaluation metadata; we don't rely
          // on these enum values at runtime, so a string literal is sufficient.
          side: "BUY" as any,
          price,
          size,
          orderType: "GTC" as any,
        },
        opp.eventStartTime,
      );
    }

    const trackedOrders = await getTrackedMakerOrders();

    if (trackedOrders.length === 0) {
      console.log("   No maker orders to evaluate.");
      return;
    }

    console.log(
      `\n🔍 Evaluating ${trackedOrders.length} existing maker orders...`,
    );

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
    const decision = await evaluateMakerOrders(
      makersForEvaluation,
      openOrders as any,
      liveBestPrices,
    );

    // Log summary
    console.log(
      `   Decisions: ${decision.cancelOrderIds.length} to cancel, ${decision.cleanedUpOrderIds.length} cleaned up`,
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
            await removeMakerOrder(orderId);

            // Small delay to avoid rate limiting
            await sleep(50);
          } catch (error: any) {
            console.error(`   ❌ Error cancelling ${orderId}:`, error.message);
          }
        }
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
  const trackedOrders = await getTrackedMakerOrders();

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

  // Check each tracked order for cancellation
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
          await removeMakerOrder(orderId);

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

    // Seed exposure with current positions
    const positionExposureSnapshots = buildExposureSnapshotsFromPositions(
      markets,
      positions,
    );

    // Add exposure from ALL currently tracked maker orders (open makers).
    // This ensures maker notional counts toward per-market and per-event caps.
    const trackedMakers = await getTrackedMakerOrders();
    const makerExposureSnapshots =
      buildExposureSnapshotsFromMakerOrders(trackedMakers);

    setExposureFromSnapshot([
      ...positionExposureSnapshots,
      ...makerExposureSnapshots,
    ]);

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

    // UPDATE CLV FOR PRE-GAME MARKETS (T-15m)
    // Iterate through matched markets and update CLV if within 15 mins of start
    for (const match of opportunities.matched) {
      if (
        match.polymarket.marketSlug &&
        match.fairProbOutcome1 !== undefined &&
        match.polymarket.startTime
      ) {
        const startTime = new Date(match.polymarket.startTime).getTime();
        const timeToStart = startTime - Date.now();
        const isClosingWindow =
          timeToStart <= CLV_UPDATE_WINDOW_MS && timeToStart > 0;

        if (isClosingWindow) {
          await updateWagerCLV(
            match.polymarket.marketSlug,
            match.fairProbOutcome1,
            match.fairProbOutcome2,
          );
        }
      }
    }

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

    // Step 8: Track maker fills (DB sync) - Run BEFORE evaluation to catch fills on orders that might be cancelled
    // Only run in live mode or if we want to test DB logic (but no fills in dry run)
    if (!DRY_RUN) {
      console.log("\n💾 Step 8: Tracking maker fills...");
      await trackMakerFills();
    }

    // Step 9: Evaluate existing maker orders
    console.log("\n🔍 Step 9: Evaluating existing maker orders...");
    await evaluateExistingMakers(opportunities.makers, positionMap, DRY_RUN);

    // Step 10: Handle market states (cancel orders for live/closed markets)
    console.log("\n⚠️  Step 10: Checking market states...");
    await handleMarketStates(markets, DRY_RUN);

    // Step 11: Get polling interval
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
  console.log("🚀 POLYMARKET +EV BOT BOOTING UP... 🤖");
  console.log("=".repeat(80));
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no real orders)" : "LIVE TRADING"}`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log("=".repeat(80));

  if (!DRY_RUN) {
    console.log("\n⚠️  WARNING: LIVE TRADING MODE ENABLED");
    console.log("⚠️  Real orders will be placed on Polymarket");
    console.log("⚠️  Press Ctrl+C within 5 seconds to abort...\n");
    await sleep(5000);

    // STARTUP CLEANUP (FIRST RUN ONLY)
    // Cancel all open maker orders to start from a clean slate
    console.log("\n🧹 STARTUP: Cancelling all open maker orders...");
    try {
      const client = await getClobClient();
      await client.cancelAll();
      console.log("   ✅ All open orders cancelled.");

      // Also clear the DB registry to match
      // We don't have a "deleteAll" in maker-registry, but we can fetch all and remove one by one
      // or just truncate the table via SQL if we had a helper.
      // For now, let's just rely on 'cancelAll' clearing the book.
      // The registry sync loop in 'evaluateExistingMakers' will re-populate any if they somehow survived,
      // but since we cancelled them on the CLOB, the registry should naturally clear out or be corrected
      // when 'evaluateMakerOrders' sees they are gone.

      // Actually, to be safe and ensure our DB state matches the "clean slate",
      // let's explicitly clear the tracked orders in the DB if possible.
      // Since 'cancelAll' is async and might take a moment to propagate,
      // explicit DB cleanup is good practice here.
      const tracked = await getTrackedMakerOrders();
      for (const t of tracked) {
        await removeMakerOrder(t.orderId);
      }
      console.log(`   ✅ Removed ${tracked.length} orders from tracking DB.`);
    } catch (error: any) {
      console.error("   ❌ Error during startup cleanup:", error.message);
    }
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
