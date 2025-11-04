# Polymarket Copy-Trading Bot

A TypeScript bot that automatically mirrors trades from any Polymarket profile with configurable position sizing.

## Quick Start

1. **Install dependencies** (already done):
   ```bash
   npm install
   ```

2. **Configure your wallet**:
   Edit `.env` and replace `PRIVATE_KEY` with your EOA private key:
   ```
   PRIVATE_KEY=0xYOUR_ACTUAL_PRIVATE_KEY_HERE
   ```

3. **Set target trader** (optional):
   Change `TARGET_HANDLE` in `.env` to the profile you want to copy:
   ```
   TARGET_HANDLE=RN1
   ```

4. **Run the bot**:
   ```bash
   npm start
   ```

## Prerequisites

- Node.js installed
- EOA wallet with USDC on Polygon
- USDC approval for Polymarket contracts (bot will guide you if needed)

## Configuration

All settings are in `.env`:

| Variable | Description | Default |
|----------|-------------|---------|
| `PRIVATE_KEY` | Your EOA private key | **REQUIRED** |
| `TARGET_HANDLE` | Profile to copy-trade | RN1 |
| `MAX_NOTIONAL_USDC` | Max $ per trade | 5 |
| `POLL_INTERVAL_MS` | Polling frequency | 3000 |
| `ALLOW_BUYS` | Enable buy mirroring | true |
| `ALLOW_SELLS` | Enable sell mirroring | true |

## How It Works

1. Resolves target handle → wallet address
2. Polls their trades every 3 seconds
3. For each new trade:
   - Fetches order book constraints (tick size, min order)
   - Calculates position size (max $5)
   - Places mirror order if constraints are met
4. Deduplicates by transaction hash

## Safety Features

- **$5 cap per trade**: Prevents oversized positions during testing
- **Min order validation**: Skips trades that can't meet exchange minimums
- **Tick size compliance**: Rounds prices to valid increments
- **Deduplication**: Never places the same trade twice
- **Side filtering**: Optionally disable buys or sells

## Example Output

```
Following RN1 at 0x1234...5678
[TARGET] BUY 100 @ 0.52 | will-trump-win-2024
[MIRROR] BUY token=0xabc...def size=9.615 price=0.52 (orderId=12345)
[TARGET] SELL 50 @ 0.48 | will-trump-win-2024
[SKIP] SELL $5 cap not enough to meet min order/tick constraints or disabled by config
```

## Troubleshooting

- **"No proxyWallet found"**: Check that `TARGET_HANDLE` is correct
- **"Invalid tick" errors**: The bot fetches tick size automatically; check logs
- **No trades appearing**: Target may not have recent activity; wait or try another profile
- **Insufficient funds**: Ensure your wallet has USDC on Polygon

## Next Steps

Once you've tested with $5 trades:
- Increase `MAX_NOTIONAL_USDC` for larger positions
- Add WebSocket support for real-time updates
- Implement dry-run mode for testing
- Add market blocklist for specific markets

## Documentation References

- [CLOB Client Docs](https://docs.polymarket.com)
- [Place Order API](https://docs.polymarket.com)
- [Data API Trades](https://docs.polymarket.com)
- [Gamma Search API](https://docs.polymarket.com)
