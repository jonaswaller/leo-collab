# Tentative Gameplan

## Everything here is up for debate / change if you give me a better solution, but the following is pretty well thought out

## Ignore /scrips folder

## A masterful understanding of polymarket-api-docs (see folder in my root) is crucial for this implementation. Anytime you are not 100% sure about something Polymarket-related, ask me or consult the files in that folder.

# IMPORTANT NOTE: For each of these steps you implement, we'll want to CHECK OUR WORK.

# IMPORTANT NOTE: Eventually, we will optimize for LATENCY, so keep that in mind as you build this. Nothing should be too slow.

# IMPORTANT NOTE: Always refer to maker-taker-rules.md for specifics

KEY POLYMARKET API INSIGHTS
Three APIs we'll use:

Gamma API (market discovery) - you're already using this in discovery.ts
CLOB API (order execution) - this is what we need to build
Data API (optional - for historical data/CLV tracking)
Critical fields from Gamma API we're NOT capturing yet:

clobTokenIds - REQUIRED for placing orders (it's a stringified array like ["123","456"])
negRisk - affects order execution (neg-risk markets work differently)
orderPriceMinTickSize - tick size (usually 0.001)
orderMinSize - minimum shares (you said 5, but this varies by market)
condition_id - needed for some CLOB operations
Rate limits to respect:

Gamma /events: 100 req/10s (you're good here)
Gamma /markets: 125 req/10s
CLOB POST /order: 240/s burst, 40/s sustained
CLOB DELETE /order: 240/s burst, 40/s sustained
THE REFINED GAMEPLAN

### PHASE 1: Market Metadata Enhancement (Day 1)

1. Upgrade Discovery Module

Modify discovery.ts to capture from Gamma API:
clobTokenIds (parse the JSON string to get token IDs)
negRisk boolean
orderPriceMinTickSize (tick size)
orderMinSize (minimum order size)
condition_id (for CLOB operations)
Add these fields to PolymarketMarket type in types.ts
This is a prerequisite for everything else - can't trade without token IDs 2. Add Market Slug Fetcher (for individual market updates) (HOLD OFF UNTIL PHASE 4)

When you need fresh data on a specific market (e.g., to check if your order is still +EV):
Use GET /markets/slug/{slug} instead of fetching all events
Much faster and cheaper on rate limits
Returns same data structure with updated prices

### PHASE 2: CLOB Client Setup (Day 2)

3. Initialize CLOB Client

Use @polymarket/clob-client package (already in your package.json)
Initialize with:
PRIVATE_KEY (your wallet private key)
PROXY_WALLET (your proxy wallet address)
SIGNATURE_TYPE=2 (EOA-linked proxy, as you have in .env)
CHAIN_ID=137 (Polygon)
Test: Can you read your wallet balance? Can you fetch your open orders? 4. Wallet Balance Module

Fetch USDC balance from Polygon (via CLOB client or direct RPC)
Fetch current positions: GET /data/positions (CLOB API)
Calculate available capital:
Available = USDC Balance - Sum(Position Values) - Sum(Open Order Values)
This replaces your hardcoded BANKROLL_USD = 1000 5. Position Tracker

Fetch all open positions from CLOB API
Structure: { marketSlug, tokenId, shares, avgEntryPrice, currentValue }
Update Kelly limits based on existing exposure
Refresh every cycle (30-60s)

### PHASE 3: Order Execution (Days 3-4)

6. Taker Order Module

Input: TakerOpportunity (with token IDs from Phase 1)
Place limit order via CLOB:
POST /order
{
tokenID: opportunity.tokenId,
price: opportunity.polymarketAsk,
size: opportunity.kellySize.constrainedShares,
side: "BUY"
}
Wait 2-3 seconds
Check order status: GET /order/{orderID}
If status === "LIVE" (not filled): cancel via DELETE /order/{orderID}
If status === "MATCHED" (fully filled): update position tracker
If partially filled: keep shares, cancel remainder 7. Maker Order Module

Input: MakerOpportunity (with token IDs)
Place limit bid:
POST /order
{
tokenID: opportunity.tokenId,
price: opportunity.targetPrice,
size: opportunity.kellySize.constrainedShares,
side: "BUY"
}
Store order metadata: { orderId, marketSlug, tokenId, price, size, timestamp, evAtPlacement }
Don't wait for fill - these sit on the book
Return order ID for tracking 8. Order Status Monitor

Every 30s, fetch all open orders: GET /orders (filtered by your address)
For each order:
If status === "MATCHED": update position tracker, remove from tracking
If status === "LIVE": keep tracking (we'll check EV in next phase)
If status === "CANCELLED": remove from tracking

### PHASE 4: Dynamic Order Management (Days 5-6)

9. Maker Order Evaluator

For each open maker order:
v1 (simpler): Use the latest full pipeline outputs and just filter for that marketSlug when evaluating maker orders.
Compare: currentEV vs evAtPlacement
Decision logic:
If currentEV < 3% OR currentEV < evAtPlacement - 2%: cancel order
If price needs to move >1 tick to stay competitive: cancel and repost
If currentEV > evAtPlacement + 0.5% AND Kelly wants more size: place additional order
Cancel via: DELETE /order/{orderID}
Repost via: POST /order (same as step 7) 10. Batch Order Operations (optimization)

If you need to cancel multiple orders: use DELETE /orders (batch cancel)
If you need to place multiple orders: use POST /orders (batch create)
Saves on rate limits and is faster

ALSO, WE NEED MAKER ORDERS CANCELLED IF THEY ARE NO LONGER THE BEST PRCIE ON THE MARKET

### PHASE 5: Main Loop (Day 7) 11. Adaptive Polling Loop (WE WANT QUICKER FREQUENCY FOR EVENTS THAT ARE LESS FAR OUT)

while (true):
// 1. Discover markets
markets = await discoverPolymarkets()

// 2. Fetch odds
odds = await fetchOddsForMarkets(markets)

// 3. Match
matched = matchMarkets(markets, odds)

// 4. Analyze
opportunities = analyzeOpportunities(matched)

// 5. Execute takers (immediate)
for (taker in opportunities.takers):
if (taker.ev > TAKER_MIN_EV):
await executeTakerOrder(taker)

// 6. Place new maker orders
for (maker in opportunities.makers):
if (maker.ev > MAKER_MIN_EV):
await placeMakerOrder(maker)

// 7. Evaluate existing maker orders
await evaluateOpenMakerOrders()

// 8. Update positions
await updatePositionTracker()

// 9. Sleep based on time-to-game
await adaptiveSleep(markets) 12. Adaptive Sleep Logic

minTimeToGame = min(market.startTime - now for market in markets)

if minTimeToGame < 2 hours:
sleep(15 seconds)
elif minTimeToGame < 12 hours:
sleep(60 seconds)
else:
sleep(5 minutes) 13. Market State Handler

Check market.closed and market.active from Gamma API
Pre-game (active=true, closed=false): normal trading
Live (active=true, closed=false, but game started): cancel all orders for this market
Closed (closed=true): stop trading, wait for resolution
Resolved (check via CLOB API): redeem winning shares via POST /redeem or similar

NOTES:

- For market making, and someone fills half the order, we want to leave it up until it's all filled if it's still at a good price.
- By "all filled", I mean (Kelly Sizing - Current Shares)
- If it's at a bad price, then obviously take it down

TO-DO

- MAKE A GROUND TRUTH "RULES" file with all our "RULES" like the statement above and the existing maker-management stuff

### PHASE 6: Auto-Redemption (Day 8) 14. Resolution Monitor

Periodically check resolved markets (maybe every 5 minutes)
For each resolved market where you have shares:
Check if you won (outcome matches your position)
If won: shares automatically convert to USDC (Polymarket does this)
Just need to update your position tracker to reflect the USDC is back
No explicit "redeem" call needed - Polymarket handles this automatically
PHASE 7: Data & Analytics (Days 9-10) 15. Database Schema

orders (
order_id, timestamp, market_slug, token_id, outcome, side,
price, size, status, fair_prob, ev, kelly_size,
bookmaker_odds_json, fill_timestamp, fill_price, fill_size
)

positions (
market_slug, token_id, outcome, shares, entry_price,
current_price, unrealized_pnl
)

markets (
market_slug, sport, event_title, start_time,
resolution_time, result, closing_price
)

performance (
date, total_pnl, num_trades, win_rate, avg_ev, avg_clv
) 16. Order Logger

On order placement: write to orders table with all context
On fill: update with fill details
On cancel: update status
On market resolution: calculate realized P&L 17. CLV Tracker

When market closes (game about to start):
Record "closing price" from Polymarket (last bestAsk before game)
Record "closing consensus" from sportsbooks (your last fair value)
Calculate: CLV = Entry Price - Closing Price
Aggregate by sport, market type, time-to-game
PHASE 8: Testing (Days 11-14) 18. Paper Trading Mode

Add PAPER_TRADING=true flag
Run everything but mock the CLOB API calls
Log what you WOULD have done
Validate: sizes, prices, EV calculations 19. Live Testing (Small Size)

Start with $100-200
Run for 2-3 days
Monitor fills, CLV, errors
Scale to full $1000 if all good 20. Performance Review

After 1 week: check win rate, ROI, CLV
Identify best sports/market types
Adjust Kelly multiplier if needed
CRITICAL POLYMARKET-SPECIFIC DETAILS
Token IDs:

Each outcome has a unique token ID (e.g., "123" for Yes, "456" for No)
You get these from clobTokenIds field in Gamma API
Format: "[\"123\",\"456\"]" (stringified JSON array)
Parse it: JSON.parse(market.clobTokenIds) → ["123", "456"]
Outcome 1 = tokenIds[0], Outcome 2 = tokenIds[1]
Neg-Risk Markets:

Some markets are "neg-risk" (negative risk)
These work differently - you can't lose more than you bet
Check negRisk field from Gamma API
Affects order execution (might need different order types)
Order Minimums:

Minimum order size varies by market (check orderMinSize)
Minimum is usually 5 shares, but can be higher
Your Kelly might say
3,butifminimumis10, you skip the trade
Tick Size:

Prices must be multiples of tick size (usually 0.001 = 0.1%)
Check orderPriceMinTickSize from Gamma API
Round your prices to nearest tick before placing orders
Rate Limits:

CLOB order placement: 40/s sustained (you'll never hit this)
Gamma /markets: 125 req/10s (be careful if fetching individual markets frequently)
Use batch operations when possible
UPDATED TIMELINE
Days 1-2: Phase 1-2 (metadata + CLOB setup)
Days 3-4: Phase 3 (order execution)
Days 5-6: Phase 4 (dynamic management)
Day 7: Phase 5 (main loop)
Day 8: Phase 6 (auto-redemption)
Days 9-10: Phase 7 (database)
Days 11-14: Phase 8 (testing)
Week 3+: Live trading
THE CRITICAL PATH (Must-Haves)
✅ Capture token IDs from Gamma API
✅ Capture tick size, min order size, neg-risk status
✅ Initialize CLOB client
✅ Wallet balance tracking
✅ Position tracking
✅ Taker execution (with token IDs)
✅ Maker execution (with token IDs)
✅ Order status monitoring
✅ Maker order evaluation & cancellation
✅ Main loop with adaptive polling
✅ Auto-redemption (or just track that USDC comes back)
✅ Database logging
Everything else is optimization.

Key difference from before: I now understand you need to parse clobTokenIds from Gamma API to get the actual token IDs for order placement. This is the missing link between your discovery phase and order execution. Without token IDs, you can't place orders. Period.

Sound good?

# TO-ADD

- ADAPTIVE MARGINS FOR GAMES A WEEK OUT BECAUSE WE'RE LESS SURE OF THE PRICE
