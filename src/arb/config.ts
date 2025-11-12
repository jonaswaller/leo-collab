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

export const BOOKMAKERS = ["pinnacle", "betonlineag", "draftkings", "fanduel"];

// Bookmaker weights for consensus odds calculation (must sum to 1.0)
export const BOOKMAKER_WEIGHTS: Record<string, number> = {
  pinnacle: 0.5,
  betonlineag: 0.1,
  draftkings: 0.2,
  fanduel: 0.2,
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
export const BANKROLL_USD = 1000; // TODO: Get from wallet balance in production

// ============================================================================
// MAKER STRATEGY
// ============================================================================

// "incremental" = improve current best by 1% (maximize fill probability)
// "target" = use calculated target price (maximize margin)
export const MAKER_STRATEGY: "incremental" | "target" = "incremental";
