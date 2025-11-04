import { axData } from "./http.js";
import { CFG } from "./config.js";

export type TradeRow = {
  proxyWallet: string;
  side: "BUY" | "SELL";
  asset: string; // token_id for the outcome
  conditionId: string;
  outcome?: string;
  outcomeIndex?: number;
  price: number;
  size: number;
  timestamp: number;
  transactionHash: string;
  slug?: string;
  title?: string;
};

export async function getUserTrades(user: string, limit = CFG.tradesLimit) {
  const { data } = await axData.get<TradeRow[]>("/trades", {
    // IMPORTANT: takerOnly defaults to true. Turn it off to see maker fills too.
    // Docs: Query params include `takerOnly` (default true).
    // https://docs.polymarket.com/developers/CLOB/trades/trades-data-api
    params: { user, limit, takerOnly: false }, // both maker+taker
  });
  return data;
}
