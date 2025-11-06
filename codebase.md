# Codebase

## src/book.ts

```typescript
import { axClob } from "./http.js";

export type BookResponse = {
  market: string; // conditionId
  asset_id: string; // token_id echoed
  min_order_size: string; // e.g. "0.01"
  tick_size: string; // e.g. "0.001"
  neg_risk: boolean;
};

// Constraint cache to avoid /book calls on hot path
const cache = new Map<
  string,
  { tickSize: number; minOrder: number; negRisk: boolean; t: number }
>();
const TTL_MS = 60_000; // 1 minute cache

export async function getConstraints(tokenId: string) {
  const hit = cache.get(tokenId);
  const now = Date.now();
  if (hit && now - hit.t < TTL_MS) return hit;

  const fresh = await getBook(tokenId);
  const val = { ...fresh, t: now };
  cache.set(tokenId, val);
  return val;
}

// Update cache when tick size changes (called from WebSocket handler)
export function updateTickSize(tokenId: string, newTickSize: number) {
  const hit = cache.get(tokenId);
  if (hit) {
    hit.tickSize = newTickSize;
    hit.t = Date.now(); // Refresh timestamp
    console.log(`[CACHE] Updated tick size for ${tokenId}: ${newTickSize}`);
  }
}

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
```

## src/clients.ts

```typescript
import { CFG } from "./config.js";
import { ethers } from "ethers";
import { ClobClient } from "@polymarket/clob-client";

export async function makeClobClient() {
  const provider = new ethers.providers.JsonRpcProvider(
    "https://polygon-rpc.com",
    CFG.chainId,
  );
  const wallet = new ethers.Wallet(CFG.privateKey, provider);

  // Derive or create API key once with a bare client
  let creds: any | undefined;
  try {
    creds = await new ClobClient(
      CFG.clobHost,
      CFG.chainId,
      wallet,
    ).createOrDeriveApiKey?.();
  } catch (e: any) {
    console.warn(
      "[CLOB] createOrDeriveApiKey failed (will try derive/create separately)",
      e?.response?.data || e,
    );
  }

  // Fall back to explicit derive/create paths if needed
  if (!creds) {
    try {
      creds = await new ClobClient(
        CFG.clobHost,
        CFG.chainId,
        wallet,
      ).deriveApiKey?.();
    } catch {}
  }
  if (!creds) {
    try {
      creds = await new ClobClient(
        CFG.clobHost,
        CFG.chainId,
        wallet,
      ).createApiKey?.();
    } catch (e: any) {
      console.warn("[CLOB] createApiKey failed", e?.response?.data || e);
    }
  }

  // 🚨 Hard-fail: you cannot place/cancel orders without API creds
  if (!creds) {
    throw new Error(
      "Could not create/derive API credentials. Check PRIVATE_KEY (0x-hex), system clock, and PROXY_WALLET for proxy mode.",
    );
  }

  // IMPORTANT: pass signatureType + funder when using a proxy
  const signatureType = CFG.useProxy ? CFG.signatureType : 0;
  const funder = CFG.useProxy ? CFG.proxyWallet : undefined;

  const client = new ClobClient(
    CFG.clobHost,
    CFG.chainId,
    wallet,
    creds,
    signatureType,
    funder,
  );

  return { client, wallet };
}
```

## src/config.ts

```typescript
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
```

## src/data.ts

```typescript
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
```

## src/gamma.ts

