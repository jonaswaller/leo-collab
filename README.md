# Copycat

A +EV sports betting bot that trades on [Polymarket](https://polymarket.com). It sources sharp odds from major sportsbooks, builds a fair probability model, and executes both taker and maker orders on the CLOB when it finds edge.

---

### How It Works

```
Sportsbooks (Pinnacle, DraftKings, etc.)
        │
        ▼
   Fair Probability ◄── Weighted consensus + de-vigging (Power/Shin/Probit)
        │
        ├── Compare to Polymarket ask ──► Taker orders (immediate fill, +EV hits)
        │
        └── Compare to Polymarket bid ──► Maker orders (passive liquidity, wider margin)
```

**Discovery** — Pulls upcoming sports markets from Polymarket's Gamma API across NFL, NBA, MLB, NHL, MMA, soccer leagues, and more.

**Odds** — Fetches live lines from 15+ bookmakers via The Odds API. Books are weighted by sharpness (Pinnacle 40%, Marathonbet 15%, etc.) and blended into a consensus fair probability.

**Matching** — Fuzzy-matches Polymarket questions to sportsbook events, handling team name variants and exact line matching for spreads/totals.

**Analysis** — De-vigs sportsbook lines using Power method (moneylines) and Probit method (spreads/totals). Calculates EV and sizes positions using fractional Kelly criterion with per-market and per-event exposure caps.

**Execution** — Taker orders fire as limit orders at the ask when edge exceeds thresholds. Maker orders post GTC bids at a target price within configurable margin bands. Existing makers are continuously evaluated and cancelled when EV decays, they get outbid, or Kelly targets are satisfied.

**Tracking** — All wagers are logged to Supabase with EV at placement, fair probability, and closing line value (CLV) updated as events approach.

---

### Quickstart

```bash
cp .env.example .env   # Add your API keys
npm install
npm start              # Dry run (default)
npm run start:live     # Live trading
```

---

### Project Structure

```
src/
├── index.ts           # Main loop — 15s polling cycle
├── arb/
│   ├── discovery.ts   # Polymarket market discovery
│   ├── odds-fetcher.ts# Sportsbook odds fetching
│   ├── matcher.ts     # Market ↔ event matching
│   ├── analyzer.ts    # EV analysis & opportunity identification
│   ├── calculator.ts  # De-vigging & Kelly sizing
│   ├── execution.ts   # Taker & maker order execution
│   ├── orderbook.ts   # Live CLOB quotes
│   ├── positions.ts   # Position & exposure tracking
│   ├── maker-management.ts  # Maker order lifecycle
│   ├── maker-registry.ts    # Active order DB tracking
│   ├── config.ts      # All tunable parameters
│   └── types.ts       # Type definitions
└── storage/
    ├── operations.ts  # Wager persistence
    ├── tracking.ts    # Maker fill sync
    └── supabase.ts    # DB client
```
