// scripts/debug-positions.ts
import "dotenv/config";
import { fetchWalletState } from "../src/arb/wallet.js";
import {
  fetchCurrentPositions,
  fetchOpenOrders,
  computeCapitalSummary,
  buildEnrichedPositions,
  buildExposureSnapshotsFromPositions,
} from "../src/arb/positions.js";
import { discoverPolymarkets } from "../src/arb/discovery.js";
import {
  MAX_PER_MARKET_FRACTION,
  MAX_PER_EVENT_FRACTION,
} from "../src/arb/config.js";
import { enrichMarketsWithClobQuotes } from "../src/arb/orderbook.js";

async function main() {
  console.log("== Polymarket Position / Exposure Debugger ==");

  // 1) Fetch live account state
  const wallet = await fetchWalletState();
  const positions = await fetchCurrentPositions();
  const openOrders = await fetchOpenOrders();

  console.log(`USDC balance: $${wallet.usdcBalance.toFixed(2)}`);
  console.log(`Raw positions from Data API: ${positions.length}`);
  console.log(`Open orders: ${openOrders.length}`);

  if (positions.length === 0) {
    console.log("\nNo active positions found. Nothing to debug.");
    return;
  }

  // 2) Discover markets so we can enrich positions with Gamma metadata
  console.log("\nDiscovering Polymarket markets for enrichment...");
  const markets = await discoverPolymarkets();
  await enrichMarketsWithClobQuotes(markets);
  console.log(`Discovered ${markets.length} markets from Gamma API`);

  const enriched = buildEnrichedPositions(markets, positions);
  console.log(`Enriched positions (matched to Gamma): ${enriched.length}`);

  // 3) Build exposure snapshots (this is what feeds the Kelly engine)
  const exposureSnapshots = buildExposureSnapshotsFromPositions(
    markets,
    positions,
  );
  const totalExposureUSD = exposureSnapshots.reduce(
    (sum, s) => sum + s.exposureUSD,
    0,
  );
  console.log(
    `Exposure snapshots: ${exposureSnapshots.length} (total exposure: $${totalExposureUSD.toFixed(
      2,
    )})`,
  );

  // 4) Capital and limits
  const capital = computeCapitalSummary(
    wallet.usdcBalance,
    positions,
    openOrders,
  );

  const perMarketCap = capital.totalCapitalUSD * MAX_PER_MARKET_FRACTION;
  const perEventCap = capital.totalCapitalUSD * MAX_PER_EVENT_FRACTION;

  console.log("\n=== CAPITAL & LIMITS ===");
  console.log(
    `Total capital: $${capital.totalCapitalUSD.toFixed(
      2,
    )} (USDC: $${capital.usdcBalance.toFixed(
      2,
    )} + Positions: $${capital.totalPositionValueUSD.toFixed(2)})`,
  );
  console.log(
    `Per-market cap (${(MAX_PER_MARKET_FRACTION * 100).toFixed(
      1,
    )}%): $${perMarketCap.toFixed(2)}`,
  );
  console.log(
    `Per-event cap (${(MAX_PER_EVENT_FRACTION * 100).toFixed(
      1,
    )}%): $${perEventCap.toFixed(2)}`,
  );

  // 5) Aggregate exposure by marketKey / eventKey using the same keys as ExposureSnapshot
  const exposureByMarket = new Map<string, number>();
  const exposureByEvent = new Map<string, number>();

  for (const snap of exposureSnapshots) {
    if (snap.marketKey) {
      exposureByMarket.set(
        snap.marketKey,
        (exposureByMarket.get(snap.marketKey) || 0) + snap.exposureUSD,
      );
    }
    if (snap.eventKey) {
      exposureByEvent.set(
        snap.eventKey,
        (exposureByEvent.get(snap.eventKey) || 0) + snap.exposureUSD,
      );
    }
  }

  // Helper to find a human-readable label for a marketKey
  function describeMarketKey(marketKey: string): string {
    const match = enriched.find((e) => {
      const keyFromMarketSlug = e.marketSlug;
      const keyFromEventAndCond =
        e.eventSlug && e.conditionId
          ? `${e.eventSlug}:${e.conditionId}`
          : undefined;
      if (keyFromMarketSlug && keyFromMarketSlug === marketKey) return true;
      if (keyFromEventAndCond && keyFromEventAndCond === marketKey) return true;
      if (
        !keyFromMarketSlug &&
        !keyFromEventAndCond &&
        e.conditionId === marketKey
      )
        return true;
      return false;
    });

    if (!match) return marketKey;

    const title = match.eventSlug || match.conditionId;
    const question = match.outcomeName
      ? `${match.outcomeName} @ ${match.currentMarketPrice.toFixed(3)}`
      : `price ${match.currentMarketPrice.toFixed(3)}`;

    return `${title} — ${question}`;
  }

  console.log("\n=== PER-MARKET EXPOSURE (USD) ===");
  if (exposureByMarket.size === 0) {
    console.log("No markets with non-zero exposure.");
  } else {
    const sortedMarkets = [...exposureByMarket.entries()].sort(
      (a, b) => b[1] - a[1],
    );
    for (const [key, exp] of sortedMarkets) {
      const usagePct = (exp / perMarketCap) * 100;
      console.log(
        `• ${describeMarketKey(key)}\n  Exposure: $${exp.toFixed(
          2,
        )} (${usagePct.toFixed(1)}% of per-market cap)\n`,
      );
    }
  }

  console.log("=== PER-EVENT EXPOSURE (USD) ===");
  if (exposureByEvent.size === 0) {
    console.log("No events with non-zero exposure.");
  } else {
    const sortedEvents = [...exposureByEvent.entries()].sort(
      (a, b) => b[1] - a[1],
    );
    for (const [key, exp] of sortedEvents) {
      const usagePct = (exp / perEventCap) * 100;
      console.log(
        `• ${key}\n  Exposure: $${exp.toFixed(
          2,
        )} (${usagePct.toFixed(1)}% of per-event cap)\n`,
      );
    }
  }

  console.log("=== RAW ENRICHED POSITIONS ===");
  for (const p of enriched) {
    console.log({
      sport: p.sport,
      marketSlug: p.marketSlug,
      eventSlug: p.eventSlug,
      conditionId: p.conditionId,
      tokenId: p.tokenId,
      outcomeName: p.outcomeName,
      shares: p.shares,
      avgEntryPrice: p.avgEntryPrice,
      currentMarketPrice: p.currentMarketPrice,
      currentValueUSD: p.currentValueUSD,
      unrealizedPnL: p.unrealizedPnL,
    });
  }
}

main().catch((err) => {
  console.error("Debug failed:", err);
  process.exit(1);
});