```typescript
import { axGamma } from "./http.js";

export type GammaMarket = {
  id: string;
  conditionId: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
  enableOrderBook?: boolean;
  acceptingOrders?: boolean;
  outcomes?: string; // stringified JSON
  shortOutcomes?: string; // stringified JSON
  clobTokenIds?: string; // stringified JSON array, order matches outcomes
};

export async function resolveHandleToProxyWallet(
  handle: string,
): Promise<string> {
  // If it's already a wallet address (starts with 0x and is 42 chars), return it
  if (handle.startsWith("0x") && handle.length === 42) {
    return handle.toLowerCase();
  }

  // Try direct profile lookup
  try {
    const cleanHandle = handle.replace("@", "");
    const { data } = await axGamma.get(`/profile/${cleanHandle}`);
    if (data?.proxyWallet) {
      console.log(`Found profile ${cleanHandle}: ${data.proxyWallet}`);
      return data.proxyWallet;
    }
  } catch (e: any) {
    console.log("Direct profile lookup failed, trying search...");
  }

  // Fall back to search
  const { data } = await axGamma.get("/public-search", {
    params: { q: handle },
  });
  const profiles = (data?.profiles ?? []) as any[];
  const match = profiles.find(
    (p) => (p.pseudonym || "").toLowerCase() === handle.toLowerCase(),
  );
  const wallet = (match || profiles[0])?.proxyWallet;
  if (!wallet)
    throw new Error(
      `No proxyWallet found for ${handle}. Try using the wallet address directly in TARGET_HANDLE.`,
    );
  return wallet as string;
}

export async function getMarketByCondition(
  conditionId: string,
): Promise<GammaMarket | null> {
  const { data } = await axGamma.get("/markets", {
    params: { condition_ids: conditionId, limit: 1 },
  });
  return Array.isArray(data) && data.length > 0
    ? (data[0] as GammaMarket)
    : null;
}

export function pickTokenId(
  m: GammaMarket,
  outcomeIndex: number,
): string | null {
  try {
    const arr = JSON.parse(m.clobTokenIds || "[]") as string[];
    return arr[outcomeIndex] ?? null;
  } catch {
    return null;
  }
}
```

## src/http.ts

```typescript
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import http from "http";
import https from "https";
import { recordReq, recordResp } from "./rate.js";

const common = {
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 64 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 64 }),
  timeout: 2000, // keep short for low latency
};

export const axData = axios.create({
  ...common,
  baseURL: "https://data-api.polymarket.com",
});
export const axClob = axios.create({
  ...common,
  baseURL: "https://clob.polymarket.com",
});
export const axGamma = axios.create({
  ...common,
  baseURL: "https://gamma-api.polymarket.com",
});

// --- classify endpoints into buckets for rate accounting ---
function bucketFrom(config: AxiosRequestConfig): string {
  const base = (config.baseURL || "") + (config.url || "");
  const method = (config.method || "get").toUpperCase();
  // Data-API
  if (base.includes("data-api.polymarket.com/trades")) return "data:/trades";
  if (base.includes("data-api.polymarket.com")) return "data:general";
  // CLOB
  if (base.includes("clob.polymarket.com/order") && method === "POST")
    return "clob:post_order";
  if (base.includes("clob.polymarket.com/order") && method === "DELETE")
    return "clob:delete_order";
  if (base.includes("clob.polymarket.com/data/orders"))
    return "clob:get_orders";
  if (base.includes("clob.polymarket.com/data/trades"))
    return "clob:get_trades";
  if (base.includes("clob.polymarket.com/book")) return "clob:/book";
  return base.includes("clob.polymarket.com") ? "clob:general" : "other";
}

// --- attach interceptors to count requests + results ---
for (const inst of [axData, axClob, axGamma]) {
  inst.interceptors.request.use((cfg) => {
    recordReq(bucketFrom(cfg));
    return cfg;
  });
  inst.interceptors.response.use(
    (resp: AxiosResponse) => {
      recordResp(bucketFrom(resp.config), resp.status);
      return resp;
    },
    (err) => {
      const cfg = err?.config;
      recordResp(cfg ? bucketFrom(cfg) : "unknown", err?.response?.status || 0);
      return Promise.reject(err);
    },
  );
}
```

## src/index.ts

