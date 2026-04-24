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

// Bookmakers to fetch odds from.
//
// This list MUST stay in sync with BOOKMAKER_WEIGHTS below: any key fetched
// here but missing a weight gets silently treated as weight 0 by the
// consensus calculator. That inflates the bookmaker *count* (used by
// `getMinBookmakers` gating in index.ts) without contributing to fair prob,
// so a market could pass a "3 books required" check while the fair price
// actually comes from 1 weighted book.
export const BOOKMAKERS = [
  // Tier 1: Sharp books
  "pinnacle",
  "betonlineag",
  "betanysports",
  // Tier 2: Euro/regional books
  "marathonbet",
  "unibet_uk",
  "sport888",
  // Tier 3: US recreational books
  "draftkings",
  "fanduel",
];

/**
 * Brand-level bookmaker weights for consensus calculation.
 *
 * Every key here MUST also appear in BOOKMAKERS above (and vice versa) —
 * the count gating in index.ts reads bookmakers present in the odds
 * response, so any imbalance between this map and the fetch list
 * silently breaks the min-bookmaker guard.
 *
 * Weights don't need to sum to 1.0 — the consensus calculator normalizes
 * whatever books are actually present per market (calculator.ts:378).
 * Relative magnitudes are what matter.
 */
export const BOOKMAKER_WEIGHTS: Record<string, number> = {
  // Tier 1: Core sharp books
  pinnacle: 0.4, // Gold standard for sharp lines
  marathonbet: 0.15, // Low-margin Euro sharp book
  betonlineag: 0.1, // Competitive odds and reduced juice
  betanysports: 0.07, // Sharp and high-limit

  // Tier 2: Euro/regional books
  unibet_uk: 0.04,
  sport888: 0.03, // Recreational UK-facing book, limited sharpness

  // Tier 3: US recreational books
  draftkings: 0.1, // Mixed book, moderate sharp influence
  fanduel: 0.07, // Market coverage, moderately sharp
};

// ============================================================================
// SPORT MAPPING (Polymarket -> Odds API)
// ============================================================================

// Each sport maps to one or more Odds API sport keys. Tennis is the only sport
// here that fans out — Odds API has no umbrella "all ATP" key, only
// per-tournament keys, so a single Polymarket tennis market may match any of
// the active tennis_atp_* / tennis_wta_* keys. Out-of-season tournament keys
// return 404 and are silently skipped by fetchBaseOddsForSport.
export const SPORT_MAP: Record<string, string | string[]> = {
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
  tennis: [
    // ATP
    "tennis_atp_aus_open_singles",
    "tennis_atp_canadian_open",
    "tennis_atp_china_open",
    "tennis_atp_cincinnati_open",
    "tennis_atp_dubai",
    "tennis_atp_french_open",
    "tennis_atp_indian_wells",
    "tennis_atp_italian_open",
    "tennis_atp_madrid_open",
    "tennis_atp_miami_open",
    "tennis_atp_monte_carlo_masters",
    "tennis_atp_paris_masters",
    "tennis_atp_qatar_open",
    "tennis_atp_shanghai_masters",
    "tennis_atp_us_open",
    "tennis_atp_wimbledon",
    // WTA
    "tennis_wta_aus_open_singles",
    "tennis_wta_canadian_open",
    "tennis_wta_china_open",
    "tennis_wta_cincinnati_open",
    "tennis_wta_dubai",
    "tennis_wta_french_open",
    "tennis_wta_indian_wells",
    "tennis_wta_italian_open",
    "tennis_wta_madrid_open",
    "tennis_wta_miami_open",
    "tennis_wta_qatar_open",
    "tennis_wta_us_open",
    "tennis_wta_wimbledon",
    "tennis_wta_wuhan_open",
  ],
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
  totals: { min: 0.07 + MARGIN_ADJUSTMENT, max: 0.11 + MARGIN_ADJUSTMENT },
  h2h_h1: { min: 0.06 + MARGIN_ADJUSTMENT, max: 0.12 + MARGIN_ADJUSTMENT },
  spreads_h1: { min: 0.06 + MARGIN_ADJUSTMENT, max: 0.12 + MARGIN_ADJUSTMENT },
  totals_h1: { min: 0.06 + MARGIN_ADJUSTMENT, max: 0.12 + MARGIN_ADJUSTMENT },
  player_props: { min: 0.07 + MARGIN_ADJUSTMENT, max: 0.14 + MARGIN_ADJUSTMENT },
  // NRFI/YRFI: 2-way O/U 0.5 runs in 1st inning. Volatile single-inning
  // outcome, thin book coverage (Pinnacle/DK/FD mostly), so we require wider
  // margin than full-game totals to compensate for higher variance.
  nrfi: { min: 0.07 + MARGIN_ADJUSTMENT, max: 0.13 + MARGIN_ADJUSTMENT },
};

