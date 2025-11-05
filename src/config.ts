import "dotenv/config";

export const CFG = {
  privateKey: process.env.PRIVATE_KEY!,
  clobHost: process.env.CLOB_HOST || "https://clob.polymarket.com",
  dataApi: process.env.DATA_API || "https://data-api.polymarket.com",
  gammaApi: process.env.GAMMA_API || "https://gamma-api.polymarket.com",
  rtDataHost: process.env.RT_DATA_HOST || "wss://ws-live-data.polymarket.com",
  chainId: Number(process.env.CHAIN_ID || 137),
  targetHandle: process.env.TARGET_HANDLE || "RN1",
  maxNotional: Number(process.env.MAX_NOTIONAL_USDC || 5),
  // HTTP polling as backup only - much slower interval
  pollMs: Number(process.env.POLL_INTERVAL_MS || 5000), // 5s backup poll
  tradesLimit: Number(process.env.TRADES_LIMIT || 20), // catch rapid-fire trades
  maxTradesRPS: Number(process.env.TRADES_RPS || 6.5), // <= 75 / 10s
  allowBuys: (process.env.ALLOW_BUYS || "true") === "true",
  allowSells: (process.env.ALLOW_SELLS || "false") === "true", // you said they don't sell
  strictPrice: true, // post at EXACT price, never chase
  allowPartial: true, // keep partial fills with FAK
  useProxy: (process.env.USE_PROXY || "false") === "true",
  proxyWallet: process.env.PROXY_WALLET || "", // funder
  signatureType: Number(process.env.SIGNATURE_TYPE || 0), // 2 for browser-proxy
};
