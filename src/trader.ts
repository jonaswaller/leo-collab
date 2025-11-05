import { CFG } from "./config.js";
import { getConstraints, roundToTick } from "./book.js";
import { OrderType, Side } from "@polymarket/clob-client";
import { recordReq } from "./rate.js";

export type TradeInput = {
  proxyWallet: string;
  side: "BUY" | "SELL";
  asset: string; // token_id
  conditionId: string;
  price: number;
  size: number;
  timestamp: number;
  transactionHash: string;
  outcome?: string;
  outcomeIndex?: number;
  slug?: string;
  title?: string;
};

type MirrorResult = {
  ok: boolean;
  orderId?: string;
  price?: number;
  size?: number;
  filled?: number;
  reason?: string;
  intended?: { price: number; size: number };
};

export async function mirrorTrade(
  clob: any,
  t: TradeInput,
): Promise<MirrorResult> {
  if (t.side === "BUY" && !CFG.allowBuys)
    return { ok: false, reason: "buys disabled" };
  if (t.side === "SELL" && !CFG.allowSells)
    return { ok: false, reason: "sells disabled" };

  // 1) Fetch cached constraints (tick/min/neg-risk) for this token.
  const { tickSize, minOrder, negRisk } = await getConstraints(t.asset);

  // 2) Compute exact price & capped size (strict price).
  const targetPx = roundToTick(t.price, tickSize);

  // ============================================================================
  // 🧪 TESTING MODE: FIXED $1 SPEND PER TRADE
  // ============================================================================
  // This is TEMPORARY for testing latency and detection.
  //
  // Current behavior:
  // - Spends exactly $1 per trade (Polymarket minimum)
  // - Calculates shares: $1 / price
  // - Rounds down to minimum order size increments
  // - Skips if $1 doesn't meet minimum order size
  //
  // For PRODUCTION, replace with:
  //   const notional = CFG.maxNotional;
  //
  // This will use the MAX_NOTIONAL_USDC from .env (default $5)
  // ============================================================================
  const notional = 1.0; // 🧪 TESTING: $1 exactly (change to CFG.maxNotional for production)
  const rawQty = notional / Math.max(targetPx, 0.01);

  // Round size DOWN to min-order increments
  let size = Math.floor(rawQty / minOrder) * minOrder;
  let actualNotional = notional;

  if (size < minOrder) {
    // If $1 doesn't buy enough shares, use minimum order size instead
    size = minOrder;
    actualNotional = minOrder * targetPx;
    console.log(
      `[TEST MODE] $1 too small, buying minimum ${minOrder} shares @ ${targetPx} = $${actualNotional.toFixed(2)}`,
    );
  } else {
    console.log(
      `[TEST MODE] Buying ${size} shares @ ${targetPx} = $${actualNotional.toFixed(2)}`,
    );
  }

  const side = t.side === "BUY" ? Side.BUY : Side.SELL;

  try {
    // 3) Place a FAK (Fill-And-Kill) order for immediate execution
    //    Use createAndPostMarketOrder for FAK orders (market orders with immediate execution)
    recordReq("clob:post_order");

    // Calculate the dollar amount to spend (for BUY) or shares to sell (for SELL)
    const amount = side === Side.BUY ? actualNotional : size;

    const resp = await clob.createAndPostMarketOrder(
      {
        tokenID: t.asset,
        price: Number(targetPx.toFixed(6)), // Target price
        amount: Number(amount.toFixed(6)), // $ for BUY, shares for SELL
        side,
        orderType: OrderType.FAK, // Fill-And-Kill
      },
      { tickSize: tickSize.toString(), negRisk },
      OrderType.FAK,
    );

    // Check response
    if (!resp?.success && resp?.errorMsg) {
      return {
        ok: false,
        reason: resp.errorMsg,
        intended: { price: targetPx, size },
      };
    }

    const orderId: string | undefined = resp?.orderID;
    if (!orderId) {
      return {
        ok: false,
        reason: "no order ID",
        intended: { price: targetPx, size },
      };
    }

    // For FAK orders, takingAmount tells us what filled
    // takingAmount is in shares for BUY, in USDC for SELL
    const takingAmount = Number(resp?.takingAmount ?? 0);
    const makingAmount = Number(resp?.makingAmount ?? 0);

    // Calculate filled shares
    let filled = 0;
    if (side === Side.BUY) {
      // For BUY: takingAmount is shares we got
      filled = takingAmount;
    } else {
      // For SELL: makingAmount is USDC we got, divide by price to get shares sold
      filled = targetPx > 0 ? makingAmount / targetPx : 0;
    }

    if (filled > 0 && CFG.allowPartial) {
      return { ok: true, orderId, price: targetPx, size, filled };
    }
    if (filled >= size - 1e-9) {
      return { ok: true, orderId, price: targetPx, size, filled };
    }

    return {
      ok: false,
      reason: "no immediate fill",
      intended: { price: targetPx, size },
    };
  } catch (e: any) {
    const err = e?.response?.data?.error || e?.message || "unknown";
    // Log full response data once for better error visibility (allowance errors, etc.)
    if (e?.response?.data) {
      console.warn(
        "[TRADER] Full error response:",
        JSON.stringify(e.response.data),
      );
    }
    // Typical server messages include NOT_ENOUGH_BALANCE/ALLOWANCE, INVALID_ORDER_MIN_TICK_SIZE, etc.
    return { ok: false, reason: err, intended: { price: targetPx, size } };
  }
}
