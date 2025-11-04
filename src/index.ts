import { CFG } from "./config.js";
import { makeClobClient } from "./clients.js";
import { resolveHandleToProxyWallet } from "./gamma.js";
import { getUserTrades } from "./data.js";
import { mirrorTrade } from "./trader.js";
import { printTradeCard, printMirrorLine, timeAgo } from "./logger.js";
import { TokenBucket, nextDelay } from "./poll.js";
import { printRateStatus } from "./rate.js";

(async () => {
  const { client } = await makeClobClient();

  const target = CFG.targetHandle;
  const targetWallet = await resolveHandleToProxyWallet(target);
  console.log(`Following ${target} at ${targetWallet}`);

  const seen = new Set<string>();
  let watermark = Math.floor(Date.now() / 1000) - 2; // start ~now, allow tiny skew

  const bucket = new TokenBucket(CFG.maxTradesRPS, 1.0);

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
      for (const t of rows.slice().reverse()) {
        if (t.timestamp < watermark) continue;
        watermark = Math.max(watermark, t.timestamp);
        if (seen.has(t.transactionHash)) continue;
        seen.add(t.transactionHash);

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
      }
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
