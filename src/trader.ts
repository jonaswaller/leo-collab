import { CFG } from './config.js';
import { getBook, roundToTick } from './book.js';
import type { TradeRow } from './data.js';
import { OrderType, Side } from '@polymarket/clob-client';

export async function mirrorTrade(clob: any, t: TradeRow) {
  if (t.side === 'BUY' && !CFG.allowBuys) return { ok: false, reason: 'buys disabled' };
  if (t.side === 'SELL' && !CFG.allowSells) return { ok: false, reason: 'sells disabled' };

  const { tickSize, minOrder, negRisk } = await getBook(t.asset);

  const notional = Math.min(CFG.maxNotional, 5);
  const rawQty = notional / t.price;

  const qty = Math.floor(rawQty / minOrder) * minOrder;
  if (qty < minOrder) {
    return { ok: false, reason: 'min-order', intended: { price: t.price, size: qty } };
  }

  const px = roundToTick(t.price, tickSize);
  const side = t.side === 'BUY' ? Side.BUY : Side.SELL;

  try {
    const resp = await clob.createAndPostOrder(
      { tokenID: t.asset, price: Number(px.toFixed(6)), size: Number(qty.toFixed(6)), side },
      { tickSize: tickSize.toString(), negRisk },
      OrderType.GTC,
    );
    return { ok: true, orderId: resp?.orderID ?? resp?.id, price: px, size: qty };
  } catch (e: any) {
    const err = e?.response?.data?.error || e?.message || 'unknown';
    return { ok: false, reason: err, intended: { price: px, size: qty } };
  }
}
