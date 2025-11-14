/**
 * Debug script to analyze why markets are being skipped
 *
 * Provides granular logging for each skipped market with full context.
 *
 * Run: npm run debug-skipped
 */

import "dotenv/config";
import { discoverPolymarkets } from "../src/arb/discovery.js";
import { fetchOddsForMarkets } from "../src/arb/odds-fetcher.js";
import { matchMarkets } from "../src/arb/matcher.js";

async function main() {
  console.log("🔍 DEBUG: Analyzing skipped markets...\n");

  // Step 1: Get Polymarket markets
  console.log("📊 Discovering Polymarket markets...");
  const markets = await discoverPolymarkets();
  console.log(`   ✓ Found ${markets.length} markets\n`);

  // Step 2: Fetch odds
  console.log("📡 Fetching sportsbook odds...");
  const oddsData = await fetchOddsForMarkets(markets);

  let totalOddsEvents = 0;
  const eventsBySport: Record<string, number> = {};
  for (const [sport, events] of Object.entries(oddsData)) {
    totalOddsEvents += events.length;
    eventsBySport[sport] = events.length;
  }
  console.log(`   ✓ Fetched odds for ${totalOddsEvents} events\n`);

  console.log("   Odds events by sport:");
  for (const [sport, count] of Object.entries(eventsBySport).sort(
    ([, a], [, b]) => b - a,
  )) {
    console.log(`     • ${sport}: ${count} events`);
  }
  console.log();

  // Step 3: Match markets
  console.log("🔗 Matching markets...");
  const matched = matchMarkets(markets, oddsData);
  console.log(`   ✓ Complete\n`);

  // Step 4: Analyze skipped markets in detail
  const skippedMarkets = matched.filter(
    (m) => Object.keys(m.sportsbooks).length === 0,
  );

  // First, show what sports Polymarket has
  console.log("=".repeat(80));
  console.log("POLYMARKET SPORTS BREAKDOWN");
  console.log("=".repeat(80));

  const marketsBySport: Record<string, number> = {};
  for (const market of markets) {
    marketsBySport[market.sport] = (marketsBySport[market.sport] || 0) + 1;
  }

  console.log("\nAll Polymarket sports discovered:");
  for (const [sport, count] of Object.entries(marketsBySport).sort(
    ([, a], [, b]) => b - a,
  )) {
    const hasOdds = oddsData[sport] && oddsData[sport].length > 0;
    const status = hasOdds ? "✓ HAS ODDS" : "✗ NO ODDS";
    console.log(
      `  ${sport.padEnd(20)} ${count.toString().padStart(3)} markets  ${status}`,
    );
  }
  console.log();

  console.log("=".repeat(80));
  console.log(`SKIPPED MARKETS ANALYSIS (${skippedMarkets.length} total)`);
  console.log("=".repeat(80));
  console.log();

  // Group by skip reason
  const byReason: Record<string, typeof skippedMarkets> = {};
  for (const market of skippedMarkets) {
    const reason = market.skipReason || "Unknown";
    if (!byReason[reason]) byReason[reason] = [];
    byReason[reason]!.push(market);
  }

  // Show each reason group
  for (const [reason, markets] of Object.entries(byReason).sort(
    ([, a], [, b]) => b.length - a.length,
  )) {
    console.log(`\n${"─".repeat(80)}`);
    console.log(`REASON: ${reason} (${markets.length} markets)`);
    console.log("─".repeat(80));

    // Group by sport within this reason
    const bySport: Record<string, typeof markets> = {};
    for (const market of markets) {
      const sport = market.polymarket.sport;
      if (!bySport[sport]) bySport[sport] = [];
      bySport[sport]!.push(market);
    }

    for (const [sport, sportMarkets] of Object.entries(bySport).sort(
      ([, a], [, b]) => b.length - a.length,
    )) {
      console.log(
        `\n  ${sport.toUpperCase()} (${sportMarkets.length} markets):`,
      );

      // Show first 5 examples for this sport
      const examples = sportMarkets.slice(0, 5);
      for (const market of examples) {
        const pm = market.polymarket;
        console.log(`\n    ┌─ ${pm.eventTitle}`);
        console.log(`    │  Market: ${pm.marketQuestion}`);
        console.log(`    │  Type: ${pm.marketType}`);
        console.log(
          `    │  Teams: ${pm.homeTeam || "?"} vs ${pm.awayTeam || "?"}`,
        );

        if (pm.outcome1Name && pm.outcome2Name) {
          console.log(
            `    │  Outcomes: ${pm.outcome1Name} / ${pm.outcome2Name}`,
          );
        }

        // Check if this sport has odds data
        const hasOddsData = oddsData[sport] && oddsData[sport].length > 0;
        console.log(
          `    │  Odds data available for sport: ${hasOddsData ? "YES" : "NO"}`,
        );

        if (hasOddsData && oddsData[sport]) {
          // Show available events for this sport
          const events = oddsData[sport]!;
          console.log(`    │  Available events in ${sport}: ${events.length}`);

          // Try to find similar events
          const similarEvents = events.filter((event) => {
            const homeMatch =
              pm.homeTeam &&
              event.home_team
                .toLowerCase()
                .includes(
                  pm.homeTeam.toLowerCase().split(" ")[0]!.toLowerCase(),
                );
            const awayMatch =
              pm.awayTeam &&
              event.away_team
                .toLowerCase()
                .includes(
                  pm.awayTeam.toLowerCase().split(" ")[0]!.toLowerCase(),
                );
            return homeMatch || awayMatch;
          });

          if (similarEvents.length > 0) {
            console.log(`    │  Similar events found: ${similarEvents.length}`);
            for (const event of similarEvents.slice(0, 2)) {
              console.log(`    │    - ${event.away_team} @ ${event.home_team}`);
            }
          } else {
            console.log(`    │  No similar events found`);
            // Show first 3 available events as reference
            if (events.length > 0) {
              console.log(`    │  Sample available events:`);
              for (const event of events.slice(0, 3)) {
                console.log(
                  `    │    - ${event.away_team} @ ${event.home_team}`,
                );
              }
            }
          }
        }

        console.log(`    └─`);
      }

      if (sportMarkets.length > 5) {
        console.log(
          `\n    ... and ${sportMarkets.length - 5} more ${sport} markets`,
        );
      }
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log(`\nTotal markets: ${markets.length}`);
  console.log(`Matched: ${matched.length - skippedMarkets.length}`);
  console.log(`Skipped: ${skippedMarkets.length}`);
  console.log(
    `Match rate: ${(((matched.length - skippedMarkets.length) / markets.length) * 100).toFixed(1)}%`,
  );

  console.log("\n✅ Debug complete!\n");

  // Additional debug: Check what's actually in the odds data for FIFA WCQ Europe
  console.log("\n" + "=".repeat(80));
  console.log("RAW ODDS API DATA FOR FIFA WORLD CUP QUALIFIERS EUROPE");
  console.log("=".repeat(80));

  const wcqEuropeData = oddsData["wcq_europe"];
  if (wcqEuropeData && wcqEuropeData.length > 0) {
    console.log(`\n✓ Found ${wcqEuropeData.length} events for wcq_europe\n`);

    for (const event of wcqEuropeData.slice(0, 10)) {
      console.log(`Event ID: ${event.id}`);
      console.log(`  ${event.away_team} @ ${event.home_team}`);
      console.log(`  Commence: ${event.commence_time}`);
      console.log(`  Bookmakers: ${event.bookmakers.length}`);

      // Show available markets
      const markets = new Set<string>();
      for (const bookmaker of event.bookmakers) {
        for (const market of bookmaker.markets) {
          markets.add(market.key);
        }
      }
      console.log(`  Markets: ${Array.from(markets).join(", ")}`);
      console.log();
    }

    if (wcqEuropeData.length > 10) {
      console.log(`... and ${wcqEuropeData.length - 10} more events\n`);
    }
  } else {
    console.log("\n✗ NO DATA found for wcq_europe");
    console.log("\nAvailable sports in oddsData:");
    for (const [sport, events] of Object.entries(oddsData)) {
      console.log(`  • ${sport}: ${events.length} events`);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log();
}

main().catch((error) => {
  console.error("❌ Debug failed:", error);
  process.exit(1);
});
