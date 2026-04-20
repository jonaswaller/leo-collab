import "dotenv/config";
import { supabase } from "../src/storage/supabase.js";

if (!supabase) {
  console.error("no supabase");
  process.exit(1);
}

const pattern = process.argv[2] ?? "%";
const limit = Number(process.argv[3] ?? 30);

const { data, error } = await supabase
  .from("wagers")
  .select(
    "created_at,event_slug,market_slug,market_type,order_type,outcome,price,size_filled,fair_prob_at_placement,ev_at_placement,bookmakers_used",
  )
  .ilike("event_slug", pattern)
  .order("created_at", { ascending: false })
  .limit(limit);

if (error) {
  console.error(error);
  process.exit(1);
}

for (const w of data ?? []) {
  const books = Array.isArray(w.bookmakers_used)
    ? w.bookmakers_used.join(",")
    : JSON.stringify(w.bookmakers_used);
  console.log(
    `${w.created_at?.slice(0, 19)} | ${w.order_type} | ${w.market_type} | out=${w.outcome} | px=${w.price} | fair=${w.fair_prob_at_placement?.toFixed?.(3)} | EV=${w.ev_at_placement?.toFixed?.(4)} | filled=${w.size_filled} | books=[${books}] | ${w.market_slug} | ${w.event_slug}`,
  );
}
process.exit(0);