```typescript
import { CFG } from "./config.js";
import { makeClobClient } from "./clients.js";
import { resolveHandleToProxyWallet } from "./gamma.js";
import { getUserTrades } from "./data.js";
import { mirrorTrade, TradeInput } from "./trader.js";
import { printTradeCard, printMirrorLine, timeAgo } from "./logger.js";
import { printRateStatus } from "./rate.js";
import {
  PolymarketRealTimeClient,
  ActivityTrade,
  ConnectionStatus,
} from "./realtime.js";

(async () => {
  const { client } = await makeClobClient();

  const target = CFG.targetHandle;
  const targetWallet = await resolveHandleToProxyWallet(target);
  console.log(`\n🎯 Following ${target} at ${targetWallet}`);
  console.log(`💰 Max notional per trade: $${CFG.maxNotional}`);
  console.log(
    `📊 Buys: ${CFG.allowBuys ? "✅" : "❌"} | Sells: ${CFG.allowSells ? "✅" : "❌"}\n`,
  );

  const seen = new Set<string>();
  let watermark = Math.floor(Date.now() / 1000) - 2; // start ~now, allow tiny skew

  // Stats tracking
  let wsTradeCount = 0;
  let httpTradeCount = 0;
  let mirrorSuccessCount = 0;
  let mirrorFailCount = 0;

  // Initialize real-time WebSocket client (PRIMARY detection method)
  const rtClient = new PolymarketRealTimeClient(targetWallet);

  rtClient.onStatus((status: ConnectionStatus) => {
    if (status === ConnectionStatus.CONNECTED) {
      console.log(
        "✅ Real-time WebSocket connected - ultra-low latency mode active",
      );
    } else if (status === ConnectionStatus.DISCONNECTED) {
      console.warn(
        "⚠️  Real-time WebSocket disconnected - falling back to HTTP polling",
      );
    }
  });

  rtClient.onTrade(async (trade: ActivityTrade) => {
    wsTradeCount++;

    // Deduplication key
    const tradeKey = `${trade.transactionHash}`;
    if (seen.has(tradeKey)) {
      return; // Already processed
    }
    seen.add(tradeKey);

    // Update watermark
    watermark = Math.max(watermark, trade.timestamp);

    // Print trade card
    const marketName = trade.title || trade.slug || trade.conditionId;
    const shares = trade.size;
    const usd = shares * trade.price;
    printTradeCard({
      side: trade.side,
      market: marketName,
      outcome:
        trade.outcome ??
        (typeof trade.outcomeIndex === "number"
          ? `Outcome ${trade.outcomeIndex}`
          : "Outcome"),
      price: trade.price,
      shares,
      usd,
      when: timeAgo(trade.timestamp),
      ...(trade.slug && { slug: trade.slug }),
    });

    // Convert to TradeInput and mirror
    const tradeInput: TradeInput = {
      proxyWallet: trade.proxyWallet,
      side: trade.side,
      asset: trade.asset,
      conditionId: trade.conditionId,
      price: trade.price,
      size: trade.size,
      timestamp: trade.timestamp,
      transactionHash: trade.transactionHash,
      ...(trade.outcome && { outcome: trade.outcome }),
      ...(typeof trade.outcomeIndex === "number" && {
        outcomeIndex: trade.outcomeIndex,
      }),
      ...(trade.slug && { slug: trade.slug }),
      ...(trade.title && { title: trade.title }),
    };

    const result = await mirrorTrade(client, tradeInput);
    if (result.ok) {
      mirrorSuccessCount++;
      printMirrorLine(
        true,
        trade.side,
        trade.asset,
        result.price,
        result.filled ?? result.size,
      );
    } else {
      mirrorFailCount++;
      printMirrorLine(
        false,
        trade.side,
        trade.asset,
        result.intended?.price,
        result.intended?.size,
        result.reason,
      );
    }
  });

  // Connect to real-time stream
  rtClient.connect();

  // Print rate status and stats every 10 seconds
  setInterval(() => {
    printRateStatus();
    console.log(
      `📈 Stats: WS=${wsTradeCount} HTTP=${httpTradeCount} Success=${mirrorSuccessCount} Fail=${mirrorFailCount}`,
    );
  }, 10000);

  // HTTP polling as BACKUP ONLY (every 5 seconds)
  // This catches anything the WebSocket might miss (rare)
  async function backupPoll() {
    try {
      const rows = await getUserTrades(targetWallet, CFG.tradesLimit);

      const newTrades = rows
        .slice()
        .reverse()
        .filter((t) => {
          if (t.timestamp < watermark) return false;
          if (seen.has(t.transactionHash)) return false;
          seen.add(t.transactionHash);
          watermark = Math.max(watermark, t.timestamp);
          return true;
        });

      if (newTrades.length > 0) {
        httpTradeCount += newTrades.length;
        console.log(
          `[HTTP BACKUP] Caught ${newTrades.length} trades missed by WebSocket`,
        );
      }

      // Process backup trades
      await Promise.allSettled(
        newTrades.map(async (t) => {
          const marketName = t.title || t.slug || t.conditionId;
          const shares = t.size;
          const usd = shares * t.price;
          printTradeCard({
            side: t.side,
            market: marketName,
            outcome:
              t.outcome ??
              (typeof t.outcomeIndex === "number"
                ? `Outcome ${t.outcomeIndex}`
                : "Outcome"),
            price: t.price,
            shares,
            usd,
            when: timeAgo(t.timestamp),
            ...(t.slug && { slug: t.slug }),
          });

          const result = await mirrorTrade(client, t);
          if (result.ok) {
            mirrorSuccessCount++;
            printMirrorLine(
              true,
              t.side,
              t.asset,
              result.price,
              result.filled ?? result.size,
            );
          } else {
            mirrorFailCount++;
            printMirrorLine(
              false,
              t.side,
              t.asset,
              result.intended?.price,
              result.intended?.size,
              result.reason,
            );
          }
        }),
      );

      setTimeout(backupPoll, CFG.pollMs);
    } catch (e: any) {
      const status = e?.response?.status || 0;
      const retry = status === 429 || status >= 500 ? 10000 : CFG.pollMs;
      console.warn("[HTTP BACKUP] Error:", e?.response?.data || e.message || e);
      setTimeout(backupPoll, retry);
    }
  }

  // Start backup polling
  console.log(
    `🔄 Starting backup HTTP polling (every ${CFG.pollMs / 1000}s)...`,
  );
  setTimeout(backupPoll, CFG.pollMs);

  console.log(`\n⚡ Ultra-low latency copy trading active!`);
  console.log(`📡 Primary: Real-time WebSocket (~10-50ms latency)`);
  console.log(`🔄 Backup: HTTP polling every ${CFG.pollMs / 1000}s\n`);
})();
```

