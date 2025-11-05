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
