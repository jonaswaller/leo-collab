/**
 * Opportunity Analyzer
 *
 * Analyzes matched markets to identify taker and maker opportunities.
 * Calculates EV, applies Kelly sizing, and structures opportunities for execution.
 *
 * Refactored from scripts/match-odds.ts to be reusable in a loop.
 */

import {
  MatchedMarket,
  Opportunities,
  TakerOpportunity,
  MakerOpportunity,
} from "./types.js";
import {
  calculateWeightedConsensus,
  calculateEV,
  calculateKellySize,
  getMarginRange,
  getTakerMinimum,
  roundToWholePercent,
} from "./calculator.js";
import { MAKER_STRATEGY } from "./config.js";

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

function teamsMatch(pm: string, odds: string): boolean {
  const pmNorm = normalizeTeam(pm);
  const oddsNorm = normalizeTeam(odds);

  if (pmNorm === oddsNorm) return true;
  if (pmNorm.includes(oddsNorm) || oddsNorm.includes(pmNorm)) return true;

  return false;
}

function extractLine(question: string, marketType: string): number | null {
  if (marketType === "totals") {
    const match = question.match(/o\/u\s+(\d+\.?\d*)/i);
    return match && match[1] ? parseFloat(match[1]) : null;
  }

  if (marketType === "spreads") {
    const match = question.match(/\(([+-]?\d+\.?\d*)\)/);
    return match && match[1] ? parseFloat(match[1]) : null;
  }

  return null;
}

function isFirstHalf(question: string): boolean {
  return /\b1h\b/i.test(question) || /first half/i.test(question);
}

// ============================================================================
// EV CALCULATION
// ============================================================================

/**
 * Calculate taker and maker EV for a matched market
 */
