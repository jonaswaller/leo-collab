/**
 * EV Calculator
 * Calculates expected value for taker and maker opportunities
 */

import { KellySize } from "./types.js";
import {
  BOOKMAKER_WEIGHTS,
  MAKER_MARGINS,
  TAKER_MARGINS,
  KELLY_MULTIPLIER,
  MAX_PER_MARKET_FRACTION,
  MAX_PER_EVENT_FRACTION,
  BANKROLL_USD,
} from "./config.js";

// Position tracking (in-memory for now)
const currentPositions: {
  byMarket: Map<string, number>;
  byEvent: Map<string, number>;
} = {
  byMarket: new Map(),
  byEvent: new Map(),
};

/**
 * Convert American odds to implied probability
 */
export function americanToImpliedProb(americanOdds: number): number {
  if (americanOdds > 0) {
    return 100 / (americanOdds + 100);
  } else {
    return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
  }
}

/**
 * Remove vig from two-sided market (normalize to 100%)
 */
export function removeVig(
  prob1: number,
  prob2: number,
): { fair1: number; fair2: number } {
  const total = prob1 + prob2;
  return {
    fair1: prob1 / total,
    fair2: prob2 / total,
  };
}

/**
 * Calculate weighted consensus odds from multiple bookmakers
 */
export function calculateWeightedConsensus(
  bookmakerOdds: Array<{
    bookmaker: string;
    outcome1Price: number;
    outcome2Price: number;
  }>,
): { consensus1: number; consensus2: number } | null {
  if (bookmakerOdds.length === 0) return null;

  // Calculate available weights and normalize
  let totalWeight = 0;
  const normalizedWeights: Record<string, number> = {};

  for (const { bookmaker } of bookmakerOdds) {
    const weight = BOOKMAKER_WEIGHTS[bookmaker] || 0;
    totalWeight += weight;
    normalizedWeights[bookmaker] = weight;
  }

  if (totalWeight === 0) return null;

  // Normalize weights to sum to 1.0
  for (const bookmaker in normalizedWeights) {
    const currentWeight = normalizedWeights[bookmaker];
    if (currentWeight !== undefined) {
      normalizedWeights[bookmaker] = currentWeight / totalWeight;
    }
  }

  // Calculate weighted average of de-vigged probabilities
  let weightedFair1 = 0;
  let weightedFair2 = 0;

  for (const { bookmaker, outcome1Price, outcome2Price } of bookmakerOdds) {
    const weight = normalizedWeights[bookmaker];
    if (!weight) continue;

    const implied1 = americanToImpliedProb(outcome1Price);
    const implied2 = americanToImpliedProb(outcome2Price);

    const { fair1, fair2 } = removeVig(implied1, implied2);

    weightedFair1 += fair1 * weight;
    weightedFair2 += fair2 * weight;
  }

  return {
    consensus1: weightedFair1,
    consensus2: weightedFair2,
  };
}

/**
 * Calculate Expected Value (EV) for betting on Polymarket
 */
export function calculateEV(
  fairProbability: number,
  polymarketAsk: number,
): number | null {
  if (fairProbability <= 0) return null;
  return (fairProbability - polymarketAsk) / fairProbability;
}

/**
 * Calculate Kelly Criterion bet size
 */
export function calculateKellySize(
  fairProb: number,
  price: number,
  bankroll: number,
  marketSlug: string,
  eventSlug: string,
): KellySize {
  const edge = fairProb - price;
  const kellyFraction = edge / (1 - price);
  const adjustedKelly = kellyFraction * KELLY_MULTIPLIER;

  const rawKellySizeUSD = bankroll * adjustedKelly;
  const rawKellyShares = rawKellySizeUSD / price;

  // Calculate position limits
  const maxPerMarket = bankroll * MAX_PER_MARKET_FRACTION;
  const maxPerEvent = bankroll * MAX_PER_EVENT_FRACTION;

  const currentMarketExposure = currentPositions.byMarket.get(marketSlug) || 0;
  const currentEventExposure = currentPositions.byEvent.get(eventSlug) || 0;

  const remainingMarketRoom = maxPerMarket - currentMarketExposure;
  const remainingEventRoom = maxPerEvent - currentEventExposure;

  let constrainedSizeUSD = rawKellySizeUSD;
  let limitingFactor = "kelly";

  if (remainingMarketRoom < constrainedSizeUSD) {
    constrainedSizeUSD = remainingMarketRoom;
    limitingFactor = "market_limit";
  }

  if (remainingEventRoom < constrainedSizeUSD) {
    constrainedSizeUSD = remainingEventRoom;
    limitingFactor = "event_limit";
  }

  constrainedSizeUSD = Math.max(0, constrainedSizeUSD);

  const constrainedShares = constrainedSizeUSD / price;
  const bankrollPct = (constrainedSizeUSD / bankroll) * 100;

  return {
    edge,
    kellyFraction: adjustedKelly,
    rawKellySizeUSD,
    rawKellyShares,
    constrainedSizeUSD,
    constrainedShares,
    limitingFactor,
    bankrollPct,
  };
}

/**
 * Get margin range for market type
 */
export function getMarginRange(
  marketType: string,
  isFirstHalf: boolean,
): { min: number; max: number } {
  const marketTypeKey = isFirstHalf ? `${marketType}_h1` : marketType;
  return (
    MAKER_MARGINS[marketTypeKey] ||
    MAKER_MARGINS[marketType] || { min: 0.04, max: 0.09 }
  );
}

/**
 * Get taker minimum EV threshold
 */
export function getTakerMinimum(
  marketType: string,
  isFirstHalf: boolean,
): number {
  const marketTypeKey = isFirstHalf ? `${marketType}_h1` : marketType;
  return TAKER_MARGINS[marketTypeKey] || TAKER_MARGINS[marketType] || 0.03;
}

/**
 * Round price to whole percentage points
 */
export function roundToWholePercent(
  price: number,
  direction: "up" | "down",
): number {
  if (direction === "up") {
    return Math.min(0.99, Math.ceil(price * 100) / 100);
  } else {
    return Math.max(0.01, Math.floor(price * 100) / 100);
  }
}
