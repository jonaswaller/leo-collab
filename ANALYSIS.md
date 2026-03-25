# Polymarket Sports Arbitrage Bot — Analysis & Findings

> Analysis performed March 2026 on historical data from Nov 24, 2025 – Jan 5, 2026.
> Bot was shut down after ~6 weeks of live trading. This document summarizes all findings
> ahead of a potential restart.

---

## What This Bot Does

A TypeScript trading bot that exploits pricing inefficiencies between sharp sportsbooks and Polymarket. Every 15 seconds it:

1. Discovers upcoming sports markets on Polymarket (within 24hrs)
2. Fetches odds from 9 weighted sportsbooks (Pinnacle at 40%)
3. De-vigs each book's odds to get fair probabilities (Power/Shin for H2H, Probit for spreads/totals)
4. Computes a weighted consensus fair probability
5. Compares consensus to Polymarket prices to find +EV opportunities
6. Executes **taker** orders (hit the ask, immediate fill) or **maker** orders (post limit bids, passive fill)
7. Sizes positions using Kelly criterion (0.4x multiplier, 4% per-market cap, 7% per-event cap)

---

## Overall Performance

| Metric | Value |
|---|---|
| Total wagers | 2,153 |
| Total volume | $51,360 |
| Date range | Nov 24, 2025 – Jan 5, 2026 |
| CLV coverage | 91.5% (1,971 of 2,153 wagers have CLV data) |

### CLV (Closing Line Value) Summary

| Metric | Value |
|---|---|
| Simple average CLV | +2.13% |
| **Volume-weighted CLV** | **+1.30%** |
| CLV+ rate | 62.9% (1,239 positive / 732 negative) |
| Total CLV$ | +$614.19 |

> **Important:** The +2.13% simple average is misleading — it gives equal weight to a $0.50
> maker fill and a $100 taker hit. The volume-weighted +1.30% is the honest number.
> CLV data was cross-verified by recomputing `(closing_fair_prob - price) / price` from raw
> fields — **0 mismatches** out of 1,971 wagers.

---

## Maker vs Taker Performance

| Order Type | Count | Volume | CLV$ | Vol-Weighted CLV% |
|---|---|---|---|---|
| **Maker** | 1,577 | $35,120 | **+$542** | **+1.54%** |
| Taker | 576 | $16,239 | +$72 | +0.44% |

Makers outperform takers ~7.5:1 on CLV dollars. Makers get filled inside the spread at better
prices; takers pay the ask which is often close to fair by close.

### Taker CLV by EV Bucket (Volume-Weighted)

| EV Range | Taker CLV% | Maker CLV% |
|---|---|---|
| 2-4% | +0.46% | +1.63% |
| 4-6% | **-0.57%** | +0.35% |
| 6-8% | **-2.59%** | +3.20% |
| 8%+ | **+5.72%** | +4.80% |

**Takers are negative CLV at every EV level below 8%.** The edge the model identifies at
4-6% EV is noise for takers — they're hitting asks that turn out to be fairly priced by close.

---

## Performance by Sport

| Sport | Count | Volume | CLV$ | Vol-Weighted CLV% | Verdict |
|---|---|---|---|---|---|
| **NFL** | 185 | $3,736 | **+$233** | **+6.22%** | Best performer |
| NBA | 854 | $29,694 | +$261 | +0.88% | Volume king, thin edge |
| NHL | 437 | $8,385 | +$59 | +0.71% | Okay, takers losing |
| CFB | 269 | $5,208 | +$26 | +0.50% | Marginal |
| Soccer (all) | ~200 | $3,072 | +$24 | +0.78% | Mixed, tiny volume |

### Taker vs Maker CLV by Sport

**Taker CLV by sport:**

| Sport | Taker CLV% | Note |
|---|---|---|
| NFL | +5.76% | Only sport where takers crush |
| CFB | +1.76% | Okay |
| NBA | -0.15% | Basically zero |
| NHL | -0.91% | Losing |
| Soccer | Various | Small samples, mixed |

**Maker CLV by sport:** Positive across the board (NHL +2.77%, NFL +4.75%, NBA +1.38%).

---

## Performance by Market Type

| Type | Count | Volume | CLV$ | Vol-Weighted CLV% |
|---|---|---|---|---|
| **Totals** | 553 | $12,652 | **+$336** | **+2.66%** |
| Spreads | 747 | $17,438 | +$171 | +0.98% |
| H2H | 671 | $21,270 | +$107 | +0.50% |

### Best Combos (Sport + Market Type)

| Combo | Volume | CLV$ | CLV% |
|---|---|---|---|
| **NFL totals** | $1,036 | **+$179** | **+17.3%** |
| NFL spreads | $1,655 | +$42 | +2.5% |
| NBA totals | $7,224 | +$105 | +1.5% |
| NHL spreads | $4,362 | +$96 | +2.2% |

### Worst Combos

| Combo | Volume | CLV$ | CLV% |
|---|---|---|---|
| NHL h2h | $3,145 | -$35 | -1.1% |
| CFB h2h | $1,373 | -$24 | -1.7% |

---

## The 4-6% EV Problem

The 4-6% EV band is the largest group (878 bets, $20.9K volume) but produces only **$25 of
CLV** — a 0.12% volume-weighted return. Three factors explain this:

### 1. Coin-flip prices are a trap

530 of 878 bets in this bucket are priced 40-60c (near 50/50 markets). These are the most
liquid, most efficiently priced markets on Polymarket. Result: **-$92 CLV on $14K volume.**