## src/logger.ts

```typescript
const pad = (s: string, n: number) =>
  s.length >= n ? s : s + " ".repeat(n - s.length);
const fmtNum = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "-");
const fmtUSD = (x: number) => `$${fmtNum(x, 2)}`;

export function timeAgo(tsSec: number): string {
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - tsSec);
  if (delta < 5) return "just now";
  if (delta < 60) return `${delta}s ago`;
  const m = Math.floor(delta / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export function printTradeCard(opts: {
  side: "BUY" | "SELL";
  market: string; // e.g., "Canucks vs. Predators"
  outcome: string; // e.g., "Predators"
  price: number; // 0.63
  shares: number; // 163
  usd: number; // shares * price
  when: string; // timeAgo
  slug?: string; // e.g., "nhl-van-nsh-2025-11-03"
}) {
  const sideWord = opts.side === "BUY" ? "Buy" : "Sell";
  const priceStr = `${opts.outcome} ${fmtNum(opts.price, 2)}¢`; // keep "¢" vibe without emojis
  const sharesStr = `${fmtNum(opts.shares, 2)} shares`;
  const usdStr = fmtUSD(opts.usd);

  const title = `${sideWord} — ${opts.market}`;
  const w = Math.max(
    44,
    title.length + 4,
    priceStr.length + 4,
    sharesStr.length + 4,
    usdStr.length + 4,
    opts.slug ? opts.slug.length + 10 : 0,
  );

  const line = "─".repeat(w - 2);
  console.log(`┌${line}┐`);
  console.log(`│ ${pad(title, w - 3)}│`);
  console.log(`│ ${pad(priceStr, w - 3)}│`);
  console.log(`│ ${pad(sharesStr, w - 3)}│`);
  console.log(`│ ${pad(usdStr, w - 3)}│`);
  if (opts.slug) console.log(`│ ${pad("Market: " + opts.slug, w - 3)}│`);
  console.log(`│ ${pad(opts.when, w - 3)}│`);
  console.log(`└${line}┘`);
}

export function printMirrorLine(
  ok: boolean,
  side: string,
  tokenId: string,
  price?: number,
  size?: number,
  reason?: string,
) {
  const p = price !== undefined ? fmtNum(price, 4) : "-";
  const s = size !== undefined ? fmtNum(size, 4) : "-";
  const status = ok ? "PLACED" : "SKIP";
  const reasonStr = !ok && reason ? ` (${reason})` : "";
  console.log(
    `→ [${status}] ${pad(side, 4)} token=${tokenId} size=${s} price=${p}${reasonStr}`,
  );
}
```

