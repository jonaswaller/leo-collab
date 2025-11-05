import { CFG } from "./config.js";
import { makeClobClient } from "./clients.js";
import { resolveHandleToProxyWallet } from "./gamma.js";
import { getUserTrades } from "./data.js";
import { mirrorTrade } from "./trader.js";
import { printTradeCard, printMirrorLine, timeAgo } from "./logger.js";
import { TokenBucket, nextDelay } from "./poll.js";
import { printRateStatus } from "./rate.js";
import { MarketWebSocket } from "./websocket.js";
import { updateTickSize } from "./book.js";

(async () => {
  const { client } = await makeClobClient();

  const target = CFG.targetHandle;
  const targetWallet = await resolveHandleToProxyWallet(target);
  console.log(`Following ${target} at ${targetWallet}`);

  const seen = new Set<string>();
  let watermark = Math.floor(Date.now() / 1000) - 2; // start ~now, allow tiny skew

  const bucket = new TokenBucket(CFG.maxTradesRPS, 1.0);

  // Track tokens we've seen to subscribe to WebSocket
  const seenTokens = new Set<string>();

  // Initialize WebSocket for real-time events
  const ws = new MarketWebSocket();
  if (CFG.useWebSocket) {
    // Seed tokens from the first fetch so WS subscribes immediately
    const seedRows = await getUserTrades(targetWallet, Math.max(5, CFG.tradesLimit));
    for (const r of seedRows) seenTokens.add(r.asset);
    for (const tok of seenTokens) ws.subscribeToToken(tok);

    ws.connect(
      async (trade) => {
        // WebSocket last_trade_price event - mirror immediately
        console.log(`[WS] Trade: ${trade.side} ${trade.size} @ ${trade.price} on ${trade.asset_id}`);
        
        // Convert WS event to TradeRow format and mirror
        const wsTradeRow = {
          proxyWallet: targetWallet,
          side: trade.side,
          asset: trade.asset_id,
          conditionId: trade.market,
          price: Number(trade.price),
          size: Number(trade.size),
          timestamp: trade.timestamp,
          transactionHash: `ws-${trade.asset_id}-${trade.timestamp}`,
        };
        
        // Check if we've already seen this (avoid duplicate from HTTP poll)
        const wsKey = `${trade.asset_id}-${trade.timestamp}-${trade.price}`;
        if (!seen.has(wsKey)) {
          seen.add(wsKey);
          const result = await mirrorTrade(client, wsTradeRow);
          if (result.ok) {
            printMirrorLine(true, trade.side, trade.asset_id, result.price, result.filled ?? result.size);
          } else {
            printMirrorLine(false, trade.side, trade.asset_id, result.intended?.price, result.intended?.size, result.reason);
          }
        }
      },
      (tickChange) => {
        // Update cache when tick size changes
        console.log(`[WS] Tick size changed for ${tickChange.asset_id}: ${tickChange.tick_size}`);
        updateTickSize(tickChange.asset_id, Number(tickChange.tick_size));
      }
    );
  }

  // Print rate status every 5 seconds
  setInterval(printRateStatus, 5000);

  async function runLoop() {
    try {
      // obey rate limiter
      if (!bucket.take()) {
        setTimeout(runLoop, nextDelay());
        return;
      }
      const rows = await getUserTrades(targetWallet, CFG.tradesLimit);
      
      // Process trades in parallel for lower latency
      const newTrades = rows
        .slice()
        .reverse()
        .filter((t) => {
          if (t.timestamp < watermark) return false;
          watermark = Math.max(watermark, t.timestamp);
          if (seen.has(t.transactionHash)) return false;
          seen.add(t.transactionHash);
          
          // Subscribe to token WebSocket if enabled (use tokenId, not conditionId)
          if (CFG.useWebSocket && !seenTokens.has(t.asset)) {
            seenTokens.add(t.asset);
            ws.subscribeToToken(t.asset);
          }
          
          return true;
        });

      // Process all new trades in parallel
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
            printMirrorLine(
              true,
              t.side,
              t.asset,
              result.price,
              result.filled ?? result.size,
            );
          } else {
            printMirrorLine(
              false,
              t.side,
              t.asset,
              result.intended?.price,
              result.intended?.size,
              result.reason,
            );
          }
        })
      );


      setTimeout(runLoop, nextDelay());
    } catch (e: any) {
      // simple backoff on known throttling/gateway issues
      const status = e?.response?.status || 0;
      const retry = status === 429 || status >= 500 ? 280 : nextDelay();
      console.warn("poll error", e?.response?.data || e.message || e);
      setTimeout(runLoop, retry);
    }
  }

  // kickoff
  console.log(
    `Monitoring ${target} for new trades (watermark: ${new Date(watermark * 1000).toISOString()})...`,
  );
  runLoop();
})();