Meanwhile, 20-40c underdogs (+2.19% CLV) and 60-80c favorites (+0.94% CLV) are positive
in this same EV range. Edge is easier to find at the extremes.

### 2. Big bets perform worse

| Segment | Volume | CLV% |
|---|---|---|
| Top 25% by size | $11,457 | **-0.50%** |
| Bottom 75% | $9,424 | +0.87% |

Kelly sizes up on bets with higher perceived edge — but at 4-6% EV, the confidence is
misplaced. The bigger bets drag down the whole bucket.

### 3. NBA dominates this bucket

394 of 878 bets are NBA, producing -$4.45 CLV on $11.2K volume. NBA is the most liquid
Polymarket sport — hardest to find mispricing in the 4-6% EV range.

---

## EV-to-CLV Calibration

| EV Bucket | Count | Simple Avg CLV | Vol-Weighted CLV | CLV$ | CLV+ Rate |
|---|---|---|---|---|---|
| 2-4% | 445 | 0.59% | 1.17% | +$156 | 60.4% |
| 4-6% | 878 | 1.17% | 0.12% | +$25 | 58.1% |
| 6-8% | 403 | 3.13% | 2.15% | +$175 | 67.5% |
| 8%+ | 242 | 6.84% | 5.18% | +$257 | 76.4% |

Higher EV bets have proportionally higher CLV and higher CLV+ rates. The model is
directionally correct — it just can't distinguish signal from noise at the 4-6% level,
particularly on takers and coin-flip markets.

---

## Weekly Trend

Volume ramped from ~$120/week at launch to $9,800+/week by the end. The system got
more aggressive as it found more opportunities and parameters were tuned.

---

## How Edge Is Calculated

### Step 1: De-vig sportsbook odds

Each bookmaker's odds include a margin (vig). The bot removes it to get fair probabilities:

- **H2H (moneylines):** Power/Shin method — finds exponent k where `sum(q_i^k) = 1`.
  Corrects for favorite-longshot bias.
- **Spreads/Totals:** Probit method — assumes margin is additive in probit (normal CDF)
  space. Solves for margin m where `Φ(z₁-m) + Φ(z₂-m) = 1`.

### Step 2: Weighted consensus

De-vigged probabilities from each book are combined via weighted average:

| Tier | Books | Weight |
|---|---|---|
| Tier 1 (Sharp) | Pinnacle (40%), Marathonbet (15%), BetOnline (10%), BetAnySports (7%) | 72% |
| Tier 2 (Euro) | Unibet (4%), 888Sport (3%) | 7% |
| Tier 3 (US Rec) | DraftKings (10%), FanDuel (7%), Fanatics (4%) | 21% |

Weights are renormalized based on which books have odds for a given market.

### Step 3: Compare to Polymarket price

```
EV = (fairProb - polymarketPrice) / fairProb
```

### Step 4: Kelly sizing

```
kellyFraction = edge / (1 - price)
adjustedKelly = kellyFraction × 0.4 (half-Kelly)
```

Constrained by per-market (4%) and per-event (7%) caps.

### Why the edge exists

The bot doesn't predict games better than Pinnacle. The edge comes from Polymarket being
slower and less efficient than sharp sportsbooks — retail traders, lower liquidity, slower
price updates. The bot arbitrages this information asymmetry.

CLV confirms the edge is real: consistently buying below the closing line over 2,153 bets
is not luck.

---

## Recommendations for Restart

### 1. Kill takers below 8% EV

Takers are negative CLV at every EV level below 8%. They're hitting asks that are approximately
fairly priced. Only execute takers when the edge is large and unambiguous.

### 2. Raise maker minimums to 6%+ EV

The 4-6% maker CLV is only +0.35% volume-weighted — barely worth the capital lockup.
The real money is at 6%+ EV where makers have +3.2% CLV.

### 3. Lean into the winners

**Best opportunities:** NFL (all types), NBA totals, NHL spreads.

**Drop or deprioritize:** NHL h2h (negative CLV), soccer leagues (tiny volume, mixed results),
CFB h2h (negative CLV).

### 4. Avoid 40-60c coin-flip markets at low EV

These are the most efficiently priced markets on Polymarket. Consider requiring higher EV
thresholds for prices in the 40-60c range, or skipping them entirely below 6% EV.

### 5. Add position exit logic

Currently the bot buys and holds to resolution. Capital is locked until events end. Adding
sell logic (cut losers when fair value drops below entry, take profit when market exceeds
fair value) would:
- Free up capital faster (higher effective volume)
- Reduce variance
- Enable higher frequency without faster polling

### 6. Add maker asks on held positions

Natural extension of the maker strategy. Post asks above fair value on positions you already
hold. If filled, you earn the spread and recycle capital. Makers already have +1.54% CLV on
the buy side — adding the sell side doubles the opportunity set.

---

## Codebase Notes

### Architecture

The bot is ~4,500 lines of TypeScript across 15 source files. Clean separation between
discovery, matching, analysis, execution, and position management. Backed by Supabase
(PostgreSQL) with two tables: `wagers` and `active_maker_orders`.

### Code quality

No critical bugs found. The math checks out (CLV recomputation has zero mismatches).
Main issues are maintainability-related:

- Duplicated utility functions across 3 files (`normalizeTeam`, `extractLine`, `isFirstHalf`)
- Large monolithic functions (187-line `calculateMarketEV`, 164-line `calculateMakerEV`)
- `calculator.ts` mixes de-vigging, Kelly, and exposure logic in 589 lines
- No logging framework (raw `console.log`)
- No circuit breaker / backoff on API failures

These are worth cleaning up before restart but are not blocking issues.