## src/poll.ts

```typescript
import { CFG } from "./config.js";

export class TokenBucket {
  private capacity: number;
  private tokens: number;
  private refillPerMs: number;
  private last = Date.now();

  constructor(tokensPerSecond: number, burstSeconds = 1.0) {
    this.capacity = tokensPerSecond * burstSeconds;
    this.tokens = this.capacity;
    this.refillPerMs = tokensPerSecond / 1000;
  }
  take(cost = 1): boolean {
    const now = Date.now();
    const dt = now - this.last;
    this.last = now;
    this.tokens = Math.min(this.capacity, this.tokens + dt * this.refillPerMs);
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }
}

export function nextDelay(base = CFG.pollMs) {
  return base;
}
```

## src/rate.ts

```typescript
type BucketKey =
  | "data:/trades"
  | "data:general"
  | "clob:/book"
  | "clob:post_order"
  | "clob:delete_order"
  | "clob:get_orders"
  | "clob:get_trades"
  | "clob:general"
  | "other"
  | "unknown";

const LIMITS: Partial<Record<BucketKey, number>> = {
  "data:/trades": 75, // per 10s window
  "data:general": 200, // per 10s
  "clob:/book": 200, // per 10s
  // trading endpoints have large ceilings (shown for awareness; not enforced here)
  "clob:post_order": 2400,
  "clob:delete_order": 2400,
};

// Sliding window: store timestamps (ms) per bucket.
const reqTimes = new Map<BucketKey, number[]>();
const respCodes: number[] = []; // recent non-2xx codes for quick visibility

function pushTime(map: Map<BucketKey, number[]>, k: BucketKey) {
  const now = Date.now();
  const arr = map.get(k) || [];
  arr.push(now);
  // drop older than 10s
  const cutoff = now - 10_000;
  while (arr.length && arr[0]! < cutoff) arr.shift();
  map.set(k, arr);
}

export function recordReq(bucket: string) {
  pushTime(reqTimes, (bucket as BucketKey) || "unknown");
}
export function recordResp(_bucket: string, status: number) {
  if (status >= 400) {
    respCodes.push(status);
    // keep last 50
    if (respCodes.length > 50) respCodes.splice(0, respCodes.length - 50);
  }
}

function fmt(n: number) {
  return n.toString().padStart(3, " ");
}

function headroomLine(bucket: BucketKey) {
  const count = (reqTimes.get(bucket) || []).length;
  const lim = LIMITS[bucket];
  if (!lim) return ` ${bucket.padEnd(16)}  ${fmt(count)}/10s`;
  const pct = Math.min(100, Math.round((count / lim) * 100));
  const barLen = 20;
  const usedBars = Math.min(barLen, Math.round((pct / 100) * barLen));
  const bar = "█".repeat(usedBars) + "·".repeat(barLen - usedBars);
  const remain = Math.max(0, lim - count);
  return ` ${bucket.padEnd(16)}  ${fmt(count)}/10s  |${bar}|  rem:${remain}`;
}

export function printRateStatus() {
  const keys: BucketKey[] = [
    "data:/trades",
    "data:general",
    "clob:/book",
    "clob:post_order",
    "clob:delete_order",
    "clob:get_orders",
    "clob:get_trades",
    "clob:general",
  ];
  console.log(
    "── Rate status (last 10s) ─────────────────────────────────────────",
  );
  for (const k of keys) console.log(headroomLine(k));
  const recentErrors = respCodes.slice(-10).join(", ");
  if (recentErrors.length) console.log(` errors(last): ${recentErrors}`);
  console.log(
    "────────────────────────────────────────────────────────────────────",
  );
}
```