function calculateMarketEV(
  match: MatchedMarket,
  totalCapitalUsd: number,
): void {
  const pm = match.polymarket;
  const bookmakers = Object.keys(match.sportsbooks);

  if (bookmakers.length === 0) return;

  // Extract bookmaker odds for consensus calculation
  const pmLine = extractLine(pm.marketQuestion, pm.marketType);
  const bookmakerOdds: Array<{
    bookmaker: string;
    outcome1Price: number;
    outcome2Price: number;
  }> = [];

  for (const bookKey of bookmakers) {
    const bookData = match.sportsbooks[bookKey];
    if (!bookData) continue;
    const { market } = bookData;

    let outcome1Price: number | null = null;
    let outcome2Price: number | null = null;

    for (const outcome of market.outcomes) {
      if (pm.marketType === "spreads") {
        if (pmLine !== null && outcome.point !== undefined) {
          if (
            pm.outcome1Name &&
            teamsMatch(pm.outcome1Name, outcome.name) &&
            Math.abs(outcome.point - pmLine) < 0.01
          ) {
            outcome1Price = outcome.price;
          } else if (
            pm.outcome2Name &&
            teamsMatch(pm.outcome2Name, outcome.name) &&
            Math.abs(outcome.point + pmLine) < 0.01
          ) {
            outcome2Price = outcome.price;
          }
        }
      } else if (pm.marketType === "totals") {
        if (pmLine !== null && outcome.point !== undefined) {
          if (Math.abs(outcome.point - pmLine) < 0.01) {
            if (
              pm.outcome1Name &&
              outcome.name.toLowerCase().includes(pm.outcome1Name.toLowerCase())
            ) {
              outcome1Price = outcome.price;
            } else if (
              pm.outcome2Name &&
              outcome.name.toLowerCase().includes(pm.outcome2Name.toLowerCase())
            ) {
              outcome2Price = outcome.price;
            }
          }
        }
      } else {
        if (pm.outcome1Name && teamsMatch(pm.outcome1Name, outcome.name)) {
          outcome1Price = outcome.price;
        } else if (
          pm.outcome2Name &&
          teamsMatch(pm.outcome2Name, outcome.name)
        ) {
          outcome2Price = outcome.price;
        }
      }
    }

    if (outcome1Price !== null && outcome2Price !== null) {
      bookmakerOdds.push({
        bookmaker: bookKey,
        outcome1Price,
        outcome2Price,
      });
    }
  }

  // Determine market type for proper de-vigging method selection
  const marketTypeForDevig =
    pm.marketType === "h2h"
      ? "h2h"
      : pm.marketType === "spreads"
        ? "spreads"
        : "totals";

  const consensus = calculateWeightedConsensus(
    bookmakerOdds,
    marketTypeForDevig,
  );
  if (!consensus) return;

  // Store consensus probability for CLV tracking
  match.fairProbOutcome1 = consensus.consensus1;
  match.fairProbOutcome2 = consensus.consensus2;

  // Calculate taker EV
  let outcome1EV: number | null = null;
  let outcome2EV: number | null = null;

  if (pm.bestAsk !== undefined) {
    outcome1EV = calculateEV(consensus.consensus1, pm.bestAsk);
  }

  if (pm.outcome2Ask !== undefined) {
    outcome2EV = calculateEV(consensus.consensus2, pm.outcome2Ask);
  }

  // Determine best taker EV
  let bestEV: number | null = null;
  let bestOutcome: string | null = null;

  if (outcome1EV !== null && outcome2EV !== null) {
    if (outcome1EV > outcome2EV) {
      bestEV = outcome1EV;
      bestOutcome = pm.outcome1Name || "Outcome 1";
    } else {
      bestEV = outcome2EV;
      bestOutcome = pm.outcome2Name || "Outcome 2";
    }
  } else if (outcome1EV !== null) {
    bestEV = outcome1EV;
    bestOutcome = pm.outcome1Name || "Outcome 1";
  } else if (outcome2EV !== null) {
    bestEV = outcome2EV;
    bestOutcome = pm.outcome2Name || "Outcome 2";
  }

  // Calculate Kelly sizing for taker opportunities
  const marketSlug =
    pm.marketSlug || pm.eventSlug || `${pm.eventTitle}-${pm.marketQuestion}`;
  const eventSlug = pm.eventSlug || pm.eventTitle || "unknown";
  const takerMinimum = getTakerMinimum(
    pm.marketType,
    isFirstHalf(pm.marketQuestion),
  );

  let outcome1Kelly = null;
  let outcome2Kelly = null;

  if (
    pm.bestAsk !== undefined &&
    outcome1EV !== null &&
    outcome1EV >= takerMinimum
  ) {
    outcome1Kelly = calculateKellySize(
      consensus.consensus1,
      pm.bestAsk,
      totalCapitalUsd,
      `${marketSlug}-outcome1`,
      eventSlug,
    );
  }

  if (
    pm.outcome2Ask !== undefined &&
    outcome2EV !== null &&
    outcome2EV >= takerMinimum
  ) {
    outcome2Kelly = calculateKellySize(
      consensus.consensus2,
      pm.outcome2Ask,
      totalCapitalUsd,
      `${marketSlug}-outcome2`,
      eventSlug,
    );
  }

  match.ev = {
    outcome1EV,
    outcome2EV,
    bestEV,
    bestOutcome,
    outcome1Kelly,
    outcome2Kelly,
  };

  // Calculate maker EV
  calculateMakerEV(
    match,
    consensus.consensus1,
    consensus.consensus2,
    totalCapitalUsd,
  );
}

/**
 * Calculate maker EV for posting limit orders
 */
