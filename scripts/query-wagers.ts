import "dotenv/config";
import { supabase } from "../src/storage/supabase.js";

const marketTypeFilter = process.argv[2] ?? "nrfi";
const limit = Number(process.argv[3] ?? 50);

if (!supabase) {
  console.error("Supabase client not initialized — check .env");
  process.exit(1);
}

const { data, error } = await supabase
  .from("wagers")
  .select(
    "created_at,event_slug,market_type,order_type,outcome,price,size_filled,ev_at_placement,fair_prob_at_placement,bookmakers_used,closing_fair_prob,clv,profit_loss",
  )
  .eq("market_type", marketTypeFilter)
  .order("created_at", { ascending: false })
  .limit(limit);

if (error) {
  console.error(error);
  process.exit(1);
}

if (!data || data.length === 0) {
  console.log(`No wagers with market_type='${marketTypeFilter}'`);
  process.exit(0);
}

console.log(`\n${data.length} ${marketTypeFilter} wagers (newest first):\n`);

for (const w of data) {
  const fair = w.fair_prob_at_placement;
  const price = w.price;
  const closing = w.closing_fair_prob;

  // EV formula per calculator.ts:469 → (fair - price) / fair
  const evCalc = fair != null && price != null && fair > 0 ? (fair - price) / fair : null;
  const evStored = w.ev_at_placement;
  const evMatch =
    evCalc != null && evStored != null
      ? Math.abs(evCalc - evStored) < 0.001
        ? "✓"
        : "✗"
      : "?";

  // CLV per schema.sql:19 → (closing_fair_prob - price) / price
  const clvCalc = closing != null && price != null && price > 0 ? (closing - price) / price : null;
  const clvStored = w.clv;
  const clvMatch =
    clvCalc != null && clvStored != null
      ? Math.abs(clvCalc - clvStored) < 0.001
        ? "✓"
        : "✗"
      : "—";

  const books = Array.isArray(w.bookmakers_used)
    ? w.bookmakers_used.join(",")
    : JSON.stringify(w.bookmakers_used);

  console.log(
    `${w.created_at?.slice(0, 19)} | ${w.order_type.padEnd(5)} | out=${w.outcome} | px=${price?.toFixed(3)} | fair=${fair?.toFixed(3)} | close=${closing?.toFixed(3) ?? "—"} | EV=${evStored?.toFixed(4)}(calc ${evCalc?.toFixed(4)} ${evMatch}) | CLV=${clvStored?.toFixed(4) ?? "—"}(calc ${clvCalc?.toFixed(4) ?? "—"} ${clvMatch}) | [${books}] | ${w.event_slug}`,
  );
}

process.exit(0);
