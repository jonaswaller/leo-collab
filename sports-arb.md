# --- Market-Maker Proxy: Sportsbook-Consensus → Polymarket (Prematch) ---

Totally—what your friend’s describing is a “market-maker proxy” play: use sharp sportsbook lines to estimate a fair probability (by removing their vig), then buy on Polymarket whenever its price (which equals market-implied probability) is off that fair by a chosen threshold before the game starts (“prematch”). Here’s how it actually works—and what to watch for.

## The idea in 6 steps

1. **Pull prematch odds** for the same market (same team/market scope and rules) from several books via an odds feed (e.g., The Odds API). ([The Odds API][1])
2. **Convert each book’s American odds → implied probabilities** for both sides (favorite/underdog). ([Action Network][2])
3. **Remove the vig (overround)** per book: scale the two implied probabilities so they sum to 100%. That yields **no-vig (fair) probabilities** for that book. ([Action Network][2])
4. **Combine books with weights** (e.g., 0.3 FanDuel, 0.3 DraftKings, 0.3 Pinnacle, 0.1 BetOnline) to get a **weighted consensus fair probability**. (Consensus/weighted aggregation is a standard approach; many data sites do this.) ([Sports Game Odds - API Data][3])
5. **Compare to Polymarket**: Polymarket’s mid price is a probability (e.g., 0.62 = 62%). If |Polymarket − weighted-fair| > 0.02 (your 2-point rule), buy the side closer to the weighted fair (or sell the opposite). ([Polymarket Documentation][4])
6. **Execute prematch** (before kickoff/first pitch), because your feed is prematch lines—not in-play. (Polymarket has lots of sports markets; prematch execution is feasible.) ([polymarket.com][5])

## Why it *could* work

* **Sportsbook lines are informative.** In particular, **Pinnacle’s closing line** is widely studied and considered very efficient; using sharp books in your blend can be a strong prior. (If anything, you might *up-weight* Pinnacle.) ([Pinnacle][6])
* **Polymarket charges no trading fee** (spreads/slippage still matter), so small edges aren’t instantly eaten by venue fees. ([Polymarket Documentation][7])

## The gotchas (be honest with yourselves)

* **2% is tight.** Your 2-point trigger has to clear: (a) Polymarket **bid-ask spread + slippage** and (b) **model error** from noisy/no-vig estimation. Mid prices on Polymarket are midpoints, not guaranteed fills. Consider a slightly higher threshold (e.g., 3–4 pts) until fills prove out. ([Polymarket Documentation][8])
* **Line efficiency improves toward close.** The farther you are from **closing lines**, the more dispersion you’ll see across books (your “edge”)—but also more noise. Beating **Pinnacle close** consistently is hard; use it as a sanity check for your model. ([Pinnacle][6])
* **Exact market matching is critical.** Rules must line up (e.g., moneyline includes OT? void rules? player props definitions?). A mismatch between sportsbook markets and Polymarket resolution criteria will fabricate “edge.” ([polymarket.com][5])
* **Data quality/latency.** Make sure your odds feed is timely and consistent (use the API; don’t scrape HTML). Track book-specific delays and update cadence. ([The Odds API][1])
* **Weighting scheme.** The 0.3/0.3/0.3/0.1 split is arbitrary. Justify weights (e.g., back-test MAE vs. event outcomes, or anchor to a “sharper” book like Pinnacle with higher weight). ([Sports Game Odds - API Data][3])

## A crisp formula (binary markets)

For each book (b):

1. Convert American odds to implied probs (p_b) and (1-p_b). ([Action Network][2])
2. Compute overround (R_b = p_{b,\text{home}} + p_{b,\text{away}}).
3. **No-vig**: (\tilde p_{b,\text{home}} = p_{b,\text{home}}/R_b,\ \tilde p_{b,\text{away}} = p_{b,\text{away}}/R_b). ([Sports Betting Dime][9])
4. **Weighted fair**: (\hat p = \sum_b w_b \tilde p_{b,\text{home}}) with (\sum_b w_b=1). (Away is (1-\hat p).) ([Sports Game Odds - API Data][3])
5. **Polymarket price** (P) ≈ market probability; **edge** (= \hat p - P). Trade if (|\hat p - P| > \tau) (threshold (\tau=0.02) or higher after testing). ([Polymarket Documentation][4])

## Practical checklist before you ship