## src/realtime.ts

```typescript
import { RealTimeDataClient } from "@polymarket/real-time-data-client";
import { CFG } from "./config.js";

// Type definitions from real-time-data-client
type Message = {
  topic: string;
  type: string;
  timestamp: number;
  payload: any;
  connection_id: string;
};

export enum ConnectionStatus {
  CONNECTING = "CONNECTING",
  CONNECTED = "CONNECTED",
  DISCONNECTED = "DISCONNECTED",
}

export type ActivityTrade = {
  asset: string; // tokenId
  bio?: string;
  conditionId: string;
  eventSlug?: string;
  icon?: string;
  name?: string;
  outcome?: string;
  outcomeIndex?: number;
  price: number;
  profileImage?: string;
  proxyWallet: string;
  pseudonym?: string;
  side: "BUY" | "SELL";
  size: number;
  slug?: string;
  timestamp: number;
  title?: string;
  transactionHash: string;
};

type TradeHandler = (trade: ActivityTrade) => void | Promise<void>;
type StatusHandler = (status: ConnectionStatus) => void;

export class PolymarketRealTimeClient {
  private client: RealTimeDataClient;
  private targetWallet: string;
  private onTradeHandler?: TradeHandler;
  private onStatusHandler?: StatusHandler;

  constructor(targetWallet: string) {
    this.targetWallet = targetWallet.toLowerCase();

    this.client = new RealTimeDataClient({
      host: CFG.rtDataHost,
      onConnect: this.handleConnect.bind(this),
      onMessage: this.handleMessage.bind(this),
      onStatusChange: this.handleStatusChange.bind(this),
      autoReconnect: true,
      pingInterval: 5000,
    });
  }

  private handleConnect(client: RealTimeDataClient) {
    console.log("[RT] Connected to Polymarket real-time data stream");

    // Subscribe to ALL activity trades (no filter = all trades)
    // We'll filter by proxyWallet in the message handler
    client.subscribe({
      subscriptions: [
        {
          topic: "activity",
          type: "trades",
          filters: "", // Empty = all trades across all markets
        },
      ],
    });

    console.log("[RT] Subscribed to activity/trades (all markets)");
  }

  private handleMessage(client: RealTimeDataClient, message: Message) {
    // Only process activity/trades messages
    if (message.topic !== "activity" || message.type !== "trades") {
      return;
    }

    const trade = message.payload as ActivityTrade;

    // Debug: Log all trades we see
    console.log(
      `[WS DEBUG] Trade from ${trade.proxyWallet.substring(0, 10)}... ${trade.side} ${trade.size} @ ${trade.price} (tx: ${trade.transactionHash.substring(0, 10)}...)`,
    );

    // Filter by target wallet
    if (trade.proxyWallet.toLowerCase() !== this.targetWallet) {
      return;
    }

    console.log(
      `[WS MATCH] ✅ Target trader detected! tx: ${trade.transactionHash.substring(0, 20)}...`,
    );

    // Call the registered handler
    if (this.onTradeHandler) {
      this.onTradeHandler(trade);
    }
  }

  private handleStatusChange(status: ConnectionStatus) {
    console.log(`[RT] Status: ${status}`);
    if (this.onStatusHandler) {
      this.onStatusHandler(status);
    }
  }

  public connect() {
    this.client.connect();
  }

  public disconnect() {
    this.client.disconnect();
  }

  public onTrade(handler: TradeHandler) {
    this.onTradeHandler = handler;
  }

  public onStatus(handler: StatusHandler) {
    this.onStatusHandler = handler;
  }
}
```

## src/trader.ts

```typescript
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
```

## src/websocket.ts