// ============================================================================
// MARKET TAKER MINIMUM EV THRESHOLDS (by market type)
// ============================================================================

// Minimum number of bookmakers required for ANY order (taker or maker).
// Default is 3 — markets with fewer books lack cross-validation, so a
// single book with a stale or anomalous line produces unreliable fair probs.
//
// NRFI is an exception: industry-wide, Pinnacle is the primary source for
// 1st-inning totals and most other books don't publish them at all. Gating
// NRFI at 3 would kill the market entirely, so we accept Pinnacle-only
// consensus for it.
export const MIN_BOOKMAKERS_DEFAULT = 3;
export const MIN_BOOKMAKERS_BY_TYPE: Record<string, number> = {
  nrfi: 1,
};

export function getMinBookmakers(marketType: string): number {
  return MIN_BOOKMAKERS_BY_TYPE[marketType] ?? MIN_BOOKMAKERS_DEFAULT;
}

export const TAKER_MARGINS: Record<string, number> = {
  h2h: 0.06 + MARGIN_ADJUSTMENT, // 2% minimum for moneyline
  spreads: 0.08 + MARGIN_ADJUSTMENT, // 3% minimum for spreads
  totals: 0.08 + MARGIN_ADJUSTMENT, // 3% minimum for totals
  h2h_h1: 0.10 + MARGIN_ADJUSTMENT, // 5% minimum for 1st half moneyline
  spreads_h1: 0.10 + MARGIN_ADJUSTMENT, // 5% minimum for 1st half spreads
  totals_h1: 0.10 + MARGIN_ADJUSTMENT, // 5% minimum for 1st half totals
  nrfi: 0.10 + MARGIN_ADJUSTMENT, // 10% minimum for NRFI (thin coverage, high variance)
};

// ============================================================================
// KELLY CRITERION & POSITION SIZING
// ============================================================================

export const KELLY_MULTIPLIER = 0.4; // Half Kelly (conservative)
export const MAX_PER_MARKET_FRACTION = 0.04; // 3% of bankroll per market - enforced per order immediately
export const MAX_PER_BUCKET_FRACTION = 0.07; // 7% of bankroll per correlation bucket
export const BANKROLL_USD = 1000; // Legacy fallback; real bankroll will come from wallet.ts in production

// ============================================================================
// MAKER ORDER EVALUATION (PHASE 4)
// ============================================================================

// If currentEV drops more than this vs evAtPlacement, cancel
export const MAKER_EVAL_EV_DROP = 0.02; // 2%

// If sportsbook coverage suddenly deteriorates for a market, pull resting
// maker liquidity and do not repost for this many completed bot cycles.
export const BOOKMAKER_DROP_COOLDOWN_CYCLES = 7;

// If weighted fair value for a market shifts by more than this amount within
// the trailing window below, stop making that market for the same cooldown
// duration. Expressed in probability points, so 0.02 = 2 percentage points.
export const FAIR_VALUE_MOVE_COOLDOWN_THRESHOLD = 0.02;
export const FAIR_VALUE_MOVE_WINDOW_MS = 15 * 60 * 1000;

// ============================================================================
// MAIN LOOP POLLING (PHASE 5)
// ============================================================================

// Fixed polling interval for all markets (in milliseconds)
export const POLLING_INTERVAL_MS = 0; // No sleep between cycles

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
