# Polymarket Copy-Trading Bot Specification

## Overview
A TypeScript bot that monitors a target Polymarket trader's activity and automatically mirrors their trades with configurable position sizing (max $5 per transaction for testing).

## Core Requirements

### Functional Requirements
1. **Profile Monitoring**: Track any Polymarket profile by handle (e.g., @RN1)
2. **Trade Mirroring**: Automatically replicate BUY and SELL actions on the same assets
3. **Position Sizing**: Cap each transaction at $5 (configurable) regardless of target's size
4. **Real-time Polling**: Continuously monitor target's trades within reasonable rate limits
5. **Direct Trading**: Use official TypeScript CLOB client without relayer

### Technical Requirements
1. **Language**: TypeScript
2. **API**: Polymarket official TypeScript CLOB client
3. **Network**: Polygon (Chain ID 137)
4. **Authentication**: EOA wallet with L2/EIP-712 signing
5. **Deployment**: Local execution

## Architecture

### Components
1. **Configuration Module** (`config.ts`)
   - Environment variable management
   - Trading parameters (max notional, poll interval)
   - API endpoints (CLOB, Data-API, Gamma)

2. **Client Module** (`clients.ts`)
   - CLOB client initialization
   - Wallet setup with ethers.js
   - Authentication handling

3. **Profile Resolution** (`gamma.ts`)
   - Handle → proxyWallet lookup via Gamma API
   - Public search integration

4. **Trade Monitoring** (`data.ts`)
   - Poll target's trades via Data-API
   - Filter by user and taker-only trades
   - Trade deduplication by transaction hash

5. **Order Book Module** (`book.ts`)
   - Fetch tick size and min order size per asset
   - Price rounding utilities
   - Order validation

6. **Trading Logic** (`trader.ts`)
   - Mirror trade execution
   - Position sizing with $5 cap
   - Min order size compliance
   - Tick size rounding

7. **Main Orchestrator** (`index.ts`)
   - Polling loop
   - Trade deduplication
   - Error handling and logging

## Data Flow
```
1. Resolve target handle → proxyWallet (Gamma API)
2. Poll trades for proxyWallet (Data-API)
3. For each new trade:
   a. Fetch order book constraints (CLOB API)
   b. Calculate position size (max $5)
   c. Validate against min order size
   d. Round price to tick size
   e. Place order via CLOB client
4. Deduplicate by transaction hash
5. Repeat polling at configured interval
```

## API Endpoints Used

### Gamma API
- **Public Search**: `/public-search?q={handle}`
  - Purpose: Resolve handle to proxyWallet address

### Data-API
- **Get Trades**: `/trades?user={wallet}&limit={n}&takerOnly=true`
  - Purpose: Fetch target's executed trades

### CLOB API
- **Get Book**: `/book?token_id={id}`
  - Purpose: Fetch tick size and min order size
- **Place Order**: Via CLOB client `createOrder()`
  - Purpose: Execute mirror trades

## Configuration Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| PRIVATE_KEY | string | required | EOA private key for trading |
| CLOB_HOST | string | https://clob.polymarket.com | CLOB API endpoint |
| DATA_API | string | https://data-api.polymarket.com | Data API endpoint |
| GAMMA_API | string | https://gamma-api.polymarket.com | Gamma API endpoint |
| CHAIN_ID | number | 137 | Polygon mainnet |
| TARGET_HANDLE | string | RN1 | Profile to copy-trade |
| MAX_NOTIONAL_USDC | number | 5 | Max $ per transaction |
| POLL_INTERVAL_MS | number | 3000 | Polling frequency |
| ALLOW_BUYS | boolean | true | Enable buy mirroring |
| ALLOW_SELLS | boolean | true | Enable sell mirroring |

## Order Placement Logic

### Position Sizing
```
1. notional = min(MAX_NOTIONAL_USDC, 5)
2. rawQty = notional / observedPrice
3. qty = floor(rawQty / minOrderSize) * minOrderSize
4. if qty < minOrderSize: skip trade
```

### Price Rounding
```
roundedPrice = round(price / tickSize) * tickSize
```

## Error Handling

### Scenarios
1. **Insufficient funds**: Log error, continue polling
2. **Min order size not met**: Skip trade, log reason
3. **API rate limits**: Exponential backoff (future enhancement)
4. **Network errors**: Log and retry on next poll
5. **Invalid handle**: Fail fast on startup

## Safety Features
1. **Max notional cap**: Prevents oversized positions
2. **Min order validation**: Ensures valid orders
3. **Tick size compliance**: Prevents rejected orders
4. **Deduplication**: Prevents duplicate trades
5. **Side filtering**: Optional disable of buys/sells

## Dependencies
- `@polymarket/clob-client`: Official CLOB client
- `ethers`: Wallet and signing
- `axios`: HTTP requests
- `dotenv`: Environment configuration
- `typescript`, `ts-node`: Development

## Future Enhancements
1. **WebSocket integration**: Real-time market updates
2. **Rate limit handling**: Exponential backoff on 429
3. **Dry run mode**: Test without placing orders
4. **Market blocklist**: Skip specific markets
5. **Price nudging**: Adjust price for marketability
6. **Multi-profile support**: Copy multiple traders
7. **Position limits**: Cap total exposure
8. **Profit/loss tracking**: Performance analytics

## Prerequisites
1. EOA wallet with USDC on Polygon
2. USDC approval for Polymarket contracts
3. Node.js and npm installed
4. Basic understanding of Polymarket mechanics

## Success Criteria
1. Bot successfully resolves target handle
2. Polls trades every 3 seconds without errors
3. Places orders that meet min size and tick constraints
4. Respects $5 max notional per trade
5. No duplicate trades executed
6. Graceful error handling and logging
