## Maker & Taker Rules (Ground Truth)

This file defines the core execution rules for taker and maker orders. The code in `/src/arb` and `src/index.ts` should conform to these rules.

---

## Taker Rules (Immediate Execution)

- **Taker definition**
  - A taker order is an order that is intended to execute immediately against the existing book (hit the ask / lift the offer), never improving the book. Taker orders should always be limit orders and canceled/rejected if they are not filled immediately.

- **Order type & slippage**
  - All taker orders are **limit orders**, never true market orders.
  - Use **FAK (Fill-And-Kill / IOC)**:
    - Attempt to fill at the full Kelly-recommended size; any portion that can be filled immediately at or better than our limit is taken.
    - Any unfilled remainder is cancelled and does not rest on the book.
  - We never accept any price worse than our own limit → **no slippage**.

- **Price selection**
  - Baseline price is the **current Polymarket ask** for the target outcome (from Gamma/CLOB or live CLOB quotes).
  - The limit price must be:
    - ≤ our maximum acceptable price implied by EV / fair probability.
    - Aligned to market **tick size** (Gamma / CLOB `orderPriceMinTickSize`).

- **Size selection**
  - Base size comes from **Kelly sizing**: `kellySize.constrainedShares`.
  - We subtract our current shares of that market selection. Example: if Kelly says 50 shares and we already own 25, we only want to buy 25 new shares.
  - Enforce market minimums:
    - Size must be ≥ `minOrderSize` from Gamma / CLOB.
  - Rounding:
    - Shares are rounded **down** to **2 decimal places**, consistent with Polymarket order-building helpers.

- **EV / Kelly preconditions**
  - Only place taker orders when:
    - EV ≥ per-market-type **taker margin** (from `TAKER_MARGINS`).
    - Kelly-constrained size after exposure caps and minus current shares is strictly positive.

---

## Maker Rules (Passive Liquidity)

- **Maker definition**
  - A maker order is a **passive limit bid** (currently only BUY side) that adds liquidity to the book and may be filled over time.

- **Price & margin**
  - For each matched market/outcome, we:
    - Compute **fair probability** from bookmaker odds (Power/Shin for H2H, Probit for spreads/totals).
    - Choose a **target bid price** that sits inside the spread and respects per-market-type maker margin bounds from `MAKER_MARGINS`:
      - `min` and `max` margins differ by market type and 1H vs full game (`h2h`, `spreads`, `totals`, `*_h1`).
  - Maker EV is defined as:
    - `EV = (fairProb - bidPrice) / fairProb`.

- **EV thresholds (keep vs cancel)**
  - For each maker order we track:
    - `evAtPlacement`: EV at the time we posted the order.
    - `currentEV`: EV based on the latest full pipeline.
  - Keep / cancel rules:
    - **Cancel** if `currentEV < minEV` where:
      - `minEV` = `MAKER_MARGINS[marketType or marketType_h1].min`.
    - **Cancel** if EV has deteriorated too much:
      - `currentEV < evAtPlacement - MAKER_EVAL_EV_DROP` (currently 2%).
    - If `currentEV` is ≥ `minEV` and has not dropped by more than `MAKER_EVAL_EV_DROP`, EV is acceptable and we may keep the order, subject to best-price and partial-fill rules below.
    - Also cancel if the order cannot be matched to a maker opportunity, as it is considered out of model.

- **Best-price rules**
  - We treat an order as **outbid** when:
    - Someone posts a better bid at least **one tick** higher (using the current tick size).
  - If outbid by ≥ one tick:
    - **Action**: cancel the existing order. We never leave non-best bids up.
    - Any new maker order (at the latest target price with fresh Kelly sizing) is placed during the **placement phase** of the next cycle, if the opportunity is still EV-acceptable.
  - If outbid and EV has fallen below `minEV` or dropped more than 2%:
    - **Action**: cancel and DO NOT place a new maker for this outcome unless a future analyzer run restores EV above thresholds.

