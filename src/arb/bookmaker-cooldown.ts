import { MatchedMarket, MakerOpportunity, PolymarketMarket } from "./types.js";

const PINNACLE_BOOKMAKER_KEY = "pinnacle";

interface MarketBookmakerSnapshot {
  bookmakers: string[];
  count: number;
  hasPinnacle: boolean;
  cycleNumber: number;
}

interface MarketFairValueSnapshot {
  observedAtMs: number;
  fairProbOutcome1: number;
  fairProbOutcome2: number;
}

interface CooldownEntry {
  marketKey: string;
  triggeredCycle: number;
  cooldownUntilCycle: number;
  reasons: string[];
}

export interface BookmakerCooldownTrigger {
  marketKey: string;
  eventTitle: string;
  marketQuestion: string;
  previousCount: number;
  currentCount: number;
  previousBookmakers: string[];
  currentBookmakers: string[];
  countDrop: number;
  pinnacleDropped: boolean;
  fairValueMoved?: boolean;
  fairValueMove?: number;
  fairValueWindowMs?: number;
  previousFairProbOutcome1?: number;
  currentFairProbOutcome1?: number;
  triggeredCycle: number;
  cooldownUntilCycle: number;
  reasons: string[];
}

export interface ActiveBookmakerCooldown {
  marketKey: string;
  cooldownUntilCycle: number;
  remainingCycles: number;
  reasons: string[];
}

export interface BookmakerCooldownUpdate {
  triggered: BookmakerCooldownTrigger[];
  active: ActiveBookmakerCooldown[];
}

export function getMarketCooldownKey(market: PolymarketMarket): string {
  return (
    market.marketSlug ||
    market.eventSlug ||
    `${market.eventTitle}-${market.marketQuestion}`
  );
}

function getBookmakers(match: MatchedMarket): string[] {
  const evBookmakers = match.ev?.bookmakers ?? [];
  const source =
    evBookmakers.length > 0 ? evBookmakers : Object.keys(match.sportsbooks);

  return Array.from(new Set(source)).sort();
}

