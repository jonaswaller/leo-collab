import { PolymarketMarket } from "./types.js";

function isFirstHalf(question: string): boolean {
  return /\b1h\b/i.test(question) || /first half/i.test(question);
}

export function normalizeBucketPart(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "-");
}

function getEventBucketBase(market: PolymarketMarket): string {
  const raw =
    market.eventSlug ||
    market.eventTitle ||
    market.marketSlug ||
    market.conditionId ||
    "unknown-event";

  return normalizeBucketPart(raw) || "unknown-event";
}

function getScopeBucketPart(market: PolymarketMarket): string {
  return isFirstHalf(market.marketQuestion) ? "h1" : "full";
}

function getSideBucketTeam(
  market: PolymarketMarket,
  outcome: 1 | 2,
): string | null {
  const raw = outcome === 1 ? market.outcome1Name : market.outcome2Name;
  if (!raw) return null;

  const normalized = normalizeBucketPart(raw);
  return normalized || null;
}

export function getCorrelationBucketKey(
  market: PolymarketMarket,
  outcome?: 1 | 2,
): string {
  const eventBase = getEventBucketBase(market);
  const scope = getScopeBucketPart(market);

  if (market.marketType === "player_props") {
    const player = market.playerName
      ? normalizeBucketPart(market.playerName)
      : "unknown-player";
    return `event:${eventBase}:scope:${scope}:player:${player}`;
  }

  if (market.marketType === "totals") {
    return `event:${eventBase}:scope:${scope}:game_total`;
  }

  if (
    (market.marketType === "h2h" || market.marketType === "spreads") &&
    outcome
  ) {
    const team = getSideBucketTeam(market, outcome);
    if (team) {
      return `event:${eventBase}:scope:${scope}:side:${team}`;
    }
    return `event:${eventBase}:scope:${scope}:side`;
  }

  return `event:${eventBase}:scope:${scope}:market:${market.marketType}`;
}
