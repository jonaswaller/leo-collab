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
