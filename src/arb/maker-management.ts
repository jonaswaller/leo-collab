/**
 * Maker order evaluation (Phase 4, v1).
 *
 * This module does NOT talk to the CLOB directly. Instead, it:
 * - Looks at currently tracked maker orders + current maker opportunities
 * - Decides which orders should be cancelled and which should be reposted
 *
 * The caller is responsible for:
 * - Actually cancelling orders via the CLOB client
 * - Placing new maker orders using placeMakerOrder()
 */

import { OpenOrder } from "@polymarket/clob-client";
import { MakerOpportunity } from "./types.js";
import type { BestPrices } from "./orderbook.js";
import {
  TrackedMakerOrder,
  getTrackedMakerOrders,
  removeMakerOrder,
} from "./maker-registry.js";
import { MAKER_MARGINS, MAKER_EVAL_EV_DROP } from "./config.js";

export interface MakerEvaluationDecision {
  /**
   * Order IDs that should be cancelled on the CLOB.
   */
  cancelOrderIds: string[];

  /**
   * Tracked maker orders that are no longer live on the CLOB (matched/cancelled).
   * These are removed from the registry as part of evaluation.
   */
  cleanedUpOrderIds: string[];

  /**
   * Per-order debug information explaining the decision.
   */
  details: MakerOrderDecisionDetail[];
}

export type MakerOrderAction = "keep" | "cancel" | "cleanup";

export interface MakerOrderDecisionDetail {
  orderId: string;
  tokenId: string;
  marketSlug: string;
  eventSlug: string;
  outcome: 1 | 2;
  currentEV: number | null;
  evAtPlacement: number;
  minEV: number;
  evDrop: number;
  outbidBy: number;
  outbidByAtLeastOneTick: boolean;
  action: MakerOrderAction;
  reasons: string[];
}

/**
 * Evaluate currently tracked maker orders against:
 * - Current live open orders (from CLOB)
 * - Current maker opportunities (from analyzer)
 * - Optional live best bid prices from the CLOB orderbook
 *
 * Returns a set of decisions. The caller should:
 * - Cancel orders in cancelOrderIds
 * - Remove cleanedUpOrderIds from any external tracking
 *
 * NOTE: v1 keeps evaluation and placement separate. This function never
 * posts new orders; it only decides which existing makers to KEEP or CANCEL
 * based on maker-taker-rules.md. New/updated maker orders should be placed
 * in a separate phase using fresh MakerOpportunity[] from the analyzer.
 */
