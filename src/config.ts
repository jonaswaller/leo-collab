import "dotenv/config";

export const CFG = {
  privateKey: process.env.PRIVATE_KEY!,
  clobHost: process.env.CLOB_HOST || "https://clob.polymarket.com",
  dataApi: process.env.DATA_API || "https://data-api.polymarket.com",
  gammaApi: process.env.GAMMA_API || "https://gamma-api.polymarket.com",
  chainId: Number(process.env.CHAIN_ID || 137),
  targetHandle: process.env.TARGET_HANDLE || "RN1",
  maxNotional: Number(process.env.MAX_NOTIONAL_USDC || 5),
  pollMs: Number(process.env.POLL_INTERVAL_MS || 160), // lower base interval
  pollJitterMs: Number(process.env.POLL_JITTER_MS || 12), // ± jitter
  tradesLimit: Number(process.env.TRADES_LIMIT || 3), // tiny payload
  maxTradesRPS: Number(process.env.TRADES_RPS || 6.5), // <= 75 / 10s
  allowBuys: (process.env.ALLOW_BUYS || "true") === "true",
  allowSells: (process.env.ALLOW_SELLS || "true") === "true",
  strictPrice: true, // post at EXACT price, never chase
  cancelMs: 1000, // 1s window to fill, then cancel immediately
  allowPartial: true, // keep partial fills, cancel remainder
};
