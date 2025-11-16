/**
 * Print EV for all matched markets.
 *
 * Run:
 *   npx tsx scripts/print-evs.ts
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
} from "../src/arb/positions.js";
import { enrichMarketsWithClobQuotes } from "../src/arb/orderbook.js";

async function main() {
  console.log("📊 Computing EVs for all matched markets...\n");

  // Step 1: Discover Polymarket markets
  const markets = await discoverPolymarkets();
  await enrichMarketsWithClobQuotes(markets);

  // Step 2: Fetch sportsbook odds
  const oddsData = await fetchOddsForMarkets(markets);

  // Step 3: Match markets
  const allMatches = matchMarkets(markets, oddsData);
  const matchedMarkets = allMatches.filter(
    (m) => Object.keys(m.sportsbooks).length > 0,
  );

  console.log(`Total markets:   ${allMatches.length}`);
  console.log(`Matched markets: ${matchedMarkets.length}\n`);

  // Step 4: Get capital for Kelly sizing
  const wallet = await fetchWalletState();
  const positions = await fetchCurrentPositions();
  const openOrders = await fetchOpenOrders();
  const capital = computeCapitalSummary(
    wallet.usdcBalance,
    positions,
    openOrders,
  );
  console.log(
    `Total capital: $${capital.totalCapitalUSD.toFixed(2)} (for Kelly sizing)\n`,
  );

  // Step 5: Analyze to compute EVs; this mutates the matched objects
  const opportunities = analyzeOpportunities(
    matchedMarkets,
    capital.totalCapitalUSD,
  );
  const marketsWithEV = opportunities.matched;

  // Step 5: Sort by best maker EV (descending) so the strongest edges appear first
  marketsWithEV.sort((a, b) => {
    const aEv = a.makerEV?.bestMakerEV ?? -Infinity;
    const bEv = b.makerEV?.bestMakerEV ?? -Infinity;
    return bEv - aEv;
  });

  // Step 6: Print EVs for every matched market
  for (const match of marketsWithEV) {
    const pm = match.polymarket;
    const taker = match.ev;
    const maker = match.makerEV;

    const label = `${pm.sport.toUpperCase()} | ${pm.eventTitle} | ${pm.marketQuestion}`;

    const takerBestEV = taker?.bestEV ?? null;
    const makerBestEV = maker?.bestMakerEV ?? null;

    console.log(
      "----------------------------------------------------------------",
    );
    console.log(label);
    console.log(
      `  Taker best EV: ${
        takerBestEV !== null ? `${(takerBestEV * 100).toFixed(2)}%` : "n/a"
      }`,
    );
    console.log(
      `  Maker best EV: ${
        makerBestEV !== null ? `${(makerBestEV * 100).toFixed(2)}%` : "n/a"
      }`,
    );

    if (maker?.bestMakerSide) {
      console.log(`  Maker side:    ${maker.bestMakerSide}`);
    }
  }

  console.log("\n✅ EV dump complete.\n");
}

main().catch((error) => {
  console.error("❌ EV dump failed:", error);
  process.exit(1);
});
