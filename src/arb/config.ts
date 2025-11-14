/**
 * Arbitrage Configuration
 *
 * Single source of truth for all arbitrage settings.
 * Import this module instead of duplicating constants.
 */

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
  // Tier 1: Core sharp books (0.80 total)
  pinnacle: 0.4, // Gold standard for sharp lines
  betonlineag: 0.2, // Reduced juice, sharp
  betanysports: 0.1, // Sharp, good limits
  lowvig: 0.1, // Low vig specialist

  // Tier 2: Euro/regional books (0.15 total)
  marathonbet: 0.05, // Sharp European book
  unibet_uk: 0.0125, // Combined Unibet weight: 0.05 total
  unibet_fr: 0.0125,
  unibet_it: 0.0125,
  unibet_nl: 0.0125,
  unibet_se: 0.0,
  sport888: 0.05, // Solid UK book

  // Tier 3: US recreational books (0.05 total)
  draftkings: 0.02, // Market coverage
  fanduel: 0.02, // Market coverage
  betmgm: 0.005, // Caesars/William Hill US
  williamhill_us: 0.005,
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
// MARKET MAKER MARGINS (by market type)
// ============================================================================

export const MAKER_MARGINS: Record<string, { min: number; max: number }> = {
  h2h: { min: 0.03, max: 0.08 },
  spreads: { min: 0.04, max: 0.09 },
  totals: { min: 0.04, max: 0.09 },
  h2h_h1: { min: 0.06, max: 0.12 },
  spreads_h1: { min: 0.06, max: 0.12 },
  totals_h1: { min: 0.06, max: 0.12 },
};

// ============================================================================
// MARKET TAKER MINIMUM EV THRESHOLDS (by market type)
// ============================================================================

export const TAKER_MARGINS: Record<string, number> = {
  h2h: 0.02, // 2% minimum for moneyline
  spreads: 0.03, // 3% minimum for spreads
  totals: 0.03, // 3% minimum for totals
  h2h_h1: 0.05, // 5% minimum for 1st half moneyline
  spreads_h1: 0.05, // 5% minimum for 1st half spreads
  totals_h1: 0.05, // 5% minimum for 1st half totals
};

// ============================================================================
// KELLY CRITERION & POSITION SIZING
// ============================================================================

export const KELLY_MULTIPLIER = 0.5; // Half Kelly (conservative)
export const MAX_PER_MARKET_FRACTION = 0.03; // 3% of bankroll per market
export const MAX_PER_EVENT_FRACTION = 0.06; // 6% of bankroll per event
export const BANKROLL_USD = 1000; // Legacy fallback; real bankroll will come from wallet.ts in production

// ============================================================================
// MAKER STRATEGY
// ============================================================================

// "incremental" = improve current best by 1% (maximize fill probability)
// "target" = use calculated target price (maximize margin)
export const MAKER_STRATEGY: "incremental" | "target" = "incremental";
