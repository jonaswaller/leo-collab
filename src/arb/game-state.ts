import type { GammaEvent, PolymarketMarket } from "./types.js";

const LIVE_GAME_STATUSES = new Set([
  "inprogress",
  "running",
  "break",
  "penaltyshootout",
  "suspended",
]);

const ENDED_GAME_STATUSES = new Set([
  "final",
  "f/ot",
  "f/so",
  "finished",
  "ft",
  "ft ot",
  "ft nr",
  "awarded",
  "canceled",
  "cancelled",
  "forfeit",
  "notnecessary",
  "not necessary",
  "postponed",
]);

export function normalizeGameStatus(status?: string | null): string | null {
  if (!status) return null;

  const normalized = status
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  return normalized || null;
}

export function isExplicitlyLiveGameStatus(
  status?: string | null,
): boolean {
  const normalized = normalizeGameStatus(status);
  return normalized !== null && LIVE_GAME_STATUSES.has(normalized);
}

export function isExplicitlyEndedGameStatus(
  status?: string | null,
): boolean {
  const normalized = normalizeGameStatus(status);
  return normalized !== null && ENDED_GAME_STATUSES.has(normalized);
}

export function isEventLive(event: Pick<GammaEvent, "live" | "gameStatus">): boolean {
  return event.live === true || isExplicitlyLiveGameStatus(event.gameStatus);
}

export function isEventEnded(
  event: Pick<GammaEvent, "ended" | "gameStatus">,
): boolean {
  return event.ended === true || isExplicitlyEndedGameStatus(event.gameStatus);
}

export function isMarketLive(market: Pick<PolymarketMarket, "eventLive" | "gameStatus">): boolean {
  return market.eventLive === true || isExplicitlyLiveGameStatus(market.gameStatus);
}

export function isMarketEnded(
  market: Pick<PolymarketMarket, "eventEnded" | "gameStatus">,
): boolean {
  return market.eventEnded === true || isExplicitlyEndedGameStatus(market.gameStatus);
}