- **Partial fills**
  - We consider a maker order "fully satisfied" for the current cycle when:
    - Filled shares reach the Kelly target for that cycle:
      - `filledShares ≥ kellyTargetShares`.
  - Rules:
    - If the order is **partially filled** and:
      - EV is still above thresholds, and
      - We are not outbid by ≥ one tick, and
      - `filledShares < kellyTargetShares`:
      - **Leave the remaining size live**.
    - If EV becomes bad (below `minEV` or >2% EV drop) or we are outbid by ≥ one tick:
      - **Cancel the remaining size**, even if partially filled. A future cycle may place a new maker if the opportunity still satisfies EV and Kelly constraints.
    - If `filledShares ≥ kellyTargetShares`:
      - **Cancel any remaining live size**, since the Kelly target for this cycle has been achieved.

- **Size selection**
  - Base maker size is `kellySize.constrainedShares` from the latest pipeline.
  - Enforce `minOrderSize` and 2-decimal rounding down, same as takers.
  - Per-market and per-event caps (`MAX_PER_MARKET_FRACTION`, `MAX_PER_EVENT_FRACTION`) from `config.ts` are enforced through the Kelly engine and exposure snapshots from `positions.ts`:
    - Caps are applied to **actual position value** (Data API `/positions`), not to the sum of open orders. Pending open makers do not count toward the event cap until they fill.

- **Out-of-model orders**
  - If we have a tracked maker order whose `tokenId` no longer appears in any `MakerOpportunity` in the latest pipeline:
    - **Treat as out-of-model** and **cancel**.
  - At the start of each evaluation cycle, we also bring under management any open CLOB maker orders whose `tokenId` matches a current `MakerOpportunity`, so they are subject to the same out-of-model and EV rules.

---

## Order Lifecycle Summary

This section describes what a **full run of the pipeline** means and how the phases fit together. In `src/index.ts`, one full run is a single invocation of `runCycle`. It is executed every `POLLING_INTERVAL_MS` (currently 15,000 ms = **15 seconds**).

### 1. Discovery & Market Data

- `discoverPolymarkets` (Gamma)
  - Fetch upcoming sports events/markets from the Polymarket Gamma API.
  - Filter by sport, time window, liquidity, etc.
  - Parse CLOB trading metadata (`clobTokenIds`, `conditionId`, `orderPriceMinTickSize`, `orderMinSize`, `negRisk`).
- `enrichMarketsWithClobQuotes`
  - For each market, fetch best bid/ask from the CLOB orderbook using `getOrderBook`.
  - Override Gamma prices with live CLOB quotes and derive complement prices for the second outcome.

### 2. Odds & Matching

- `fetchOddsForMarkets`
  - Fetch sharp sportsbook odds (via Odds API) for relevant sports and markets.
- `matchMarkets`
  - Match Polymarket markets to sportsbook events by teams, market type, and line (spreads/totals).
  - Produce `MatchedMarket[]` tying Polymarket markets to sportsbook markets.

### 3. Capital, Positions & Exposure

- `fetchWalletState`
  - Get USDC balance and other wallet info.
- `fetchCurrentPositions`
  - Fetch current positions from Polymarket Data API `/positions`.
- `fetchOpenOrders`
  - Fetch current open orders from CLOB `/data/orders` (both makers and any other orders).
- `buildExposureSnapshotsFromPositions`
  - Combine Gamma markets + positions to compute per-market and per-event exposure in USD.
- `setExposureFromSnapshot`
  - Load exposure snapshots into the Kelly engine (`calculator.ts`) so that `calculateKellySize` can enforce:
    - `MAX_PER_MARKET_FRACTION` and `MAX_PER_EVENT_FRACTION` based on **position value**.

- `computeCapitalSummary`
  - Compute:
    - USDC balance,
    - Total position value,
    - Total capital (USDC + position value),
    - Count of open orders (for reporting).

### 4. Analysis (Opportunities)

