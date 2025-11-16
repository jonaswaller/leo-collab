## Maker & Taker Rules (Ground Truth)

This file defines the core execution rules for taker and maker orders. The code in `/src/arb` should conform to these rules.

---

## Taker Rules (Immediate Execution)

- **Taker definition**
  - A taker order is an order that is intended to execute immediately against the existing book (hit the ask / lift the offer), never improving the book. Taker orders should always be limit orders and canceled if they are not filled immediately for some reason.

- **Order type & slippage**
  - All taker orders are **limit orders**, never true market orders.
  - Use \*FAK\*\* (at specific price, if you can’t do this with FAK, use GTC and cancel it soon after) so:
    - Attempt to fill at full order size (Kelly Rec.), this will buy as many shares as available, then cancel the leftover order on the book. Remember, we don’t want to leave any take orders on the market; they are intended for immediate execution.
    - We never accept any price worse than our own limit → **no slippage**.

- **Price selection**
  - Baseline price is the **current Polymarket ask** for the target outcome.
  - The limit price must be:
    - ≤ our maximum acceptable price implied by EV / fair probability.
    - Aligned to market **tick size** (Gamma / CLOB `orderPriceMinTickSize`).

- **Size selection**
  - Base size comes from **Kelly sizing**: `kellySize.constrainedShares`. Minus our current shares of that market. If we have Kelly sizing rec. of 50 shares, and we already own 25 shares of that market selection, then we only want to buy 25 new shares.
  - Enforce market minimums:
    - Size must be ≥ `minOrderSize` from Gamma / CLOB.
  - Rounding:
    - Shares are rounded **down** to **2 decimal places**, consistent with official Polymarket order-building helpers.

- **EV / Kelly preconditions**
  - Only place taker orders when:
    - EV ≥ per-market-type **taker margin** (from `TAKER_MARGINS`).
    - Kelly-constrained size after exposure caps and minus current shares is strictly positive.

- **Status handling**
  - With FOK:
    - No need to poll / cancel for unfilled residuals; the CLOB either fills the order or rejects it.
  - In future, if we ever use GTD/FAK for takers:
    - We must poll `GET /data/order/{id}` for a short window and cancel LIVE orders that did not fully fill.

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
- These will be reposed during the next model run.
  - Otherwise, EV is acceptable and we may keep the order, subject to best-price rules below.
- Also cancel if the order cannot be matched to a maker opportunity, as it is considered out of model.

- **Best-price rules**
  - We treat an order as **outbid** when:
    - Someone posts a better bid at least **one tick** higher.
  - If outbid by ≥ one tick AND EV is still ≥ `minEV`:
    - **Action**: cancel existing order and **repost** at the new target price (computed from the latest analyzer, with fresh Kelly).
  - If outbid and EV has fallen below `minEV` or dropped more than 2%:
    - **Action**: cancel and DO NOT repost if below minEV, if dropped by more than 2% we will repost if still above minEV, just with new Kelly shares.

- **Partial fills**
  - We consider a maker order "fully satisfied" when:
    - Filled shares reach the Kelly target for that cycle:
      - `filledShares ≥ kellyTargetShares
  - Rules:
    - If the order is **partially filled** and:
      - EV is still above thresholds, and
      - We are not badly outbid:
      - **Leave the remaining size live** until we reach the Kelly target.
    - If EV becomes bad (below `minEV` or >2% EV drop) or we are outbid by ≥ one tick and EV is no longer attractive:
      - **Cancel the remaining size**, even if partially filled, it will be reuploaded in next model run if it makes sense to do so (Still above minEV).

- **Size selection**
  - Base maker size is `kellySize.constrainedShares` from the latest pipeline.
  - Enforce `minOrderSize` and 2-decimal rounding down, same as takers.
  - Per-market and per-event caps (`MAX_PER_MARKET_FRACTION`, `MAX_PER_EVENT_FRACTION`) from `config.ts` are enforced through the Kelly engine and exposure snapshots from `positions.ts`.

- **Out-of-model orders**
  - If we have a tracked maker order whose `tokenId` no longer appears in any `MakerOpportunity` in the latest pipeline:
    - **Treat as out-of-model** and **cancel**.

---

## Order Lifecycle Summary

1. **Discovery & Analysis**
   - `discoverPolymarkets` → `fetchOddsForMarkets` → `matchMarkets` → `analyzeOpportunities`.
   - Produces `TakerOpportunity[]` and `MakerOpportunity[]` with EV and Kelly sizes based on total capital and exposure.

2. **Placement**
   - Takers:
     - Call `executeTakerOrder(taker)` (FAK limit BUY at `polymarketAsk` or better).
   - Makers:
     - Call `placeMakerOrder(maker)` (GTC limit BUY at `targetPrice`).
     - Immediately call `registerMakerOrder(orderId, maker, preview)` to record `evAtPlacement`, size, price, and identifiers.

3. **Monitoring & Evaluation**
   - Every cycle (e.g., 30–60 seconds pre-match):
     - Fetch open orders from CLOB.
     - Join open orders with tracked maker orders and current `MakerOpportunity[]`.
     - For each tracked maker order, run `evaluateMakerOrders` logic:
       - Decide `keep`, `cancel`, or `cancel_and_replace`.
     - Apply cancels and reposts via the CLOB client.

4. **Positions & Kelly**
   - `positions.ts` + Data API `/positions` maintain a current view of:
     - USDC balance,
     - Position market value,
     - Capital and exposure snapshots per market/event.
   - The Kelly engine uses this to:
     - Scale sizes,
     - Enforce per-market and per-event caps,
     - Adjust aggressiveness as the book evolves.

---

## TODO / Future Refinements

- Introduce time-based rules:
  - Tighten or loosen margins as time-to-game decreases (e.g., adaptive margins for games far out).
- Improve rate-limiting and retry strategies for Data API `/positions` and Gamma endpoints to avoid 429s.
  -Exposure Neutralization / Hedging
  If you already hold shares of one side (Team A), and the opposite side (Team B) becomes available at any EV > 0%, execute a balancing trade.
  Behavior:
  • Buy Team B up to the same notional size as your Team A exposure (or until liquidity is exhausted).
  • This locks in a spread profit and closes the position early.
  • Once closed, release that capital and re-deploy to the next opportunity.
  Purpose:
  • Reduces variance / drawdown risk.
  • Converts open directional exposure into immediate profit.
  • Keeps bankroll fully active and compounding.
