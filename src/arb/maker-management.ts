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
   * For some cancelled orders, we may want to place a replacement order
   * using a fresh MakerOpportunity (e.g., we were outbid but still EV+).
   */
  replacementMakers: {
    oldOrderId: string;
    opportunity: MakerOpportunity;
  }[];

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

export type MakerOrderAction =
  | "keep"
  | "cancel"
  | "cancel_and_replace"
  | "cleanup";

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
 *
 * Returns a set of decisions. The caller should:
 * - Cancel orders in cancelOrderIds
 * - Optionally place replacement makers for replacementMakers
 */
export function evaluateMakerOrders(
  currentMakers: MakerOpportunity[],
  openOrders: OpenOrder[],
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
  const replacementMakers: {
    oldOrderId: string;
    opportunity: MakerOpportunity;
  }[] = [];
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
    const currentBid = currentOpp.currentBid ?? openPrice;
    const tickSize = currentOpp.tickSize;

    const outbidBy = currentBid - openPrice;
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

    const reasons: string[] = [];
    let action: MakerOrderAction = "keep";

    // If EV is too low or has deteriorated significantly, cancel.
    if (evTooLow) {
      cancelOrderIds.push(trackedOrder.orderId);
      action = "cancel";
      reasons.push(
        `EV ${currentEV.toFixed(4)} < minEV ${minEV.toFixed(4)} for market type.`,
      );
    } else if (evDroppedTooMuch) {
      cancelOrderIds.push(trackedOrder.orderId);
      action = "cancel";
      reasons.push(
        `EV dropped by ${evDrop.toFixed(4)} vs placement (threshold -${MAKER_EVAL_EV_DROP.toFixed(4)}).`,
      );
    }

    // If someone has outbid us by at least one tick AND EV is still good,
    // we want to cancel and consider reposting at the new target price.
    if (!evTooLow && !evDroppedTooMuch && outbidByAtLeastOneTick) {
      cancelOrderIds.push(trackedOrder.orderId);
      action = "cancel_and_replace";
      reasons.push(
        `Outbid by at least one tick (currentBid ${currentBid.toFixed(4)} vs our ${openPrice.toFixed(4)}).`,
      );

      // Only consider a replacement if the analyzer still likes this market.
      if (currentEV >= minEV) {
        replacementMakers.push({
          oldOrderId: trackedOrder.orderId,
          opportunity: currentOpp,
        });
      }
    }

    if (action === "keep") {
      reasons.push(
        `EV ${currentEV.toFixed(4)} >= minEV ${minEV.toFixed(
          4,
        )} and EV drop ${evDrop.toFixed(4)} within tolerance; not outbid by >= 1 tick.`,
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
    replacementMakers,
    cleanedUpOrderIds,
    details,
  };
}
