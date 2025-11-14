// scripts/test-clob.ts
import "dotenv/config";
import { getClobClient } from "../src/arb/clob.js";
import { fetchWalletState } from "../src/arb/wallet.js";
import {
  fetchOpenOrders,
  fetchCurrentPositions,
  buildEnrichedPositions,
  computeCapitalUsage,
} from "../src/arb/positions.js";
import { discoverPolymarkets } from "../src/arb/discovery.js";

async function main() {
  console.log("== Polymarket CLOB sanity check ==");

  const client = await getClobClient();

  // 1) Basic CLOB health
  const ok = await client.getOk();
  const serverTime = await client.getServerTime();
  console.log("CLOB OK response:", ok);
  console.log("CLOB server time (ms since epoch):", serverTime);

  // 2) Wallet / bankroll
  const wallet = await fetchWalletState();
  console.log("Wallet state (USDC):", wallet);

  // 3) Open orders (first page only)
  const openOrders = await fetchOpenOrders();
  console.log(`Open orders count: ${openOrders.length}`);
  if (openOrders.length > 0) {
    console.log("Sample open order:", openOrders[0]);
  }

  // 4) Current positions (Data API)
  const positions = await fetchCurrentPositions();
  console.log(`Positions count: ${positions.length}`);
  if (positions.length > 0) {
    console.log("Sample position:", positions[0]);
  }

  // 5) Enrich positions with Gamma metadata and compute capital usage
  const markets = await discoverPolymarkets();
  const enrichedPositions = buildEnrichedPositions(markets, positions);
  console.log(`Enriched positions count: ${enrichedPositions.length}`);
  if (enrichedPositions.length > 0) {
    console.log("Sample enriched position:", enrichedPositions[0]);
  }

  const capital = computeCapitalUsage(
    wallet.usdcBalance,
    enrichedPositions,
    openOrders,
  );
  console.log("Capital usage summary:", capital);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