function calculateMakerEV(
  match: MatchedMarket,
  fairProb1: number,
  fairProb2: number,
  totalCapitalUsd: number,
): void {
  const pm = match.polymarket;
  const marginRange = getMarginRange(
    pm.marketType,
    isFirstHalf(pm.marketQuestion),
  );

  match.makerEV = {
    outcome1BidPrice: null,
    outcome1BidMargin: null,
    outcome1BidEV: null,
    outcome1BidKelly: null,
    outcome1AskPrice: null,
    outcome1AskMargin: null,
    outcome1AskEV: null,
    outcome2BidPrice: null,
    outcome2BidMargin: null,
    outcome2BidEV: null,
    outcome2BidKelly: null,
    outcome2AskPrice: null,
    outcome2AskMargin: null,
    outcome2AskEV: null,
    bestMakerEV: null,
    bestMakerSide: null,
  };

  const marketSlug =
    pm.marketSlug || pm.eventSlug || `${pm.eventTitle}-${pm.marketQuestion}`;
  const eventSlug = pm.eventSlug || pm.eventTitle || "unknown";

  // Outcome 1 bid opportunity
  const outcome1BidTarget = fairProb1 - fairProb1 * marginRange.min;
  const outcome1MaxMarginPrice = fairProb1 - fairProb1 * marginRange.max;
  let outcome1BidPrice = roundToWholePercent(outcome1BidTarget, "down");

  if (MAKER_STRATEGY === "incremental" && pm.bestBid !== undefined) {
    const improvedBid = Math.min(0.99, pm.bestBid + 0.01);
    if (improvedBid <= outcome1BidPrice) {
      outcome1BidPrice = improvedBid;
    }
  }

  if (pm.bestBid !== undefined && outcome1BidPrice < pm.bestBid) {
    outcome1BidPrice = pm.bestBid;
  }

  // Ensure we stay below the ask (inside the spread)
  if (pm.bestAsk !== undefined && outcome1BidPrice >= pm.bestAsk) {
    outcome1BidPrice = Math.max(0.01, pm.bestAsk - 0.01);
  }

  // If margin exceeds max threshold, raise bid to max margin price
  const outcome1BidMargin = (fairProb1 - outcome1BidPrice) / fairProb1;
  if (outcome1BidMargin > marginRange.max) {
    outcome1BidPrice = roundToWholePercent(outcome1MaxMarginPrice, "down");
  }

  const outcome1BidEV = (fairProb1 - outcome1BidPrice) / fairProb1;

  const bidMeetsMinimum = outcome1BidEV >= marginRange.min;
  const bidIsCompetitive =
    pm.bestBid === undefined || outcome1BidPrice >= pm.bestBid;
  const withinSpread =
    pm.bestAsk === undefined || outcome1BidPrice < pm.bestAsk;

  // Always record raw maker EV when the quote is structurally valid
  // (inside the spread and competitive), even if it doesn't meet our
  // maker margin thresholds. The trading logic still gates on Kelly size.
  if (withinSpread && bidIsCompetitive) {
    match.makerEV.outcome1BidPrice = outcome1BidPrice;
    match.makerEV.outcome1BidMargin = outcome1BidEV;
    match.makerEV.outcome1BidEV = outcome1BidEV;
  }

  // Only compute Kelly sizing (and thus treat this as a real maker
  // opportunity) if it meets our configured maker margins.
  if (withinSpread && bidMeetsMinimum && bidIsCompetitive) {
    match.makerEV.outcome1BidKelly = calculateKellySize(
      fairProb1,
      outcome1BidPrice,
      totalCapitalUsd,
      `${marketSlug}-outcome1`,
      eventSlug,
    );
  }

  // Outcome 2 bid opportunity
  const outcome2BidTarget = fairProb2 - fairProb2 * marginRange.min;
  const outcome2MaxMarginPrice = fairProb2 - fairProb2 * marginRange.max;
  let outcome2BidPrice = roundToWholePercent(outcome2BidTarget, "down");

  if (MAKER_STRATEGY === "incremental" && pm.outcome2Bid !== undefined) {
    const improvedBid = Math.min(0.99, pm.outcome2Bid + 0.01);
    if (improvedBid <= outcome2BidPrice) {
      outcome2BidPrice = improvedBid;
    }
  }

  if (pm.outcome2Bid !== undefined && outcome2BidPrice < pm.outcome2Bid) {
    outcome2BidPrice = pm.outcome2Bid;
  }

  // Ensure we stay below the ask (inside the spread)
  if (pm.outcome2Ask !== undefined && outcome2BidPrice >= pm.outcome2Ask) {
    outcome2BidPrice = Math.max(0.01, pm.outcome2Ask - 0.01);
  }

  // If margin exceeds max threshold, raise bid to max margin price
  const outcome2BidMargin = (fairProb2 - outcome2BidPrice) / fairProb2;
  if (outcome2BidMargin > marginRange.max) {
    outcome2BidPrice = roundToWholePercent(outcome2MaxMarginPrice, "down");
  }

  const outcome2BidEV = (fairProb2 - outcome2BidPrice) / fairProb2;

  const bid2MeetsMinimum = outcome2BidEV >= marginRange.min;
  const bid2IsCompetitive =
    pm.outcome2Bid === undefined || outcome2BidPrice >= pm.outcome2Bid;
  const withinSpread2 =
    pm.outcome2Ask === undefined || outcome2BidPrice < pm.outcome2Ask;

  // Same pattern as outcome 1: always store raw EV when structurally valid,
  // but only attach Kelly (and thus treat as tradable) if margins are met.
  if (withinSpread2 && bid2IsCompetitive) {
    match.makerEV.outcome2BidPrice = outcome2BidPrice;
    match.makerEV.outcome2BidMargin = outcome2BidEV;
    match.makerEV.outcome2BidEV = outcome2BidEV;
  }

  if (withinSpread2 && bid2MeetsMinimum && bid2IsCompetitive) {
    match.makerEV.outcome2BidKelly = calculateKellySize(
      fairProb2,
      outcome2BidPrice,
      totalCapitalUsd,
      `${marketSlug}-outcome2`,
      eventSlug,
    );
  }

  // Find best maker opportunity
  const opportunities = [
    {
      ev: match.makerEV.outcome1BidEV,
      side: `${pm.outcome1Name || "Outcome 1"} Bid`,
    },
    {
      ev: match.makerEV.outcome2BidEV,
      side: `${pm.outcome2Name || "Outcome 2"} Bid`,
    },
  ].filter((o) => o.ev !== null);

  if (opportunities.length > 0) {
    const best = opportunities.reduce((a, b) =>
      (a.ev ?? 0) > (b.ev ?? 0) ? a : b,
    );
    match.makerEV.bestMakerEV = best.ev;
    match.makerEV.bestMakerSide = best.side;
  }
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

/**
 * Analyze matched markets to identify taker and maker opportunities
 *
 * @param matched - Array of matched markets from matcher
 * @param totalCapitalUsd - Total capital (USDC + position value) for Kelly sizing
 * @returns Structured opportunities ready for execution
 *
 * IMPORTANT: totalCapitalUsd should be your TOTAL CAPITAL (USDC balance + position value),
 * not just free USDC. Use computeCapitalSummary() from positions.ts to get this value.
 */
export function analyzeOpportunities(
  matched: MatchedMarket[],
  totalCapitalUsd: number,
): Opportunities {
  // Calculate EV for all matched markets
  for (const match of matched) {
    if (Object.keys(match.sportsbooks).length > 0) {
      calculateMarketEV(match, totalCapitalUsd);
    }
  }

  // Extract taker opportunities (only those that meet minimum thresholds)
  const takers: TakerOpportunity[] = [];

  for (const match of matched) {
    if (!match.ev) continue;

    const pm = match.polymarket;

    // Skip if missing critical CLOB metadata
    if (!pm.clobTokenIds || pm.clobTokenIds.length < 2) {
      console.warn(
        `[Analyzer] Skipping market ${pm.marketSlug} - missing clobTokenIds`,
      );
      continue;
    }

    if (!pm.conditionId) {
      console.warn(
        `[Analyzer] Skipping market ${pm.marketSlug} - missing conditionId`,
      );
      continue;
    }

    // Outcome 1 taker opportunity
    if (match.ev.outcome1Kelly && pm.bestAsk !== undefined) {
      takers.push({
        marketSlug:
          pm.marketSlug ||
          pm.eventSlug ||
          `${pm.eventTitle}-${pm.marketQuestion}`,
        eventSlug: pm.eventSlug || pm.eventTitle || "unknown",
        eventTitle: pm.eventTitle,
        marketQuestion: pm.marketQuestion,
        sport: pm.sport,
        marketType: pm.marketType,
        outcome: 1,
        outcomeName: pm.outcome1Name || "Outcome 1",
        tokenId: pm.clobTokenIds[0]!, // First token ID is outcome 1
        conditionId: pm.conditionId,
        fairProb: match.ev.outcome1Kelly.edge + pm.bestAsk,
        polymarketAsk: pm.bestAsk,
        ev: match.ev.outcome1EV!,
        kellySize: match.ev.outcome1Kelly,
        tickSize: pm.tickSize || 0.001, // Default to 0.001 if not provided
        minOrderSize: pm.minOrderSize || 5, // Default to 5 shares if not provided
        negRisk: pm.negRisk || false,
        eventStartTime: pm.startTime,
      });
    }

    // Outcome 2 taker opportunity
    if (match.ev.outcome2Kelly && pm.outcome2Ask !== undefined) {
      takers.push({
        marketSlug:
          pm.marketSlug ||
          pm.eventSlug ||
          `${pm.eventTitle}-${pm.marketQuestion}`,
        eventSlug: pm.eventSlug || pm.eventTitle || "unknown",
        eventTitle: pm.eventTitle,
        marketQuestion: pm.marketQuestion,
        sport: pm.sport,
        marketType: pm.marketType,
        outcome: 2,
        outcomeName: pm.outcome2Name || "Outcome 2",
        tokenId: pm.clobTokenIds[1]!, // Second token ID is outcome 2
        conditionId: pm.conditionId,
        fairProb: match.ev.outcome2Kelly.edge + pm.outcome2Ask,
        polymarketAsk: pm.outcome2Ask,
        ev: match.ev.outcome2EV!,
        kellySize: match.ev.outcome2Kelly,
        tickSize: pm.tickSize || 0.001,
        minOrderSize: pm.minOrderSize || 5,
        negRisk: pm.negRisk || false,
        eventStartTime: pm.startTime,
      });
    }
  }

  // Extract maker opportunities
  const makers: MakerOpportunity[] = [];

  for (const match of matched) {
    if (!match.makerEV) continue;

    const pm = match.polymarket;

    // Skip if missing critical CLOB metadata
    if (!pm.clobTokenIds || pm.clobTokenIds.length < 2) {
      continue; // Already warned in taker section
    }

    if (!pm.conditionId) {
      continue; // Already warned in taker section
    }

    const firstHalf = isFirstHalf(pm.marketQuestion);

    // Outcome 1 maker opportunity
    if (
      match.makerEV.outcome1BidKelly &&
      match.makerEV.outcome1BidPrice !== null
    ) {
      makers.push({
        marketSlug:
          pm.marketSlug ||
          pm.eventSlug ||
          `${pm.eventTitle}-${pm.marketQuestion}`,
        eventSlug: pm.eventSlug || pm.eventTitle || "unknown",
        eventTitle: pm.eventTitle,
        marketQuestion: pm.marketQuestion,
        sport: pm.sport,
        marketType: pm.marketType,
        isFirstHalf: firstHalf,
        outcome: 1,
        outcomeName: pm.outcome1Name || "Outcome 1",
        tokenId: pm.clobTokenIds[0]!, // First token ID is outcome 1
        conditionId: pm.conditionId,
        fairProb:
          match.makerEV.outcome1BidKelly.edge + match.makerEV.outcome1BidPrice,
        targetPrice: match.makerEV.outcome1BidPrice,
        currentBid: pm.bestBid,
        margin: match.makerEV.outcome1BidMargin!,
        ev: match.makerEV.outcome1BidEV!,
        kellySize: match.makerEV.outcome1BidKelly,
        tickSize: pm.tickSize || 0.001,
        minOrderSize: pm.minOrderSize || 5,
        negRisk: pm.negRisk || false,
        eventStartTime: pm.startTime,
      });
    }

    // Outcome 2 maker opportunity
    if (
      match.makerEV.outcome2BidKelly &&
      match.makerEV.outcome2BidPrice !== null
    ) {
      makers.push({
        marketSlug:
          pm.marketSlug ||
          pm.eventSlug ||
          `${pm.eventTitle}-${pm.marketQuestion}`,
        eventSlug: pm.eventSlug || pm.eventTitle || "unknown",
        eventTitle: pm.eventTitle,
        marketQuestion: pm.marketQuestion,
        sport: pm.sport,
        marketType: pm.marketType,
        isFirstHalf: firstHalf,
        outcome: 2,
        outcomeName: pm.outcome2Name || "Outcome 2",
        tokenId: pm.clobTokenIds[1]!, // Second token ID is outcome 2
        conditionId: pm.conditionId,
        fairProb:
          match.makerEV.outcome2BidKelly.edge + match.makerEV.outcome2BidPrice,
        targetPrice: match.makerEV.outcome2BidPrice,
        currentBid: pm.outcome2Bid,
        margin: match.makerEV.outcome2BidMargin!,
        ev: match.makerEV.outcome2BidEV!,
        kellySize: match.makerEV.outcome2BidKelly,
        tickSize: pm.tickSize || 0.001,
        minOrderSize: pm.minOrderSize || 5,
        negRisk: pm.negRisk || false,
        eventStartTime: pm.startTime,
      });
    }
  }

  return {
    takers,
    makers,
    matched,
  };
}
