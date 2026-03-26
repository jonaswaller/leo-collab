/**
 * Shared types for sports arbitrage system
 */

// ============================================================================
// POLYMARKET TYPES
// ============================================================================

export type MarketType =
  | "h2h"
  | "spreads"
  | "totals"
  | "player_props"
  | "other";

export interface PolymarketMarket {
  sport: string;
  eventTitle: string;
  homeTeam?: string;
  awayTeam?: string;
  startTime: string; // ISO string
  marketQuestion: string;
  marketType: MarketType;
  liquidity: number;
  outcome1Name?: string;
  bestBid?: number;
  bestAsk?: number;
  lastPrice?: number;
  outcome2Name?: string;
  outcome2Bid?: number;
  outcome2Ask?: number;
  eventSlug?: string;
  marketSlug?: string;
  // Player prop fields
  playerName?: string; // e.g. "LeBron James"
  playerStatType?: string; // e.g. "points", "rebounds", "assists"
  playerLine?: number; // e.g. 27.5
  // CLOB Trading Metadata (required for order execution)
  clobTokenIds?: string[]; // Array of token IDs, e.g., ["123", "456"]
  conditionId?: string; // Condition ID for CLOB operations
  negRisk?: boolean; // Whether this is a neg-risk market
  tickSize?: number; // Minimum price increment (e.g., 0.001)
  minOrderSize?: number; // Minimum shares per order (e.g., 5)
}

// ============================================================================
// GAMMA API TYPES
// ============================================================================

export interface SportMetadata {
  sport: string;
  image?: string;
  resolution?: string;
  ordering?: string;
  tags: string; // comma-separated tag IDs
  series?: string;
}

export interface GammaEvent {
  id: string;
  title: string | null;
  slug: string | null;
  startDate?: string | null;
  startTime?: string | null;
  eventDate?: string | null;
  endDate?: string | null;
  closed?: boolean | null;
  active?: boolean | null;
  markets?: GammaMarket[];
  tags?: Array<{ id: string; label: string; slug: string }> | null;
  category?: string | null;
}

export interface GammaMarket {
  id: string;
  question: string | null;
  slug?: string | null;
  liquidityNum?: number | null;
  liquidityClob?: number | null;
  liquidityAmm?: number | null;
  liquidity?: string | null;
  gameStartTime?: string | null;
  eventStartTime?: string | null;
  closed?: boolean | null;
  active?: boolean | null;
  outcomes?: string | null; // Stringified JSON array
  outcomePrices?: string | null;
  lastTradePrice?: number | null;
  bestBid?: number | null;
  bestAsk?: number | null;
  spread?: number | null;
  // CLOB Trading Metadata
  clobTokenIds?: string | null; // Stringified JSON array, e.g., "[\"123\",\"456\"]"
  conditionId?: string | null;
  negRisk?: boolean | null;
  orderPriceMinTickSize?: number | null;
  orderMinSize?: number | null;
}

// ============================================================================
// ODDS API TYPES
// ============================================================================

export interface OddsAPIOutcome {
  name: string;
  price: number; // American odds
  point?: number; // For spreads/totals
  description?: string; // Player name for player props
}

export interface OddsAPIMarket {
  key: string; // "h2h", "spreads", "totals", etc.
  last_update: string;
  outcomes: OddsAPIOutcome[];
}

export interface OddsAPIBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsAPIMarket[];
}

export interface OddsAPIEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsAPIBookmaker[];
}

// ============================================================================
// MATCHED MARKET TYPES
// ============================================================================

export interface MatchedMarket {
  polymarket: PolymarketMarket;
  sportsbooks: {
    [bookmaker: string]: {
      market: OddsAPIMarket;
      event: OddsAPIEvent;
    };
  };
  skipReason?: string;
  fairProbOutcome1?: number;
  fairProbOutcome2?: number;
  ev?: {
    outcome1EV: number | null;
    outcome2EV: number | null;
    bestEV: number | null;
    bestOutcome: string | null;
    bookmakers: string[];
    outcome1Kelly: KellySize | null;
    outcome2Kelly: KellySize | null;
  };
  makerEV?: {
    outcome1BidPrice: number | null;
    outcome1BidMargin: number | null;
    outcome1BidEV: number | null;
    outcome1BidKelly: KellySize | null;
    outcome1AskPrice: number | null;
    outcome1AskMargin: number | null;
    outcome1AskEV: number | null;
    outcome2BidPrice: number | null;
    outcome2BidMargin: number | null;
    outcome2BidEV: number | null;
    outcome2BidKelly: KellySize | null;
    outcome2AskPrice: number | null;
    outcome2AskMargin: number | null;
    outcome2AskEV: number | null;
    bestMakerEV: number | null;
    bestMakerSide: string | null;
  };
}

export interface KellySize {
  edge: number;
  kellyFraction: number;
  rawKellySizeUSD: number;
  rawKellyShares: number;
  constrainedSizeUSD: number;
  constrainedShares: number;
  limitingFactor: string;
  bankrollPct: number;
}

// ============================================================================
// OPPORTUNITY TYPES
// ============================================================================

export interface TakerOpportunity {
  marketSlug: string;
  eventSlug: string;
  eventTitle: string;
  marketQuestion: string;
  sport: string;
  marketType: MarketType;
  outcome: 1 | 2;
  outcomeName: string;
  tokenId: string; // CLOB token ID for this outcome
  conditionId: string; // CLOB condition ID
  fairProb: number;
  polymarketAsk: number;
  ev: number;
  bookmakers: string[];
  kellySize: KellySize;
  tickSize: number;
  minOrderSize: number;
  negRisk: boolean;
  eventStartTime?: string;
}

export interface MakerOpportunity {
  marketSlug: string;
  eventSlug: string;
  eventTitle: string;
  marketQuestion: string;
  sport: string;
  marketType: MarketType;
  bucketKey: string;
  isFirstHalf: boolean;
  outcome: 1 | 2;
  outcomeName: string;
  tokenId: string; // CLOB token ID for this outcome
  conditionId: string; // CLOB condition ID
  fairProb: number;
  targetPrice: number;
  currentBid: number | undefined;
  margin: number;
  ev: number;
  bookmakers: string[];
  kellySize: KellySize;
  tickSize: number;
  minOrderSize: number;
  negRisk: boolean;
  eventStartTime?: string;
}

export interface Opportunities {
  takers: TakerOpportunity[];
  makers: MakerOpportunity[];
  matched: MatchedMarket[];
}
