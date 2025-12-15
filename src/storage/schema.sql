-- Table to track all wagers (Maker and Taker)
create table wagers (
  id serial primary key,
  order_id text not null unique,
  token_id text not null,
  market_slug text,
  event_slug text,
  sport text,
  market_type text,
  outcome int,  -- 1 or 2
  side text default 'BUY',
  order_type text not null, -- 'MAKER' or 'TAKER'
  price numeric not null,
  size_filled numeric default 0,
  ev_at_placement numeric,
  fair_prob_at_placement numeric,
  bookmakers_used jsonb, -- List of bookmakers used for EV calculation
  closing_fair_prob numeric, -- Updated at event start
  clv numeric, -- Closing Line Value: (closing_fair_prob - price) / price
  profit_loss numeric, -- Updated upon settlement
  created_at timestamptz default now(),
  event_start_time timestamptz
);

-- Index for looking up by order_id
create index idx_wagers_order_id on wagers(order_id);

-- Index for looking up by market_slug (useful for finding wagers for a specific market)
create index idx_wagers_market_slug on wagers(market_slug);

-- Table to track ACTIVE maker orders being managed by the bot
create table active_maker_orders (
  order_id text primary key,
  token_id text not null,
  market_slug text,
  event_slug text,
  sport text,
  market_type text,
  outcome int,
  target_price numeric,
  size numeric,
  ev_at_placement numeric,
  fair_prob_at_placement numeric,
  bookmakers_used jsonb,
  placed_at timestamptz default now(),
  event_start_time timestamptz
);

