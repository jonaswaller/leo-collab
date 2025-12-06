/**
 * Arbitrage Configuration
 *
 * Single source of truth for all arbitrage settings.
 * Import this module instead of duplicating constants.
 */

// ============================================================================
// Polymarket Market Discovery
// ============================================================================

export const HOURS_AHEAD = 24;

// ============================================================================
// API CONFIGURATION
// ============================================================================

export const ODDS_API_KEY = process.env.ODDS_API_KEY!;
export const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

// ============================================================================
// BOOKMAKER CONFIGURATION
// ============================================================================

// Bookmakers to fetch odds from (expanded list for better coverage)
export const BOOKMAKERS = [
  // Tier 1: Sharp books
  "pinnacle",
  "betonlineag",
  "betanysports",
  "lowvig",
  // Tier 2: Euro/regional books
  "marathonbet",
  "unibet_uk",
  "unibet_fr",
  "unibet_it",
  "unibet_nl",
  "unibet_se",
  "sport888",
  // Tier 3: US recreational books
  "draftkings",
  "fanduel",
  "betmgm",
  "williamhill_us",
];

/**
 * Brand-level bookmaker weights for consensus calculation
 *
 * Tier 1 (0.80): Sharp/reduced-juice books with best price discovery
 * Tier 2 (0.15): Solid Euro/regional books
 * Tier 3 (0.05): US recreational books (for market coverage)
 *
 * Weights are brand-level, not region-level. Multiple region codes
 * (e.g., us.betonlineag, eu.betonlineag) map to the same brand weight.
 *
 * Total must sum to 1.0 for proper weighted averaging.
 */
export const BOOKMAKER_WEIGHTS: Record<string, number> = {
  // Tier 1: Core sharp books (0.72 total)
  pinnacle: 0.4, // Gold standard for sharp lines
  marathonbet: 0.15, // Low-margin Euro sharp book
  betonlineag: 0.1, // Competitive odds and reduced juice
  betanysports: 0.07, // Sharp and high-limit

  // Tier 2: Euro/regional books (0.07 total)
  unibet_uk: 0.04, // Consolidated from all Unibet regions (UK/FR/IT/NL/SE)
  sport888: 0.03, // Recreational UK-facing book, limited sharpness

  // Tier 3: US recreational books (0.21 total)
  draftkings: 0.1, // Mixed book, moderate sharp influence
  fanduel: 0.07, // Market coverage, moderately sharp
  fanatics: 0.04, // Better than BetMGM; solid mid-tier US book
};

// ============================================================================
// SPORT MAPPING (Polymarket -> Odds API)
// ============================================================================

export const SPORT_MAP: Record<string, string> = {
  nfl: "americanfootball_nfl",
  cfb: "americanfootball_ncaaf",
  nba: "basketball_nba",
  ncaab: "basketball_ncaab",
  cbb: "basketball_ncaab",
  wnba: "basketball_wnba",
  nhl: "icehockey_nhl",
  mlb: "baseball_mlb",
  epl: "soccer_epl",
  lal: "soccer_spain_la_liga",
  sea: "soccer_italy_serie_a",
  bun: "soccer_germany_bundesliga",
  fl1: "soccer_france_ligue_one",
  ere: "soccer_netherlands_eredivisie",
  mls: "soccer_usa_mls",
  mex: "soccer_mexico_ligamx",
  ucl: "soccer_uefa_champs_league",
  uel: "soccer_uefa_europa_league",
  wcq_europe: "soccer_fifa_world_cup_qualifiers_europe", // FIFA WCQ - UEFA
  wcq_south_america: "soccer_fifa_world_cup_qualifiers_south_america", // FIFA WCQ - CONMEBOL
  concacaf: "soccer_concacaf_gold_cup", // CONCACAF competitions
  wc: "soccer_fifa_world_cup", // FIFA World Cup
  wwc: "soccer_fifa_world_cup_womens", // FIFA Women's World Cup
  wcw: "soccer_fifa_world_cup_winner", // FIFA World Cup Winner
  cwc: "soccer_fifa_club_world_cup", // FIFA Club World Cup
  mma: "mma_mixed_martial_arts",
};

// ============================================================================
// MARGIN ADJUSTMENT
// ============================================================================

// Change to 0.01 on Friday, back to 0.00 on Saturday night
export const MARGIN_ADJUSTMENT = 0.0;

// ============================================================================
// MARKET MAKER MARGINS (by market type)
// ============================================================================

export const MAKER_MARGINS: Record<string, { min: number; max: number }> = {
  h2h: { min: 0.03 + MARGIN_ADJUSTMENT, max: 0.08 + MARGIN_ADJUSTMENT },
  spreads: { min: 0.04 + MARGIN_ADJUSTMENT, max: 0.09 + MARGIN_ADJUSTMENT },
  totals: { min: 0.05 + MARGIN_ADJUSTMENT, max: 0.11 + MARGIN_ADJUSTMENT },
  h2h_h1: { min: 0.06 + MARGIN_ADJUSTMENT, max: 0.12 + MARGIN_ADJUSTMENT },
  spreads_h1: { min: 0.06 + MARGIN_ADJUSTMENT, max: 0.12 + MARGIN_ADJUSTMENT },
  totals_h1: { min: 0.06 + MARGIN_ADJUSTMENT, max: 0.12 + MARGIN_ADJUSTMENT },
};

// ============================================================================
// MARKET TAKER MINIMUM EV THRESHOLDS (by market type)
// ============================================================================

export const TAKER_MARGINS: Record<string, number> = {
  h2h: 0.03 + MARGIN_ADJUSTMENT, // 2% minimum for moneyline
  spreads: 0.04 + MARGIN_ADJUSTMENT, // 3% minimum for spreads
  totals: 0.05 + MARGIN_ADJUSTMENT, // 3% minimum for totals
  h2h_h1: 0.06 + MARGIN_ADJUSTMENT, // 5% minimum for 1st half moneyline
  spreads_h1: 0.06 + MARGIN_ADJUSTMENT, // 5% minimum for 1st half spreads
  totals_h1: 0.06 + MARGIN_ADJUSTMENT, // 5% minimum for 1st half totals
};

// ============================================================================
// KELLY CRITERION & POSITION SIZING
// ============================================================================

export const KELLY_MULTIPLIER = 0.5; // Half Kelly (conservative)
export const MAX_PER_MARKET_FRACTION = 0.03; // 3% of bankroll per market - enforced per order immediately
export const MAX_PER_EVENT_FRACTION = 0.05; // WAS 7% of bankroll per event - enforced only on ACTUAL position value, not on the sum of open orders
export const BANKROLL_USD = 1000; // Legacy fallback; real bankroll will come from wallet.ts in production

// ============================================================================
// MAKER ORDER EVALUATION (PHASE 4)
// ============================================================================

// If currentEV drops more than this vs evAtPlacement, cancel
export const MAKER_EVAL_EV_DROP = 0.02; // 2%

// ============================================================================
// MAIN LOOP POLLING (PHASE 5)
// ============================================================================

// Fixed polling interval for all markets (in milliseconds)
export const POLLING_INTERVAL_MS = 15_000; // 15 seconds = 15_000

// ============================================================================
// CLV UPDATE WINDOW
// ============================================================================

// How long before event start we begin updating CLV (in milliseconds)
export const CLV_UPDATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// ============================================================================
// MAKER STRATEGY
// ============================================================================

// "incremental" = improve current best by 1% (maximize fill probability)
// "target" = use calculated target price (maximize margin)
export const MAKER_STRATEGY: "incremental" | "target" = "incremental";
