const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const fmtNum = (x: number, d = 2) => Number.isFinite(x) ? x.toFixed(d) : '-';
const fmtUSD = (x: number) => `$${fmtNum(x, 2)}`;

export function timeAgo(tsSec: number): string {
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - tsSec);
  if (delta < 5) return 'just now';
  if (delta < 60) return `${delta}s ago`;
  const m = Math.floor(delta / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export function printTradeCard(opts: {
  side: 'BUY' | 'SELL';
  market: string;    // e.g., "Canucks vs. Predators"
  outcome: string;   // e.g., "Predators"
  price: number;     // 0.63
  shares: number;    // 163
  usd: number;       // shares * price
  when: string;      // timeAgo
  slug?: string;     // e.g., "nhl-van-nsh-2025-11-03"
}) {
  const sideWord = opts.side === 'BUY' ? 'Buy' : 'Sell';
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
    (opts.slug ? opts.slug.length + 10 : 0)
  );

  const line = '─'.repeat(w - 2);
  console.log(`┌${line}┐`);
  console.log(`│ ${pad(title, w - 3)}│`);
  console.log(`│ ${pad(priceStr, w - 3)}│`);
  console.log(`│ ${pad(sharesStr, w - 3)}│`);
  console.log(`│ ${pad(usdStr, w - 3)}│`);
  if (opts.slug) console.log(`│ ${pad('Market: ' + opts.slug, w - 3)}│`);
  console.log(`│ ${pad(opts.when, w - 3)}│`);
  console.log(`└${line}┘`);
}

export function printMirrorLine(ok: boolean, side: string, tokenId: string, price?: number, size?: number, reason?: string) {
  const p = price !== undefined ? fmtNum(price, 4) : '-';
  const s = size !== undefined ? fmtNum(size, 4) : '-';
  const status = ok ? 'PLACED' : 'SKIP';
  const reasonStr = !ok && reason ? ` (${reason})` : '';
  console.log(`→ [${status}] ${pad(side, 4)} token=${tokenId} size=${s} price=${p}${reasonStr}`);
}
