// scripts/test-clob.ts
import "dotenv/config";
import { getClobClient } from "../src/arb/clob.js";
import { fetchWalletState } from "../src/arb/wallet.js";
import {
  fetchOpenOrders,
  fetchCurrentPositions,
  computeCapitalSummary,
} from "../src/arb/positions.js";

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
  // 5) Calculate capital summary
  const capital = computeCapitalSummary(
    wallet.usdcBalance,
    positions,
    openOrders,
  );

  console.log("\n=== CAPITAL SUMMARY ===");
  console.log(`USDC Balance: $${capital.usdcBalance.toFixed(2)}`);
  console.log(`Position Value: $${capital.totalPositionValueUSD.toFixed(2)}`);
  console.log(`─────────────────────────────`);
  console.log(`TOTAL CAPITAL: $${capital.totalCapitalUSD.toFixed(2)}`);
  console.log(`Open Orders: ${capital.openOrderCount} (don't lock capital)`);
  console.log(
    `\nℹ️  Your $${capital.totalCapitalUSD.toFixed(2)} is fully available for Kelly sizing`,
  );
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