export function evaluateMakerOrders(
  currentMakers: MakerOpportunity[],
  openOrders: OpenOrder[],
  liveBestPrices?: Map<string, BestPrices>,
): MakerEvaluationDecision {
  const tracked = getTrackedMakerOrders();

  const openById = new Map<string, OpenOrder>();
  for (const o of openOrders) {
    openById.set(o.id, o);
  }

  const makersByToken = new Map<string, MakerOpportunity>();
  for (const m of currentMakers) {
    makersByToken.set(m.tokenId, m);
  }

  const cancelOrderIds: string[] = [];
  const cleanedUpOrderIds: string[] = [];
  const details: MakerOrderDecisionDetail[] = [];

  for (const trackedOrder of tracked) {
    const open = openById.get(trackedOrder.orderId);

    // If the order is no longer open on the CLOB, drop it from registry.
    if (!open) {
      removeMakerOrder(trackedOrder.orderId);
      cleanedUpOrderIds.push(trackedOrder.orderId);

      details.push({
        orderId: trackedOrder.orderId,
        tokenId: trackedOrder.tokenId,
        marketSlug: trackedOrder.marketSlug,
        eventSlug: trackedOrder.eventSlug,
        outcome: trackedOrder.outcome,
        currentEV: null,
        evAtPlacement: trackedOrder.evAtPlacement,
        minEV: 0,
        evDrop: 0,
        outbidBy: 0,
        outbidByAtLeastOneTick: false,
        action: "cleanup",
        reasons: ["Order no longer open on CLOB (matched or cancelled)."],
      });
      continue;
    }

    const currentOpp = makersByToken.get(trackedOrder.tokenId);

    // If analyzer no longer sees a maker opportunity for this token,
    // treat it as EV below thresholds and cancel.
    if (!currentOpp) {
      cancelOrderIds.push(trackedOrder.orderId);
      details.push({
        orderId: trackedOrder.orderId,
        tokenId: trackedOrder.tokenId,
        marketSlug: trackedOrder.marketSlug,
        eventSlug: trackedOrder.eventSlug,
        outcome: trackedOrder.outcome,
        currentEV: null,
        evAtPlacement: trackedOrder.evAtPlacement,
        minEV: 0,
        evDrop: 0,
        outbidBy: 0,
        outbidByAtLeastOneTick: false,
        action: "cancel",
        reasons: [
          "No current MakerOpportunity for this tokenId (out of model).",
        ],
      });
      continue;
    }

    const currentEV = currentOpp.ev;
    const evAtPlacement = trackedOrder.evAtPlacement;

    const openPrice = parseFloat(open.price);
    const tickSize = currentOpp.tickSize;

    // Prefer live best bid from the CLOB orderbook; fall back to analyzer/Gamma.
    const live = liveBestPrices?.get(trackedOrder.tokenId);
    const bestBidSource =
      live && live.bestBid !== null && Number.isFinite(live.bestBid)
        ? live.bestBid
        : (currentOpp.currentBid ?? openPrice);

    const outbidBy = bestBidSource - openPrice;
    const outbidByAtLeastOneTick = tickSize > 0 && outbidBy >= tickSize - 1e-9;

    // Minimum EV is market-type specific, based on MAKER_MARGINS config
    const marketKey = currentOpp.isFirstHalf
      ? `${currentOpp.marketType}_h1`
      : currentOpp.marketType;
    const minEV =
      MAKER_MARGINS[marketKey]?.min ??
      MAKER_MARGINS[currentOpp.marketType]?.min ??
      0.03;

    const evTooLow = currentEV < minEV;
    const evDroppedTooMuch = currentEV < evAtPlacement - MAKER_EVAL_EV_DROP;
    const evDrop = currentEV - evAtPlacement;

    // Kelly / partial-fill handling:
    // We treat an order as "fully satisfied" for the current cycle when the
    // filled shares meet or exceed the *current* Kelly target. In that case,
    // we cancel any remaining live size even if EV is still attractive.
    const currentKellyTarget = currentOpp.kellySize.constrainedShares;
    const filledShares = parseFloat(open.size_matched || "0");
    const fullySatisfied =
      Number.isFinite(currentKellyTarget) &&
      currentKellyTarget > 0 &&
      filledShares >= currentKellyTarget - 1e-8;

    const reasons: string[] = [];
    let action: MakerOrderAction = "keep";

    if (fullySatisfied) {
      cancelOrderIds.push(trackedOrder.orderId);
      action = "cancel";
      reasons.push(
        `Filled shares ${filledShares.toFixed(
          4,
        )} >= current Kelly target ${currentKellyTarget.toFixed(
          4,
        )}; cancelling remaining live size.`,
      );
    } else if (outbidByAtLeastOneTick) {
      // Outbid by >= 1 tick: always cancel stale order.
      cancelOrderIds.push(trackedOrder.orderId);
      action = "cancel";
      if (evTooLow) {
        reasons.push(
          `Outbid by at least one tick (bestBid ${bestBidSource.toFixed(
            4,
          )} vs our ${openPrice.toFixed(4)}) and EV ${currentEV.toFixed(
            4,
          )} < minEV ${minEV.toFixed(4)}; cancelling.`,
        );
      } else {
        reasons.push(
          `Outbid by at least one tick (bestBid ${bestBidSource.toFixed(
            4,
          )} vs our ${openPrice.toFixed(
            4,
          )}); cancelling. Any new maker order will be decided by the next analyzer cycle.`,
        );
      }
    } else if (evTooLow) {
      // Not outbid, but EV has fallen below our per-market-type minimum.
      cancelOrderIds.push(trackedOrder.orderId);
      action = "cancel";
      reasons.push(
        `EV ${currentEV.toFixed(4)} < minEV ${minEV.toFixed(
          4,
        )} for market type; cancelling.`,
      );
    } else if (evDroppedTooMuch) {
      // Not outbid, EV still >= minEV but has deteriorated by more than our
      // allowed drop; cancel and let the next cycle decide whether to repost.
      cancelOrderIds.push(trackedOrder.orderId);
      action = "cancel";
      reasons.push(
        `EV dropped by ${evDrop.toFixed(
          4,
        )} vs placement (threshold -${MAKER_EVAL_EV_DROP.toFixed(
          4,
        )}); cancelling.`,
      );
    } else {
      // Keep: EV is acceptable, EV drop within tolerance, not outbid, and not
      // yet fully satisfied vs current Kelly target.
      action = "keep";
      reasons.push(
        `EV ${currentEV.toFixed(4)} >= minEV ${minEV.toFixed(
          4,
        )}, EV drop ${evDrop.toFixed(
          4,
        )} within tolerance, not outbid by >= 1 tick, and filled shares ${filledShares.toFixed(
          4,
        )} < Kelly target ${currentKellyTarget.toFixed(4)}; keeping order live.`,
      );
    }

    details.push({
      orderId: trackedOrder.orderId,
      tokenId: trackedOrder.tokenId,
      marketSlug: trackedOrder.marketSlug,
      eventSlug: trackedOrder.eventSlug,
      outcome: trackedOrder.outcome,
      currentEV,
      evAtPlacement,
      minEV,
      evDrop,
      outbidBy,
      outbidByAtLeastOneTick,
      action,
      reasons,
    });
  }

  return {
    cancelOrderIds,
    cleanedUpOrderIds,
    details,
  };
}