function buildSnapshot(
  match: MatchedMarket,
  cycleNumber: number,
): MarketBookmakerSnapshot {
  const bookmakers = getBookmakers(match);

  return {
    bookmakers,
    count: bookmakers.length,
    hasPinnacle: bookmakers.includes(PINNACLE_BOOKMAKER_KEY),
    cycleNumber,
  };
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function buildFairValueSnapshot(
  match: MatchedMarket,
  observedAtMs: number,
): MarketFairValueSnapshot | null {
  if (
    !isFiniteNumber(match.fairProbOutcome1) ||
    !isFiniteNumber(match.fairProbOutcome2)
  ) {
    return null;
  }

  return {
    observedAtMs,
    fairProbOutcome1: match.fairProbOutcome1,
    fairProbOutcome2: match.fairProbOutcome2,
  };
}

function computeFairValueMove(
  previous: MarketFairValueSnapshot,
  current: MarketFairValueSnapshot,
): number {
  return Math.max(
    Math.abs(current.fairProbOutcome1 - previous.fairProbOutcome1),
    Math.abs(current.fairProbOutcome2 - previous.fairProbOutcome2),
  );
}

function formatProbPct(prob: number): string {
  return `${(prob * 100).toFixed(1)}%`;
}

/**
 * Tracks sudden market-quality deterioration per Polymarket market.
 *
 * A market enters cooldown when:
 * - bookmaker count drops by 2+ versus the previous observed snapshot, or
 * - Pinnacle was present in the previous snapshot and is missing now, or
 * - weighted fair value moves sharply inside a trailing time window.
 */
export class MarketBookmakerCooldowns {
  private snapshots = new Map<string, MarketBookmakerSnapshot>();
  private fairValueHistory = new Map<string, MarketFairValueSnapshot[]>();
  private cooldowns = new Map<string, CooldownEntry>();

  constructor(
    private readonly cooldownCycles: number,
    private readonly fairValueMoveThreshold: number,
    private readonly fairValueWindowMs: number,
  ) {}

  updateFromMatches(
    matches: MatchedMarket[],
    cycleNumber: number,
  ): BookmakerCooldownUpdate {
    this.pruneExpired(cycleNumber);
    const observedAtMs = Date.now();
    this.pruneFairValueHistory(observedAtMs);

    const currentSnapshots = new Map<
      string,
      { match: MatchedMarket; snapshot: MarketBookmakerSnapshot }
    >();

    for (const match of matches) {
      const marketKey = getMarketCooldownKey(match.polymarket);
      currentSnapshots.set(marketKey, {
        match,
        snapshot: buildSnapshot(match, cycleNumber),
      });
    }

    const triggered: BookmakerCooldownTrigger[] = [];

    for (const [marketKey, { match, snapshot }] of currentSnapshots) {
      const previous = this.snapshots.get(marketKey);
      const reasons: string[] = [];
      let countDrop = 0;
      let pinnacleDropped = false;
      let fairValueMove: number | null = null;
      let fairValuePrevious: MarketFairValueSnapshot | null = null;

      if (previous) {
        countDrop = previous.count - snapshot.count;
        pinnacleDropped = previous.hasPinnacle && !snapshot.hasPinnacle;

        if (countDrop >= 2) {
          reasons.push(
            `bookmaker count dropped ${previous.count} -> ${snapshot.count}`,
          );
        }

        if (pinnacleDropped) {
          reasons.push("Pinnacle disappeared");
        }
      }

      const fairValueTrigger = this.detectFairValueMove(
        marketKey,
        match,
        observedAtMs,
      );
      if (fairValueTrigger) {
        fairValueMove = fairValueTrigger.move;
        fairValuePrevious = fairValueTrigger.previous;

        const windowMinutes = Math.round(this.fairValueWindowMs / 60000);
        const outcomeLabel = match.polymarket.outcome1Name || "Outcome 1";
        reasons.push(
          `fair value moved ${(fairValueMove * 100).toFixed(1)}pp in ${windowMinutes}m (${outcomeLabel} ${formatProbPct(
            fairValuePrevious.fairProbOutcome1,
          )} -> ${formatProbPct(fairValueTrigger.current.fairProbOutcome1)})`,
        );
      }

      if (reasons.length > 0) {
        const cooldownUntilCycle = cycleNumber + this.cooldownCycles;
        this.cooldowns.set(marketKey, {
          marketKey,
          triggeredCycle: cycleNumber,
          cooldownUntilCycle,
          reasons,
        });

        const trigger: BookmakerCooldownTrigger = {
          marketKey,
          eventTitle: match.polymarket.eventTitle,
          marketQuestion: match.polymarket.marketQuestion,
          previousCount: previous?.count ?? snapshot.count,
          currentCount: snapshot.count,
          previousBookmakers: previous?.bookmakers ?? snapshot.bookmakers,
          currentBookmakers: snapshot.bookmakers,
          countDrop,
          pinnacleDropped,
          triggeredCycle: cycleNumber,
          cooldownUntilCycle,
          reasons,
        };

        if (fairValueMove !== null && fairValueTrigger && fairValuePrevious) {
          trigger.fairValueMoved = true;
          trigger.fairValueMove = fairValueMove;
          trigger.fairValueWindowMs = this.fairValueWindowMs;
          trigger.previousFairProbOutcome1 = fairValuePrevious.fairProbOutcome1;
          trigger.currentFairProbOutcome1 =
            fairValueTrigger.current.fairProbOutcome1;
        }

        triggered.push(trigger);
      }

      this.snapshots.set(marketKey, snapshot);
    }

    return {
      triggered,
      active: this.getActiveCooldowns(cycleNumber),
    };
  }

  filterMakerOpportunities(
    makers: MakerOpportunity[],
    cycleNumber: number,
  ): MakerOpportunity[] {
    return makers.filter((maker) => !this.isCooling(maker.marketSlug, cycleNumber));
  }

  isCooling(marketKey: string, cycleNumber: number): boolean {
    const cooldown = this.cooldowns.get(marketKey);
    if (!cooldown) return false;

    if (cycleNumber > cooldown.cooldownUntilCycle) {
      this.cooldowns.delete(marketKey);
      return false;
    }

    return true;
  }

  getActiveCooldowns(cycleNumber: number): ActiveBookmakerCooldown[] {
    this.pruneExpired(cycleNumber);

    return Array.from(this.cooldowns.values()).map((cooldown) => ({
      marketKey: cooldown.marketKey,
      cooldownUntilCycle: cooldown.cooldownUntilCycle,
      remainingCycles: Math.max(0, cooldown.cooldownUntilCycle - cycleNumber + 1),
      reasons: cooldown.reasons,
    }));
  }

  private pruneExpired(cycleNumber: number): void {
    for (const [marketKey, cooldown] of this.cooldowns) {
      if (cycleNumber > cooldown.cooldownUntilCycle) {
        this.cooldowns.delete(marketKey);
      }
    }
  }

  private detectFairValueMove(
    marketKey: string,
    match: MatchedMarket,
    observedAtMs: number,
  ): {
    previous: MarketFairValueSnapshot;
    current: MarketFairValueSnapshot;
    move: number;
  } | null {
    if (
      this.fairValueMoveThreshold <= 0 ||
      this.fairValueWindowMs <= 0
    ) {
      return null;
    }

    const current = buildFairValueSnapshot(match, observedAtMs);
    if (!current) {
      return null;
    }

    const cutoffMs = observedAtMs - this.fairValueWindowMs;
    const history = (this.fairValueHistory.get(marketKey) || []).filter(
      (snapshot) => snapshot.observedAtMs >= cutoffMs,
    );

    const previous = history[0];
    if (!previous) {
      this.fairValueHistory.set(marketKey, [current]);
      return null;
    }

    const move = computeFairValueMove(previous, current);
    if (move > this.fairValueMoveThreshold + 1e-9) {
      // Reset the baseline after a shock so one move does not retrigger every
      // cycle for the entire trailing window.
      this.fairValueHistory.set(marketKey, [current]);
      return { previous, current, move };
    }

    history.push(current);
    this.fairValueHistory.set(marketKey, history);
    return null;
  }

  private pruneFairValueHistory(observedAtMs: number): void {
    if (this.fairValueWindowMs <= 0) {
      this.fairValueHistory.clear();
      return;
    }

    const cutoffMs = observedAtMs - this.fairValueWindowMs;
    for (const [marketKey, history] of this.fairValueHistory) {
      const pruned = history.filter(
        (snapshot) => snapshot.observedAtMs >= cutoffMs,
      );
      if (pruned.length === 0) {
        this.fairValueHistory.delete(marketKey);
      } else {
        this.fairValueHistory.set(marketKey, pruned);
      }
    }
  }
}