* **Back-test** last season’s games: measure fill-adjusted PnL vs. thresholds (2, 3, 4 pts) and vs. different weightings.
* **Slippage model**: simulate fills against the *order book*, not the mid. (Polymarket shows mid; you pay the ask to buy.) ([Polymarket Documentation][8])
* **Market-rule harmonizer**: verify that sportsbook market = Polymarket resolution (team names, OT rules, push/void conditions). ([polymarket.com][5])
* **Ops**: use the **Odds API** for data (key management, rate limits), and Polymarket’s CLOB/WebSocket for live prices & execution. ([The Odds API][1])
* **Govern your weights**: consider a dynamic scheme that gives more weight to historically sharper/earlier-moving books (often Pinnacle), or to the book with tighter lines for that sport. ([Pinnacle][6])

## Bottom line

Your friend’s approach is **conceptually sound**: use (de-vigged) consensus sportsbook lines as an estimator of the “true” probability and buy mispricings on Polymarket. But **2% prematch** is probably too optimistic unless your fills and data are excellent. Start with back-tests, widen the trigger, and bias your weights toward proven “sharp” books. And always account for spread/slippage and exact market rules on Polymarket, whose displayed price is a probability but not a guaranteed execution level. ([Polymarket Documentation][4])



# --- Bet Sizing: The Kelly Criterion ---

The most widely respected method for bet sizing in situations like this is the **Kelly Criterion**. It is a mathematical formula that calculates the optimal fraction of your bankroll to bet on a particular opportunity to maximize long-term growth.[1][2][3][4][5]

The formula is as follows:
**f* = [(b * p) – q] / b**[1]

Where:
*   **f*** = The fraction of your bankroll to bet[1]
*   **b** = The decimal odds - 1[1]
*   **p** = Your calculated probability of winning[1]
*   **q** = The probability of losing (which is 1 - p)[1]

**Why it's smart for your strategy**:
*   **Optimal Growth**: It is mathematically designed to grow your bankroll at the fastest possible rate over the long term.[3]
*   **Risk Management**: The formula inherently manages risk. When your "edge" (the difference between your calculated probability and the market's) is small, it will tell you to bet a small amount. If your edge is large, it will recommend a larger bet.[2][5]

**Important Caveat: Fractional Kelly**
A "full" Kelly bet can sometimes recommend staking a very large and risky portion of your bankroll (e.g., over 20%). Because of this, many professional bettors use a **"Fractional Kelly"** approach (e.g., 1/2 Kelly or 1/4 Kelly). This means you would calculate the Kelly bet size and then only place a fraction of that recommended amount. This significantly reduces volatility and the risk of ruin while still ensuring you bet more on more valuable opportunities.[2]

### Handling Both Sides on Polymarket

On Polymarket, for every market, there are "Yes" shares and "No" shares. The price of a "Yes" share plus the price of a "No" share for the same outcome will always equal $1.00. This unique structure is central to how you'll approach arbitrage.[6][7][8][9]

**You will only bet on ONE side of the market for any given arbitrage opportunity.**

Here’s why:
*   **The Arbitrage is Uni-Directional**: Your friend's algorithm is designed to find a single, mispriced asset. For example, your weighted sportsbook data might say a team has a 70% chance of winning, but the "Yes" shares on Polymarket are trading at $0.60 (implying only a 60% chance).
*   **The Bet**: In this case, the value is in buying the undervalued "Yes" shares. You would *not* simultaneously buy the "No" shares, as they would be overpriced (trading at $0.40 when your data suggests they should be closer to $0.30).
*   **Hedging (Not Arbitrage)**: Buying both "Yes" and "No" shares in the same market at the same time is not arbitrage; it is essentially a way to lock in a small loss (due to the spread) or to hedge an existing position. The goal of your friend's algorithm is to find a discrepancy between Polymarket and *external* sources (the sportsbooks), not to trade against itself within Polymarket.

**In summary:**
1.  **Sizing**: Use a **Fractional Kelly Criterion** (e.g., Half Kelly) to determine your bet size. This provides a disciplined, mathematical approach that balances profit potential with risk management.
2.  **Execution**: Your algorithm should identify a mispricing in either the "Yes" or the "No" shares on Polymarket when compared to your calculated "true odds." You then place a single bet on that undervalued side. Never bet on both sides of the same market as part of the initial arbitrage trade.
