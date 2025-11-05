import { CFG } from "./config.js";
import { getConstraints, roundToTick } from "./book.js";
import type { TradeRow } from "./data.js";
import { OrderType, Side } from "@polymarket/clob-client";
import { recordReq } from "./rate.js";

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
  t: TradeRow,
): Promise<MirrorResult> {
  if (t.side === "BUY" && !CFG.allowBuys)
    return { ok: false, reason: "buys disabled" };
  if (t.side === "SELL" && !CFG.allowSells)
    return { ok: false, reason: "sells disabled" };

  // 1) Fetch cached constraints (tick/min/neg-risk) for this token.
  const { tickSize, minOrder, negRisk } = await getConstraints(t.asset);

  // 2) Compute exact price & capped size (strict price).
  const targetPx = roundToTick(t.price, tickSize);
  const notional = CFG.maxNotional;
  const rawQty = notional / Math.max(targetPx, 0.01);

  // round size DOWN to min-order increments
  const size = Math.floor(rawQty / minOrder) * minOrder;
  if (size < minOrder)
    return { ok: false, reason: "min-order", intended: { price: targetPx, size } };

  const side = t.side === "BUY" ? Side.BUY : Side.SELL;

  try {
    // 3) Place a FAK (Fill-And-Kill) order for immediate execution
    //    This is IOC semantics: fill whatever's immediately available, cancel the rest
    recordReq("clob:post_order");
    const resp = await clob.createAndPostOrder(
      {
        tokenID: t.asset,
        price: Number(targetPx.toFixed(6)),
        size: Number(size.toFixed(6)),
        side,
      },
      { tickSize: tickSize.toString(), negRisk },
      OrderType.FAK, // <<< immediate-or-cancel semantics
    );

    const orderId: string | undefined = resp?.orderID ?? resp?.id;
    if (!orderId) {
      // If server rejected immediately, bubble reason if present.
      const reason = resp?.errorMsg || "order rejected";
      return { ok: false, reason, intended: { price: targetPx, size } };
    }

    // With FAK, the remainder is already canceled by the exchange
    // sizeMatched tells us what filled immediately
    // If not present in response, fetch order status once
    let filled = Number(resp?.sizeMatched ?? 0);
    if (!resp?.sizeMatched && orderId) {
      try {
        recordReq("clob:get_orders");
        const ord = await clob.getOrder(orderId);
        filled = Number(ord?.order?.size_matched ?? ord?.size_matched ?? 0);
      } catch {
        // If getOrder fails, assume no fill
        filled = 0;
      }
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