```typescript
import WebSocket from "ws";

export type WSLastTradeEvent = {
  event_type: "last_trade_price";
  asset_id: string; // tokenId
  market: string; // conditionId
  price: string;
  side: "BUY" | "SELL";
  size: string;
  timestamp: number;
};

export type WSBookEvent = {
  event_type: "book";
  asset_id: string;
  market: string;
  hash: string;
  timestamp: number;
  // ... other book fields
};

export type WSPriceChangeEvent = {
  event_type: "price_change";
  asset_id: string;
  market: string;
  price: string;
  timestamp: number;
};

export type WSTickSizeChangeEvent = {
  event_type: "tick_size_change";
  asset_id: string;
  market: string;
  tick_size: string;
  timestamp: number;
};

export type WSEvent =
  | WSLastTradeEvent
  | WSBookEvent
  | WSPriceChangeEvent
  | WSTickSizeChangeEvent;

export class MarketWebSocket {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private subscribedTokens = new Set<string>(); // Track by tokenId, not conditionId
  private onLastTradeCallback?: (trade: WSLastTradeEvent) => void;
  private onTickSizeChangeCallback?: (event: WSTickSizeChangeEvent) => void;
  private isConnecting = false;

  private readonly WS_URL =
    "wss://ws-subscriptions-clob.polymarket.com/ws/market";

  connect(
    onLastTrade?: (trade: WSLastTradeEvent) => void,
    onTickSizeChange?: (event: WSTickSizeChangeEvent) => void,
  ) {
    // If we don't have any tokens yet, defer the connection to avoid idle closes
    if (this.subscribedTokens.size === 0) return;
    if (this.ws || this.isConnecting) return;
    this.isConnecting = true;

    if (onLastTrade) this.onLastTradeCallback = onLastTrade;
    if (onTickSizeChange) this.onTickSizeChangeCallback = onTickSizeChange;

    this.ws = new WebSocket(this.WS_URL);

    this.ws.on("open", () => {
      console.log("[WS] Connected to Polymarket WebSocket");
      this.isConnecting = false;

      // Start keepalive ping every 10 seconds
      this.pingTimer = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send("PING");
        }
      }, 10000);

      // Resubscribe to tokens after reconnect
      this.flushSubscription();
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      const raw = data.toString();

      // Handle PONG response
      if (raw === "PONG") return;

      try {
        const event = JSON.parse(raw) as WSEvent;
        this.handleEvent(event);
      } catch (e) {
        console.warn("[WS] Failed to parse message:", raw.substring(0, 100));
      }
    });

    this.ws.on("error", (err: Error) => {
      console.warn("[WS] Error:", err.message);
    });

    this.ws.on("close", () => {
      console.log("[WS] Connection closed, reconnecting in 5s...");
      this.cleanup();
      this.reconnectTimer = setTimeout(
        () =>
          this.connect(this.onLastTradeCallback, this.onTickSizeChangeCallback),
        5000,
      );
    });
  }

  // Send the full subscription set
  private flushSubscription() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.subscribedTokens.size === 0) return;
    this.ws.send(
      JSON.stringify({
        type: "market",
        assets_ids: Array.from(this.subscribedTokens),
      }),
    );
    console.log(`[WS] Subscribed to ${this.subscribedTokens.size} tokens`);
  }

  private handleEvent(event: WSEvent) {
    if (event.event_type === "last_trade_price" && this.onLastTradeCallback) {
      this.onLastTradeCallback(event);
    } else if (
      event.event_type === "tick_size_change" &&
      this.onTickSizeChangeCallback
    ) {
      this.onTickSizeChangeCallback(event);
    }
    // Ignore book and price_change events for now
  }

  subscribeToToken(tokenId: string) {
    this.subscribedTokens.add(tokenId);
    // If not connected yet, connect now that we have at least 1 token
    if (!this.ws)
      this.connect(this.onLastTradeCallback, this.onTickSizeChangeCallback);
    this.flushSubscription();
  }

  unsubscribeFromToken(tokenId: string) {
    this.subscribedTokens.delete(tokenId);

    if (
      this.ws &&
      this.ws.readyState === WebSocket.OPEN &&
      this.subscribedTokens.size > 0
    ) {
      this.flushSubscription();
    }
  }

  private cleanup() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.ws = null;
    this.isConnecting = false;
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
    }
    this.cleanup();
    this.subscribedTokens.clear();
  }
}
```
