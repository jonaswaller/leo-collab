/**
 * Order execution helpers for Phase 3 (taker + maker).
 *
 * These are thin wrappers around the Polymarket CLOB client that:
 * - Translate our TakerOpportunity / MakerOpportunity into user-level orders
 * - Enforce "limit-only" behaviour (no slippage)
 * - Default to dry-run so we can test safely
 */

import { Side, OrderType } from "@polymarket/clob-client";
import { getClobClient } from "./clob.js";
import { TakerOpportunity, MakerOpportunity } from "./types.js";

export interface ExecutionOptions {
  /**
   * If true, build the order but do NOT post it to the CLOB.
   * Default: true (safe by default).
   */
  dryRun?: boolean;
}

export interface ExecutionPreview {
  tokenID: string;
  side: Side;
  price: number;
  size: number;
  orderType: OrderType;
}

export interface ExecutionResult {
  filled: boolean;
  orderId?: string | undefined;
  /**
   * Raw response from CLOB, if we actually posted.
   */
  response?: any | undefined;
  /**
   * Preview of the order we attempted / would attempt.
   */
  preview: ExecutionPreview;
}

/**
 * Execute a taker opportunity as a limit FAK (Fill-And-Kill / IOC) order.
 *
 * We:
 * - Use the Polymarket ask price as the limit (or tighter)
 * - Use Kelly-constrained size, respecting minOrderSize
 * - Attempt to fill immediately as much size as is available at or better
 *   than our limit; any unfilled remainder is cancelled and does not rest
 *   on the book (no slippage, partial fills allowed).
 * - Default to dryRun = true for safety
 */
export async function executeTakerOrder(
  opp: TakerOpportunity,
  options?: ExecutionOptions,
): Promise<ExecutionResult> {
  const dryRun = options?.dryRun !== false; // default true

  const client = await getClobClient();

  // Use Kelly shares, but never below market minimum order size.
  const rawKellyShares = opp.kellySize.constrainedShares;

  // Simplify to whole number shares for robustness, while respecting minOrderSize.
  const size = Math.max(opp.minOrderSize, Math.floor(rawKellyShares));

  const price = Number(opp.polymarketAsk.toFixed(2)); // ensure max 2dp price accuracy for CLOB limit orders
  const side = Side.BUY; // TakerOpportunity is always hitting the ask (buying)
  const orderType = OrderType.FAK; // Fill-And-Kill (IOC): partial fills OK, remainder cancelled

  const preview: ExecutionPreview = {
    tokenID: opp.tokenId,
    side,
    price,
    size,
    orderType,
  };

  if (dryRun) {
    return {
      filled: false,
      preview,
    };
  }

  const userOrder = {
    tokenID: opp.tokenId,
    price,
    size,
    side,
  };

  const signedOrder = await client.createOrder(userOrder);
  const resp = await client.postOrder(signedOrder, orderType);

  const status: string | undefined = resp?.status;
  const orderId: string | undefined =
    resp?.orderID || resp?.orderId || resp?.id;

  const filled =
    status === "MATCHED" ||
    status === "FILLED" ||
    status === "COMPLETED" ||
    resp?.success === true;

  return {
    filled,
    orderId,
    response: resp,
    preview,
  };
}

/**
 * Place a maker (limit) order for a MakerOpportunity.
 *
 * We:
 * - Post a GTC bid at the targetPrice from the analyzer
 * - Use Kelly-constrained size, respecting minOrderSize
 * - Default to dryRun = true for safety
 */
export async function placeMakerOrder(
  opp: MakerOpportunity,
  options?: ExecutionOptions,
): Promise<ExecutionResult> {
  const dryRun = options?.dryRun !== false; // default true

  const client = await getClobClient();

  const rawKellyShares = opp.kellySize.constrainedShares;
  const size = Math.max(
    opp.minOrderSize,
    Math.floor(rawKellyShares * 100) / 100,
  ); // round down to 2dp

  const price = opp.targetPrice;
  const side = Side.BUY; // MakerOpportunity is currently defined for bid-side liquidity
  const orderType = OrderType.GTC;

  const preview: ExecutionPreview = {
    tokenID: opp.tokenId,
    side,
    price,
    size,
    orderType,
  };

  if (dryRun) {
    return {
      filled: false,
      preview,
    };
  }

  const userOrder = {
    tokenID: opp.tokenId,
    price,
    size,
    side,
  };

  const signedOrder = await client.createOrder(userOrder);
  const resp = await client.postOrder(signedOrder, orderType);

  const status: string | undefined = resp?.status;
  const orderId: string | undefined =
    resp?.orderID || resp?.orderId || resp?.id;

  const filled =
    status === "MATCHED" ||
    status === "FILLED" ||
    status === "COMPLETED" ||
    resp?.success === true;

  return {
    filled,
    orderId,
    response: resp,
    preview,
  };
}
