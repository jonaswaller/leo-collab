import { axClob } from "./http.js";

export type BookResponse = {
  market: string; // conditionId
  asset_id: string; // token_id echoed
  min_order_size: string; // e.g. "0.01"
  tick_size: string; // e.g. "0.001"
  neg_risk: boolean;
};

export async function getBook(tokenId: string) {
  const { data } = await axClob.get<BookResponse>("/book", {
    params: { token_id: tokenId },
  });
  return {
    tickSize: Number(data.tick_size),
    minOrder: Number(data.min_order_size),
    negRisk: Boolean(data.neg_risk),
  };
}

export function roundToTick(px: number, tick: number) {
  return Math.round(px / tick) * tick;
}
