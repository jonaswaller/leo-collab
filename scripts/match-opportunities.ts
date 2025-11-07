import dotenv from "dotenv";
import { getPolymarketSportsMarkets, PolymarketEvent } from "./show-pm-markets.js";
import { getOddsForMatchup, OddsApiEvent } from "./show-odds-api.js";

dotenv.config();

const TIME_WINDOW_HOURS = 24;
const MIN_LIQUIDITY = 1000;

/**
 * Parse team names from Polymarket event title
 * Examples:
 *   "Thunder vs. Kings" -> { away: "Thunder", home: "Kings" }
 *   "Celtics vs. Magic" -> { away: "Celtics", home: "Magic" }
 */
function parseTeamNames(title: string): { away: string; home: string } | null {
  // Pattern: "Team1 vs. Team2" or "Team1 vs Team2"
  const vsMatch = title.match(/^(.+?)\s+vs\.?\s+(.+?)$/i);
  if (vsMatch && vsMatch[1] && vsMatch[2]) {
    return {
      away: vsMatch[1].trim(),
      home: vsMatch[2].trim(),
    };
  }

  // Pattern: "Team1 @ Team2"
  const atMatch = title.match(/^(.+?)\s+@\s+(.+?)$/i);
  if (atMatch && atMatch[1] && atMatch[2]) {
    return {
      away: atMatch[1].trim(),
      home: atMatch[2].trim(),
    };
  }

  return null;
}

/**
 * Map Polymarket sport tag/category to Odds API sport key
 */
function mapToOddsSport(pmEvent: PolymarketEvent): string | null {
  // Check tags
  const tagLabels = pmEvent.tags.map(t => t.label.toLowerCase());
  
  // NBA
  if (tagLabels.includes("nba")) {
    return "basketball_nba";
  }
  
  // NFL
  if (tagLabels.includes("nfl")) {
    return "americanfootball_nfl";
  }
  
  // NHL
  if (tagLabels.includes("nhl")) {
    return "icehockey_nhl";
  }
  
  // MLB
  if (tagLabels.includes("mlb")) {
    return "baseball_mlb";
  }
  
  // College Basketball
  if (tagLabels.includes("ncaab") || tagLabels.includes("cbb") || tagLabels.includes("college basketball")) {
    return "basketball_ncaab";
  }
  
  // College Football
  if (tagLabels.includes("ncaaf") || tagLabels.includes("cfb") || tagLabels.includes("college football")) {
    return "americanfootball_ncaaf";
  }
  
  // Soccer/Football leagues
  if (tagLabels.includes("epl") || tagLabels.includes("premier league")) {
    return "soccer_epl";
  }
  
  if (tagLabels.includes("champions league") || tagLabels.includes("ucl")) {
    return "soccer_uefa_champs_league";
  }
  
  // Check category as fallback
  const category = pmEvent.category?.toLowerCase() || "";
  if (category.includes("nba")) return "basketball_nba";
  if (category.includes("nfl")) return "americanfootball_nfl";
  if (category.includes("nhl")) return "icehockey_nhl";
  if (category.includes("mlb")) return "baseball_mlb";
  
  return null;
}

/**
 * Display matched market comparison
 */
