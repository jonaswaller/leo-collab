import "dotenv/config";
import { supabase } from "../src/storage/supabase.js";

if (!supabase) process.exit(1);

const q = async (pattern: string) => {
  const { data } = await supabase
    .from("wagers")
    .select("*")
    .ilike("event_slug", pattern)
    .order("created_at", { ascending: true });
  return data ?? [];
};

for (const row of await q("%udvardy%")) {
  console.log(
    `UDVARDY | created_at=${row.created_at} | event_start=${row.event_start_time} | out=${row.outcome} | px=${row.price} | fair=${row.fair_prob_at_placement} | EV=${row.ev_at_placement} | filled=${row.size_filled} | order=${row.order_id} | books=${JSON.stringify(row.bookmakers_used)}`,
  );
}
console.log("---");
for (const row of await q("mlb-hou-cle-2026-04-20")) {
  console.log(
    `ASTROS | created_at=${row.created_at} | event_start=${row.event_start_time} | market=${row.market_type} | out=${row.outcome} | px=${row.price} | fair=${row.fair_prob_at_placement} | EV=${row.ev_at_placement} | filled=${row.size_filled} | order=${row.order_id} | mkt=${row.market_slug} | books=${JSON.stringify(row.bookmakers_used)}`,
  );
}
process.exit(0);
