import { CFG } from './config.js';
import { makeClobClient } from './clients.js';
import { resolveHandleToProxyWallet } from './gamma.js';
import { getUserTrades } from './data.js';
import { mirrorTrade } from './trader.js';
import { printTradeCard, printMirrorLine, timeAgo } from './logger.js';

(async () => {
  const { client } = await makeClobClient();

  const target = CFG.targetHandle;
  const targetWallet = await resolveHandleToProxyWallet(target);
  console.log(`Following ${target} at ${targetWallet}`);

  const seen = new Set<string>();
  let watermark = Math.floor(Date.now() / 1000) - 2; // start ~now, allow tiny skew

  const loop = async () => {
    try {
      const rows = await getUserTrades(targetWallet, 100); // newest first
      // process oldest→newest within the batch
      for (const t of rows.slice().reverse()) {
        // allow multiple trades at same second
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
          outcome: t.outcome ?? (typeof t.outcomeIndex === 'number' ? `Outcome ${t.outcomeIndex}` : 'Outcome'),
          price: t.price,
          shares,
          usd,
          when: timeAgo(t.timestamp),
          slug: t.slug,
        });

        const placed = await mirrorTrade(client, t);
        if (placed?.ok) {
          printMirrorLine(true, t.side, t.asset, placed.price, placed.size);
        } else {
          printMirrorLine(false, t.side, t.asset, placed?.intended?.price, placed?.intended?.size, placed?.reason);
        }
      }
    } catch (e: any) {
      console.error('poll error', e?.response?.data ?? e);
    }
  };

  console.log(`Monitoring ${target} for new trades (watermark: ${new Date(watermark * 1000).toISOString()})...`);
  setInterval(loop, CFG.pollMs);
})();
