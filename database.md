Key data to store:

wager ID (count from 1 uniquely)

Maker order or Taker Order

The Polymarket Market Type & the actual sport

Ev% and $ at placement

CLV (Our EV based on True Odds at event start) [only for pre match]

Profit/Loss

How many shares we actually get

--

Functionality notes:

- The additions / deletions of these wagers should flow with #maker-taker-functionality
- Only add filled maker orders (dont add open orders until they get filled because they might not get filled or get cancelled if lines moves)
- Obviously add all taker orders