- `analyzeOpportunities(matched, totalCapitalUsd)`
  - For each matched market:
    - Compute fair probabilities from sportsbooks (Power/Shin for H2H, Probit for spreads/totals).
    - Compute EV for taker side(s) vs Polymarket asks.
    - Compute Kelly sizes using `calculateKellySize`, which:
      - Applies Kelly formula,
      - Respects per-market and per-event exposure limits based on current positions.
  - Output:
    - `TakerOpportunity[]` (only when EV ≥ `TAKER_MARGINS[...]`).
    - `MakerOpportunity[]` (only when maker EV ≥ `MAKER_MARGINS[...]` and price is inside the spread and competitive).
    - `matched` (full matched-market context).

### 5. Placement (Takers & Makers)

- **Takers (`executeTakers`)**
  - For each `TakerOpportunity`:
    - Adjust size for current shares: `sharesToBuy = max(0, kellyShares - currentShares)`.
    - Enforce `minOrderSize` and 2-decimal rounding down.
    - Place an FOK limit BUY at `polymarketAsk` via `executeTakerOrder`.
  - No residuals: orders either fill or are rejected.

- **Makers (`placeNewMakers`)**
  - For each `MakerOpportunity`:
    - Adjust size for current shares (positions only): `sharesToBuy = max(0, kellyShares - currentShares)`.
    - Enforce `minOrderSize` and 2-decimal rounding down.
    - Place a **GTC limit BUY** at `targetPrice` via `placeMakerOrder`.
    - On success, call `registerMakerOrder(orderId, maker, preview)` so the maker is tracked with `evAtPlacement`, size, price, and identifiers.

### 6. Monitoring & Evaluation (Maker Management)

- `evaluateExistingMakers`:
  - Fetch `openOrders` from CLOB.
  - Build a `tokenId → MakerOpportunity` map from current `MakerOpportunity[]`.
  - For **all** open maker orders whose `asset_id` matches a current `MakerOpportunity.tokenId`:
    - Call `registerMakerOrder` to bring them under management (including pre-existing orders).
  - Fetch live best bid/ask for all tracked maker `tokenId`s via `fetchBestPricesForTokens`.
  - Filter `MakerOpportunity[]` to exclude markets where current position already meets/exceeds the Kelly target.
  - Call `evaluateMakerOrders(currentMakers, openOrders, liveBestPrices)`:
    - For each managed maker order, decide:
      - `keep` (if EV ≥ `minEV`, EV drop ≤ `MAKER_EVAL_EV_DROP`, not outbid, and not yet fully satisfied), or
      - `cancel` (out-of-model, EV < `minEV`, EV dropped too much, outbid by ≥ 1 tick, or fully satisfied).
  - For each orderId in `cancelOrderIds`:
    - Call `cancelOrder` on the CLOB.
    - Remove from the maker registry with `removeMakerOrder`.

Any new or repriced makers for those markets will be placed in the **next cycle’s placement phase**, based on the latest `MakerOpportunity[]`.

### 7. Market State Handling

- `handleMarketStates`
  - Given markets and current time, cancel tracked maker orders in markets that have started or are closed.
  - Ensures we are not providing liquidity once the game is live/ended, per the gameplan.

### 8. Sleep & Repeat (Polling)

- After each `runCycle`:
  - The bot sleeps for `POLLING_INTERVAL_MS` (currently **15,000 ms = 15 seconds**).
  - Then it runs another full cycle:
    - Re-discover markets,
    - Recompute odds, EV, and Kelly,
    - Re-execute takers,
    - Re-place makers,
    - Re-evaluate all open makers.

This loop continues indefinitely (unless stopped), so every **15 seconds** we recompute our view of EV, sizes, and open orders and update the maker and taker orders to conform to these rules.

### Yes, a full run of steps 1–7 executes once per cycle; we run a new cycle every 15 seconds

## TODO / Future Refinements

- Exposure Neutralization / Hedging
  If you already hold shares of one side (Team A), and the opposite side (Team B) becomes available at any EV > 0%, execute a balancing trade.
  Behavior:
  • Buy Team B up to the same notional size as your Team A exposure (or until liquidity is exhausted).
  • This locks in a spread profit and closes the position early.
  • Once closed, release that capital and re-deploy to the next opportunity.
  Purpose:
  • Reduces variance / drawdown risk.
  • Converts open directional exposure into immediate profit.
  • Keeps bankroll fully active and compounding.