function displayComparison(
  pmEvent: PolymarketEvent,
  sbOdds: OddsApiEvent | null
) {
  console.log("\n" + "=".repeat(80));
  console.log(`EVENT: ${pmEvent.title}`);
  console.log("=".repeat(80));
  console.log(`PM Event ID:    ${pmEvent.id}`);
  console.log(`PM Slug:        ${pmEvent.slug}`);
  console.log(`PM Liquidity:   $${pmEvent.liquidity?.toFixed(2) || "0"}`);
  console.log(`PM Markets:     ${pmEvent.markets.length}`);
  
  if (sbOdds) {
    console.log(`\nSportsbook Match: ${sbOdds.away_team} @ ${sbOdds.home_team}`);
    console.log(`Bookmakers:       ${sbOdds.bookmakers.length}`);
    console.log(`Commence Time:    ${sbOdds.commence_time}`);
    
    // Show each bookmaker's odds for moneyline
    const h2hMarkets = sbOdds.bookmakers.map(book => ({
      bookmaker: book.title,
      market: book.markets.find(m => m.key === "h2h"),
    })).filter(b => b.market);
    
    if (h2hMarkets.length > 0) {
      console.log("\n--- MONEYLINE ODDS ---");
      h2hMarkets.forEach(({ bookmaker, market }) => {
        console.log(`\n${bookmaker}:`);
        market?.outcomes.forEach(outcome => {
          const odds = outcome.price > 0 ? `+${outcome.price}` : `${outcome.price}`;
          console.log(`  ${outcome.name}: ${odds}`);
        });
      });
    }
    
    // Show PM markets for comparison
    console.log("\n--- POLYMARKET MARKETS ---");
    pmEvent.markets.forEach((market, idx) => {
      console.log(`\n[${idx + 1}] ${market.question || "Unknown"}`);
      console.log(`    Liquidity: $${market.liquidity || "0"}`);
      
      if (market.outcomes && market.outcomePrices) {
        const outcomes = JSON.parse(market.outcomes);
        const prices = JSON.parse(market.outcomePrices);
        outcomes.forEach((outcome: string, i: number) => {
          const price = prices[i];
          const prob = price ? (price * 100).toFixed(2) : "N/A";
          console.log(`    ${outcome}: ${prob}% (${price || "N/A"})`);
        });
      }
    });
    
  } else {
    console.log("\nSportsbook Match: NOT FOUND");
    console.log("(This PM market has no corresponding sportsbook event)");
  }
  
  console.log("\n" + "=".repeat(80));
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log(" ".repeat(25) + "MATCH OPPORTUNITIES SCANNER");
  console.log("=".repeat(80));
  console.log(`Time Window:     Next ${TIME_WINDOW_HOURS} hours`);
  console.log(`Min Liquidity:   $${MIN_LIQUIDITY.toLocaleString()}`);
  console.log(`Strategy:        PM-driven (only fetch sportsbook odds for PM markets)`);
  console.log("=".repeat(80) + "\n");

  try {
    // STEP 1: Get all Polymarket sports markets
    console.log("[STEP 1] Fetching Polymarket sports markets...");
    const pmMarkets = await getPolymarketSportsMarkets(TIME_WINDOW_HOURS, MIN_LIQUIDITY);
    console.log(`         Found ${pmMarkets.length} PM events\n`);

    let matchedCount = 0;
    let notMatchedCount = 0;
    let unsupportedSportCount = 0;

    // STEP 2: For each PM market, try to find sportsbook odds
    for (const pmEvent of pmMarkets) {
      // Parse team names from title
      const teams = parseTeamNames(pmEvent.title || "");
      if (!teams) {
        console.log(`\n[SKIP] Could not parse teams from: "${pmEvent.title}"`);
        notMatchedCount++;
        continue;
      }

      // Map to Odds API sport
      const sportKey = mapToOddsSport(pmEvent);
      if (!sportKey) {
        console.log(`\n[SKIP] Unsupported sport for: "${pmEvent.title}"`);
        unsupportedSportCount++;
        continue;
      }

      console.log(`\n[CHECKING] ${pmEvent.title}`);
      console.log(`           Sport: ${sportKey}`);
      console.log(`           Teams: ${teams.away} @ ${teams.home}`);

      // STEP 3: Fetch sportsbook odds for this specific matchup
      const sbOdds = await getOddsForMatchup(sportKey, teams.home, teams.away);

      if (sbOdds) {
        matchedCount++;
        displayComparison(pmEvent, sbOdds);
      } else {
        notMatchedCount++;
        console.log(`           Result: No sportsbook odds found`);
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Summary
    console.log("\n" + "=".repeat(80));
    console.log(" ".repeat(35) + "SUMMARY");
    console.log("=".repeat(80));
    console.log(`Total PM Events:      ${pmMarkets.length}`);
    console.log(`Matched:              ${matchedCount}`);
    console.log(`Not Matched:          ${notMatchedCount}`);
    console.log(`Unsupported Sports:   ${unsupportedSportCount}`);
    console.log(`Match Rate:           ${((matchedCount / pmMarkets.length) * 100).toFixed(1)}%`);
    console.log("=".repeat(80) + "\n");

  } catch (error) {
    console.error("\nFATAL ERROR:", error);
    process.exit(1);
  }
}

main();

