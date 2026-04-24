import "dotenv/config";
import { supabase } from "../src/storage/supabase.js";

if (!supabase) {
  console.error("no supabase");
  process.exit(1);
}

const daysBack = Number(process.argv[2] ?? 7);
const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

const { data, error } = await supabase
  .from("wagers")
  .select(
    "created_at,event_start_time,sport,market_type,price,size_filled,clv,closing_fair_prob",
  )
  .gte("created_at", since)
  .order("created_at", { ascending: false });

if (error) {
  console.error(error);
  process.exit(1);
}

type Row = NonNullable<typeof data>[number];
const rows = (data ?? []).filter(
  (r) => r.clv != null && r.size_filled != null && r.size_filled > 0,
) as Row[];

console.log(`\n${rows.length} filled wagers with CLV in the last ${daysBack} days\n`);

if (rows.length === 0) process.exit(0);

function summarize(label: string, subset: Row[]) {
  if (subset.length === 0) return;
  const clvs = subset.map((r) => Number(r.clv));
  // size_filled is in SHARES; notional USD = shares * price
  const sizes = subset.map((r) => Number(r.size_filled) * Number(r.price));
  const totalSize = sizes.reduce((a, b) => a + b, 0);

  const meanClv = clvs.reduce((a, b) => a + b, 0) / clvs.length;
  const sizeWeightedClv =
    clvs.reduce((a, b, i) => a + b * sizes[i]!, 0) / totalSize;
  const sorted = [...clvs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const posRate = clvs.filter((c) => c > 0).length / clvs.length;
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;

  console.log(
    `  ${label.padEnd(30)} n=${String(subset.length).padStart(4)} | mean=${(meanClv * 100).toFixed(2).padStart(6)}% | sz-wtd=${(sizeWeightedClv * 100).toFixed(2).padStart(6)}% | median=${(median * 100).toFixed(2).padStart(6)}% | win=${(posRate * 100).toFixed(0).padStart(3)}% | range=[${(min * 100).toFixed(1)}%, ${(max * 100).toFixed(1)}%] | size=$${totalSize.toFixed(0)}`,
  );
}

console.log("═══ OVERALL ═══");
summarize("all", rows);

console.log("\n═══ BY SPORT ═══");
const bySport = new Map<string, Row[]>();
for (const r of rows) {
  const k = r.sport ?? "unknown";
  if (!bySport.has(k)) bySport.set(k, []);
  bySport.get(k)!.push(r);
}
for (const [sport, subset] of [...bySport.entries()].sort(
  (a, b) => b[1].length - a[1].length,
)) {
  summarize(sport, subset);
}

console.log("\n═══ BY SPORT × MARKET TYPE ═══");
for (const [sport, subset] of [...bySport.entries()].sort(
  (a, b) => b[1].length - a[1].length,
)) {
  const byType = new Map<string, Row[]>();
  for (const r of subset) {
    const k = r.market_type ?? "unknown";
    if (!byType.has(k)) byType.set(k, []);
    byType.get(k)!.push(r);
  }
  console.log(`\n  ${sport}:`);
  for (const [mt, mtRows] of [...byType.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    summarize(`  ${mt}`, mtRows);
  }
}

console.log("\n═══ BY TIME-TO-EVENT AT PLACEMENT ═══");
const timeBuckets: [string, (h: number) => boolean][] = [
  ["<1h", (h) => h < 1],
  ["1-3h", (h) => h >= 1 && h < 3],
  ["3-6h", (h) => h >= 3 && h < 6],
  ["6-12h", (h) => h >= 6 && h < 12],
  ["12-24h", (h) => h >= 12 && h < 24],
  [">=24h", (h) => h >= 24],
];

const rowsWithTiming = rows.filter((r) => r.event_start_time != null);
const bucketed = new Map<string, Row[]>();
for (const r of rowsWithTiming) {
  const hours =
    (new Date(r.event_start_time!).getTime() -
      new Date(r.created_at!).getTime()) /
    3_600_000;
  if (hours < 0) continue;
  const bucket = timeBuckets.find(([, fn]) => fn(hours))?.[0] ?? "?";
  if (!bucketed.has(bucket)) bucketed.set(bucket, []);
  bucketed.get(bucket)!.push(r);
}
for (const [label] of timeBuckets) {
  const subset = bucketed.get(label);
  if (subset) summarize(label, subset);
}

process.exit(0);
