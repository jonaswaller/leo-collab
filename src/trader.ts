import { CFG } from "./config.js";
import { getBook, roundToTick } from "./book.js";
import type { TradeRow } from "./data.js";
import { OrderType, Side } from "@polymarket/clob-client";
import { recordReq } from "./rate.js";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

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

  // 1) Fetch book constraints (tick/min/neg-risk) for this token.
  const { tickSize, minOrder, negRisk } = await getBook(t.asset);

  // 2) Compute exact price & capped size (strict price).
  const price = roundToTick(t.price, tickSize);
  const notional = Math.min(CFG.maxNotional, 5); // extra guard, per your $5 test budget
  const rawQty = notional / price;

  // round size DOWN to min-order increments
  const size = Math.floor(rawQty / minOrder) * minOrder;
  if (size < minOrder)
    return { ok: false, reason: "min-order", intended: { price, size } };

  const side = t.side === "BUY" ? Side.BUY : Side.SELL;

  try {
    // 3) Place a GTC limit at EXACT price (strict). If the book moved, it will rest briefly.
    recordReq("clob:post_order");
    const resp = await clob.createAndPostOrder(
      {
        tokenID: t.asset,
        price: Number(price.toFixed(6)),
        size: Number(size.toFixed(6)),
        side,
      },
      { tickSize: tickSize.toString(), negRisk },
      OrderType.GTC,
    );

    const orderId: string | undefined = resp?.orderID ?? resp?.id;
    if (!orderId) {
      // If server rejected immediately, bubble reason if present.
      const reason = resp?.errorMsg || "order rejected";
      return { ok: false, reason, intended: { price, size } };
    }

    // 4) Wait up to cancelMs for a fill (emulates IOC/FAK behavior without slippage).
    await sleep(CFG.cancelMs);

    // 5) Check the order status / matched size
    //    (Get Order returns size_matched, status, etc.)
    //    https://docs.polymarket.com/developers/CLOB/orders/get-order
    let filled = 0;
    try {
      recordReq("clob:get_orders");
      const ord = await clob.getOrder(orderId);
      const sm = Number(ord?.order?.size_matched ?? ord?.size_matched ?? 0);
      filled = Number.isFinite(sm) ? sm : 0;
    } catch {
      // If getOrder hiccups, continue to cancel; matcher will have a canonical view.
    }

    // 6) If fully filled: done. If partially or not filled: cancel remainder.
    if (filled >= size - 1e-9) {
      return { ok: true, orderId, price, size, filled };
    }

    try {
      // Cancel by ID (DELETE /order with orderID).
      // https://docs.polymarket.com/developers/CLOB/orders/cancel-orders
      recordReq("clob:delete_order");
      await clob.cancel(orderId);
    } catch (e: any) {
      // If cancel fails (already filled/canceled), we'll re-query once to compute final fill.
    }

    // Re-check to report final filled amount after cancel attempt.
    try {
      recordReq("clob:get_orders");
      const ord2 = await clob.getOrder(orderId);
      const sm2 = Number(ord2?.order?.size_matched ?? ord2?.size_matched ?? 0);
      filled = Number.isFinite(sm2) ? sm2 : filled;
    } catch {}

    if (filled > 0 && CFG.allowPartial) {
      return { ok: true, orderId, price, size, filled };
    }
    return {
      ok: false,
      reason: "no fill within window",
      intended: { price, size },
    };
  } catch (e: any) {
    const err = e?.response?.data?.error || e?.message || "unknown";
    // Typical server messages include NOT_ENOUGH_BALANCE/ALLOWANCE, INVALID_ORDER_MIN_TICK_SIZE, etc.
    // https://docs.polymarket.com/developers/CLOB/orders/create-order
    return { ok: false, reason: err, intended: { price, size } };
  }
}
