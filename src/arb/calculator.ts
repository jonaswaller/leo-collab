/**
 * Advanced De-Vigging & EV Calculator
 *
 * Implements sophisticated de-vigging algorithms:
 * - Power/Shin method for moneylines (2-way and 3-way)
 * - Probit method for spreads and totals
 * - Weighted consensus across multiple sharp and recreational bookmakers
 *
 * Based on academic research: Shin (1992, 1993), Clarke & Norman (1995)
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

// ============================================================================
// STATISTICAL UTILITIES
// ============================================================================

/**
 * Standard normal cumulative distribution function (CDF)
 * Uses Abramowitz and Stegun approximation (accurate to 7 decimal places)
 */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const prob =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - prob : prob;
}

/**
 * Inverse standard normal CDF (quantile function)
 * Uses Beasley-Springer-Moro algorithm
 */
function invNormCdf(p: number): number {
  // Clamp to avoid numerical issues
  p = Math.max(1e-10, Math.min(1 - 1e-10, p));

  const a: number[] = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b: number[] = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c: number[] = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d: number[] = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let q: number, r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q +
        c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r +
        a[5]!) *
        q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
    );
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(
        ((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q +
        c[5]!
      ) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
}

/**
 * Bisection root-finding method
 */
function bisection(
  f: (x: number) => number,
  a: number,
  b: number,
  tol: number = 1e-8,
  maxIter: number = 100,
): number | null {
  let fa = f(a);
  let fb = f(b);

  if (fa * fb > 0) {
    return null; // No root in interval
  }

  for (let i = 0; i < maxIter; i++) {
    const c = (a + b) / 2;
    const fc = f(c);

    if (Math.abs(fc) < tol || Math.abs(b - a) < tol) {
      return c;
    }

    if (fa * fc < 0) {
      b = c;
      fb = fc;
    } else {
      a = c;
      fa = fc;
    }
  }

  return (a + b) / 2; // Return midpoint if max iterations reached
}

// ============================================================================
// ODDS CONVERSION
// ============================================================================

/**
 * Convert American odds to decimal odds
 */
export function americanToDecimal(americanOdds: number): number {
  if (americanOdds > 0) {
    return americanOdds / 100 + 1;
  } else {
    return 100 / Math.abs(americanOdds) + 1;
  }
}

/**
 * Convert decimal odds to implied probability (raw, with vig)
 */
export function decimalToImpliedProb(decimalOdds: number): number {
  // Clamp to avoid division by zero or negative odds
  if (decimalOdds <= 1.01) return 0.99;
  if (decimalOdds > 1000) return 0.001;
  return 1 / decimalOdds;
}

/**
 * Convert American odds to implied probability (legacy - kept for compatibility)
 */
export function americanToImpliedProb(americanOdds: number): number {
  return decimalToImpliedProb(americanToDecimal(americanOdds));
}

// ============================================================================
// DE-VIGGING ALGORITHMS
// ============================================================================

/**
 * Power de-vig for moneylines (2-way or 3-way)
 *
 * Uses the Power/Shin method which corrects for favorite-longshot bias.
 * Finds exponent k such that sum(q_i^k) = 1, where q_i are raw implied probs.
 *
 * @param decimalOdds - Array of decimal odds for all outcomes
 * @returns Array of fair probabilities (sum = 1.0)
 */
export function devigMoneylinePower(decimalOdds: number[]): number[] {
  // Convert to raw implied probabilities
  const q = decimalOdds.map((odds) => decimalToImpliedProb(odds));

  // If already fair (sum ≈ 1), return as-is
  const qSum = q.reduce((sum, qi) => sum + qi, 0);
  if (Math.abs(qSum - 1) < 0.0001) {
    return q;
  }

  // Define function: sum(q_i^k) - 1 = 0
  const f = (k: number): number => {
    return q.reduce((sum, qi) => sum + Math.pow(qi, k), 0) - 1;
  };

  // Find k using bisection
  const k = bisection(f, 0.2, 2.0, 1e-8, 100);

  if (k === null) {
    // Fallback to proportional if root-finding fails
    console.warn(
      `[Devig] Power method failed for odds ${decimalOdds.join(", ")} (vig: ${((qSum - 1) * 100).toFixed(2)}%), using proportional fallback`,
    );
    return q.map((qi) => qi / qSum);
  }

  // Apply power transformation
  const powered = q.map((qi) => Math.pow(qi, k));
  const Z = powered.reduce((sum, p) => sum + p, 0);

  // Normalize
  return powered.map((p) => p / Z);
}

/**
 * Probit de-vig for 2-way symmetric markets (spreads, totals)
 *
 * Assumes bookmaker margin is additive in probit (normal CDF) space.
 * Solves for margin m such that norm_cdf(z1 - m) + norm_cdf(z2 - m) = 1.
 *
 * @param odds1 - Decimal odds for outcome 1
 * @param odds2 - Decimal odds for outcome 2
 * @returns Tuple of fair probabilities [p1, p2]
 */
export function devigTwoWayProbit(
  odds1: number,
  odds2: number,
): [number, number] {
  // Convert to raw implied probabilities
  let q1 = decimalToImpliedProb(odds1);
  let q2 = decimalToImpliedProb(odds2);

  // Clamp to avoid numerical issues with inverse normal CDF
  q1 = Math.max(1e-6, Math.min(1 - 1e-6, q1));
  q2 = Math.max(1e-6, Math.min(1 - 1e-6, q2));

  // If already fair, return as-is
  if (Math.abs(q1 + q2 - 1) < 0.0001) {
    return [q1, q2];
  }

  // Convert to probit space
  const z1 = invNormCdf(q1);
  const z2 = invNormCdf(q2);

  // Define function: norm_cdf(z1 - m) + norm_cdf(z2 - m) - 1 = 0
  const g = (m: number): number => {
    return normCdf(z1 - m) + normCdf(z2 - m) - 1;
  };

  // Find margin m using bisection
  const m = bisection(g, -3.0, 3.0, 1e-8, 100);

  if (m === null) {
    // Fallback to proportional if root-finding fails
    const total = q1 + q2;
    console.warn(
      `[Devig] Probit method failed for odds [${odds1.toFixed(3)}, ${odds2.toFixed(3)}] (vig: ${((total - 1) * 100).toFixed(2)}%), using proportional fallback`,
    );
    return [q1 / total, q2 / total];
  }

  // Calculate fair probabilities
  let p1 = normCdf(z1 - m);
  let p2 = normCdf(z2 - m);

  // Defensive normalization
  const Z = p1 + p2;
  p1 /= Z;
  p2 /= Z;

  return [p1, p2];
}

/**
 * Legacy 2-way de-vig (for backward compatibility)
 * Now uses Probit method instead of proportional
 */
export function removeVig(
  prob1: number,
  prob2: number,
): { fair1: number; fair2: number } {
  // Convert probabilities back to decimal odds, then use probit method
  const odds1 = 1 / prob1;
  const odds2 = 1 / prob2;
  const [fair1, fair2] = devigTwoWayProbit(odds1, odds2);
  return { fair1, fair2 };
}

// ============================================================================
// WEIGHTED CONSENSUS
// ============================================================================

/**
 * Calculate weighted consensus odds from multiple bookmakers
 * Uses sophisticated de-vigging (Power for moneylines, Probit for spreads/totals)
 * and brand-level weighting with dynamic renormalization
 */
export function calculateWeightedConsensus(
  bookmakerOdds: Array<{
    bookmaker: string;
    outcome1Price: number;
    outcome2Price: number;
    outcome3Price?: number; // For 3-way markets
  }>,
  marketType: "h2h" | "spreads" | "totals" = "h2h",
): { consensus1: number; consensus2: number; consensus3?: number } | null {
  if (bookmakerOdds.length === 0) return null;

  // Determine if this is a 3-way market
  const is3Way = bookmakerOdds.some((b) => b.outcome3Price !== undefined);

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
    normalizedWeights[bookmaker] = normalizedWeights[bookmaker]! / totalWeight;
  }

  // Calculate weighted average of de-vigged probabilities
  let weightedFair1 = 0;
  let weightedFair2 = 0;
  let weightedFair3 = 0;

  // DEBUG: Detect if this is a game we want to trace
  const debugThis =
    bookmakerOdds.length > 0 &&
    marketType === "h2h" &&
    bookmakerOdds.some(
      (b) =>
        (b.outcome1Price >= 240 && b.outcome1Price <= 260) ||
        (b.outcome1Price <= -280 && b.outcome1Price >= -310),
    );

  if (debugThis) {
    console.log("\n" + "=".repeat(80));
    console.log("🔍 DEBUG: De-vigging Calculation Breakdown");
    console.log("=".repeat(80));
    console.log(`Market Type: ${marketType}`);
    console.log(`Method: ${marketType === "h2h" ? "Power/Shin" : "Probit"}`);
    console.log(`Bookmakers: ${bookmakerOdds.length}`);
    console.log("");
  }

  for (const {
    bookmaker,
    outcome1Price,
    outcome2Price,
    outcome3Price,
  } of bookmakerOdds) {
    const weight = normalizedWeights[bookmaker];
    if (!weight) continue;

    // Convert American odds to decimal
    const decimal1 = americanToDecimal(outcome1Price);
    const decimal2 = americanToDecimal(outcome2Price);

    let fair1: number, fair2: number, fair3: number | undefined;

    if (is3Way && outcome3Price !== undefined) {
      // 3-way market: use Power method
      const decimal3 = americanToDecimal(outcome3Price);
      const fairProbs = devigMoneylinePower([decimal1, decimal2, decimal3]);
      fair1 = fairProbs[0]!;
      fair2 = fairProbs[1]!;
      fair3 = fairProbs[2]!;
    } else if (marketType === "h2h") {
      // 2-way moneyline: use Power method
      const fairProbs = devigMoneylinePower([decimal1, decimal2]);
      fair1 = fairProbs[0]!;
      fair2 = fairProbs[1]!;

      if (debugThis) {
        const q1 = 1 / decimal1;
        const q2 = 1 / decimal2;
        const vig = ((q1 + q2 - 1) * 100).toFixed(2);
        console.log(
          `  ${bookmaker.padEnd(15)} | Odds: ${outcome1Price > 0 ? "+" : ""}${outcome1Price}/${outcome2Price > 0 ? "+" : ""}${outcome2Price} | Raw: ${(q1 * 100).toFixed(2)}%/${(q2 * 100).toFixed(2)}% (${vig}% vig)`,
        );
        console.log(
          `  ${" ".repeat(15)} | Fair: ${(fair1 * 100).toFixed(2)}%/${(fair2 * 100).toFixed(2)}% | Weight: ${(weight * 100).toFixed(1)}% | Contrib: ${(fair1 * weight * 100).toFixed(2)}%`,
        );
      }
    } else {
      // Spreads/totals: use Probit method
      [fair1, fair2] = devigTwoWayProbit(decimal1, decimal2);
    }

    weightedFair1 += fair1 * weight;
    weightedFair2 += fair2 * weight;
    if (fair3 !== undefined) {
      weightedFair3 += fair3 * weight;
    }
  }

  if (debugThis) {
    console.log("");
    console.log(`📊 FINAL CONSENSUS:`);
    console.log(`   Outcome 1: ${(weightedFair1 * 100).toFixed(2)}%`);
    console.log(`   Outcome 2: ${(weightedFair2 * 100).toFixed(2)}%`);
    console.log(
      `   Total: ${((weightedFair1 + weightedFair2) * 100).toFixed(2)}%`,
    );
    console.log("=".repeat(80) + "\n");
  }

  if (is3Way) {
    return {
      consensus1: weightedFair1,
      consensus2: weightedFair2,
      consensus3: weightedFair3,
    };
  }

  return {
    consensus1: weightedFair1,
    consensus2: weightedFair2,
  };
}

// ============================================================================
// EV & KELLY SIZING
// ============================================================================

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

// ============================================================================
// MAKER STRATEGY HELPERS
// ============================================================================

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
