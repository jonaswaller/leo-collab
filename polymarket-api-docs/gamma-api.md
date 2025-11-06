# --- POLYMARKET GAMMA API DOCS --- [SOME IMPORTANT DOCS FROM THEIR SITE, TELL ME IF YOU NEED MORE ENDPOINTS]

# --- Gamma Structure ---

Gamma provides some organizational models. These include events, and markets. The most fundamental element is always markets and the other models simply provide additional organization.
​
Detail
Market
Contains data related to a market that is traded on. Maps onto a pair of clob token ids, a market address, a question id and a condition id
Event
Contains a set of markets
Variants:
Event with 1 market (i.e., resulting in an SMP)
Event with 2 or more markets (i.e., resulting in an GMP)
​
Example
[Event] Where will Barron Trump attend College?
[Market] Will Barron attend Georgetown?
[Market] Will Barron attend NYU?
[Market] Will Barron attend UPenn?
[Market] Will Barron attend Harvard?
[Market] Will Barron attend another college?

# --- How to Fetch Markets ---

Both the getEvents and getMarkets are paginated. See pagination section for details.
This guide covers the three recommended approaches for fetching market data from the Gamma API, each optimized for different use cases.
​
Overview
There are three main strategies for retrieving market data:
By Slug - Best for fetching specific individual markets or events
By Tags - Ideal for filtering markets by category or sport
Via Events Endpoint - Most efficient for retrieving all active markets
​

1. Fetch by Slug
   Use Case: When you need to retrieve a specific market or event that you already know about.
   Individual markets and events are best fetched using their unique slug identifier. The slug can be found directly in the Polymarket frontend URL.
   ​
   How to Extract the Slug
   From any Polymarket URL, the slug is the path segment after /event/ or /market/:

Copy

Ask AI
https://polymarket.com/event/fed-decision-in-october?tid=1758818660485
↑
Slug: fed-decision-in-october
​
API Endpoints
For Events: GET /events/slug/
For Markets: GET /markets/slug/
​
Examples

Copy

Ask AI
curl "https://gamma-api.polymarket.com/events/slug/fed-decision-in-october"
​ 2. Fetch by Tags
Use Case: When you want to filter markets by category, sport, or topic.
Tags provide a powerful way to categorize and filter markets. You can discover available tags and then use them to filter your market requests.
​
Discover Available Tags
General Tags: GET /tags
Sports Tags & Metadata: GET /sports
The /sports endpoint returns comprehensive metadata for sports including tag IDs, images, resolution sources, and series information.
​
Using Tags in Market Requests
Once you have tag IDs, you can use them with the tag_id parameter in both markets and events endpoints.
Markets with Tags: GET /markets
Events with Tags: GET /events

Copy

Ask AI
curl "https://gamma-api.polymarket.com/events?tag_id=100381&limit=1&closed=false"

​
Additional Tag Filtering
You can also:
Use related_tags=true to include related tag markets
Exclude specific tags with exclude_tag_id
​ 3. Fetch All Active Markets
Use Case: When you need to retrieve all available active markets, typically for broader analysis or market discovery.
The most efficient approach is to use the /events endpoint and work backwards, as events contain their associated markets.
Events Endpoint: GET /events
Markets Endpoint: GET /markets
​
Key Parameters
order=id - Order by event ID
ascending=false - Get newest events first
closed=false - Only active markets
limit - Control response size
offset - For pagination
​
Examples

Copy

Ask AI
curl "https://gamma-api.polymarket.com/events?order=id&ascending=false&closed=false&limit=100"
This approach gives you all active markets ordered from newest to oldest, allowing you to systematically process all available trading opportunities.
​
Pagination
For large datasets, use pagination with limit and offset parameters:
limit=50 - Return 50 results per page
offset=0 - Start from the beginning (increment by limit for subsequent pages)
Pagination Examples:

Copy

Ask AI

# Page 1: First 50 results (offset=0)

curl "https://gamma-api.polymarket.com/events?order=id&ascending=false&closed=false&limit=50&offset=0"

Copy

Ask AI

# Page 2: Next 50 results (offset=50)

curl "https://gamma-api.polymarket.com/events?order=id&ascending=false&closed=false&limit=50&offset=50"

Copy

Ask AI

# Page 3: Next 50 results (offset=100)

curl "https://gamma-api.polymarket.com/events?order=id&ascending=false&closed=false&limit=50&offset=100"

Copy

Ask AI

# Paginating through markets with tag filtering

curl "https://gamma-api.polymarket.com/markets?tag_id=100381&closed=false&limit=25&offset=0"

Copy

Ask AI

# Next page of markets with tag filtering

curl "https://gamma-api.polymarket.com/markets?tag_id=100381&closed=false&limit=25&offset=25"
​
Best Practices
For Individual Markets: Always use the slug method for best performance
For Category Browsing: Use tag filtering to reduce API calls
For Complete Market Discovery: Use the events endpoint with pagination
Always Include closed=false: Unless you specifically need historical data
Implement Rate Limiting: Respect API limits for production applications
​
Related Endpoints
Get Markets - Full markets endpoint documentation
Get Events - Full events endpoint documentation
Search Markets - Search functionality

# --- List teams ---

GET
/
teams

Try it
Query Parameters
​
limit
integer
Required range: x >= 0
​
offset
integer
Required range: x >= 0
​
order
string
Comma-separated list of fields to order by

​
ascending
boolean
​
league
string[]
​
name
string[]
​
abbreviation
string[]
Response
200 - application/json
List of teams

​
id
integer
​
name
string | null
​
league
string | null
​
record
string | null
​
logo
string | null
​
abbreviation
string | null
​
alias
string | null
​
createdAt
string<date-time> | null
​
updatedAt
string<date-time> | null
Health check

# --- Get sports metadata information ---

Retrieves metadata for various sports including images, resolution sources, ordering preferences, tags, and series information. This endpoint provides comprehensive sport configuration data used throughout the platform.

GET
/
sports

Try it
Response
200 - application/json
List of sports metadata objects containing sport configuration details, visual assets, and related identifiers

​
sport
string
The sport identifier or abbreviation

​
image
string<uri>
URL to the sport's logo or image asset

​
resolution
string<uri>
URL to the official resolution source for the sport (e.g., league website)

​
ordering
string
Preferred ordering for sport display, typically "home" or "away"

​
tags
string
Comma-separated list of tag IDs associated with the sport for categorization and filtering

​
series
string
Series identifier linking the sport to a specific tournament or season series

# --- List events ---

GET
/
events

Try it
Query Parameters
​
limit
integer
Required range: x >= 0
​
offset
integer
Required range: x >= 0
​
order
string
Comma-separated list of fields to order by

​
ascending
boolean
​
id
integer[]
​
slug
string[]
​
tag_id
integer
​
exclude_tag_id
integer[]
​
related_tags
boolean
​
featured
boolean
​
cyom
boolean
​
include_chat
boolean
​
include_template
boolean
​
recurrence
string
​
closed
boolean
​
start_date_min
string<date-time>
​
start_date_max
string<date-time>
​
end_date_min
string<date-time>
​
end_date_max
string<date-time>
Response
200 - application/json
List of events

​
id
string
​
ticker
string | null
​
slug
string | null
​
title
string | null
​
subtitle
string | null
​
description
string | null
​
resolutionSource
string | null
​
startDate
string<date-time> | null
​
creationDate
string<date-time> | null
​
endDate
string<date-time> | null
​
image
string | null
​
icon
string | null
​
active
boolean | null
​
closed
boolean | null
​
archived
boolean | null
​
new
boolean | null
​
featured
boolean | null
​
restricted
boolean | null
​
liquidity
number | null
​
volume
number | null
​
openInterest
number | null
​
sortBy
string | null
​
category
string | null
​
subcategory
string | null
​
isTemplate
boolean | null
​
templateVariables
string | null
​
published_at
string | null
​
createdBy
string | null
​
updatedBy
string | null
​
createdAt
string<date-time> | null
​
updatedAt
string<date-time> | null
​
commentsEnabled
boolean | null
​
competitive
number | null
​
volume24hr
number | null
​
volume1wk
number | null
​
volume1mo
number | null
​
volume1yr
number | null
​
featuredImage
string | null
​
disqusThread
string | null
​
parentEvent
string | null
​
enableOrderBook
boolean | null
​
liquidityAmm
number | null
​
liquidityClob
number | null
​
negRisk
boolean | null
​
negRiskMarketID
string | null
​
negRiskFeeBips
integer | null
​
commentCount
integer | null
​
imageOptimized
object
Show child attributes

​
iconOptimized
object
Show child attributes

​
featuredImageOptimized
object
Show child attributes

​
subEvents
string[] | null
​
markets
object[]
Show child attributes

​
series
object[]
Show child attributes

​
categories
object[]
Show child attributes

​
collections
object[]
Show child attributes

​
tags
object[]
Show child attributes

​
cyom
boolean | null
​
closedTime
string<date-time> | null
​
showAllOutcomes
boolean | null
​
showMarketImages
boolean | null
​
automaticallyResolved
boolean | null
​
enableNegRisk
boolean | null
​
automaticallyActive
boolean | null
​
eventDate
string | null
​
startTime
string<date-time> | null
​
eventWeek
integer | null
​
seriesSlug
string | null
​
score
string | null
​
elapsed
string | null
​
period
string | null
​
live
boolean | null
​
ended
boolean | null
​
finishedTimestamp
string<date-time> | null
​
gmpChartMode
string | null
​
eventCreators
object[]
Show child attributes

​
tweetCount
integer | null
​
chats
object[]
Show child attributes

​
featuredOrder
integer | null
​
estimateValue
boolean | null
​
cantEstimate
boolean | null
​
estimatedValue
string | null
​
templates
object[]
Show child attributes

​
spreadsMainLine
number | null
​
totalsMainLine
number | null
​
carouselMap
string | null
​
pendingDeployment
boolean | null
​
deploying
boolean | null
​
deployingTimestamp
string<date-time> | null
​
scheduledDeploymentTimestamp
string<date-time> | null
​
gameStatus
string | null

# --- event by id, tags, or slug ---

curl --request GET \
 --url https://gamma-api.polymarket.com/events/{id}

curl --request GET \
 --url https://gamma-api.polymarket.com/events/{id}/tags

curl --request GET \
 --url https://gamma-api.polymarket.com/events/slug/{slug}

# --- List markets ---

GET
/
markets

Try it
Query Parameters
​
limit
integer
Required range: x >= 0
​
offset
integer
Required range: x >= 0
​
order
string
Comma-separated list of fields to order by

​
ascending
boolean
​
id
integer[]
​
slug
string[]
​
clob_token_ids
string[]
​
condition_ids
string[]
​
market_maker_address
string[]
​
liquidity_num_min
number
​
liquidity_num_max
number
​
volume_num_min
number
​
volume_num_max
number
​
start_date_min
string<date-time>
​
start_date_max
string<date-time>
​
end_date_min
string<date-time>
​
end_date_max
string<date-time>
​
tag_id
integer
​
related_tags
boolean
​
cyom
boolean
​
uma_resolution_status
string
​
game_id
string
​
sports_market_types
string[]
​
rewards_min_size
number
​
question_ids
string[]
​
include_tag
boolean
​
closed
boolean
Response
200 - application/json
List of markets

​
id
string
​
question
string | null
​
conditionId
string
​
slug
string | null
​
twitterCardImage
string | null
​
resolutionSource
string | null
​
endDate
string<date-time> | null
​
category
string | null
​
ammType
string | null
​
liquidity
string | null
​
sponsorName
string | null
​
sponsorImage
string | null
​
startDate
string<date-time> | null
​
xAxisValue
string | null
​
yAxisValue
string | null
​
denominationToken
string | null
​
fee
string | null
​
image
string | null
​
icon
string | null
​
lowerBound
string | null
​
upperBound
string | null
​
description
string | null
​
outcomes
string | null
​
outcomePrices
string | null
​
volume
string | null
​
active
boolean | null
​
marketType
string | null
​
formatType
string | null
​
lowerBoundDate
string | null
​
upperBoundDate
string | null
​
closed
boolean | null
​
marketMakerAddress
string
​
createdBy
integer | null
​
updatedBy
integer | null
​
createdAt
string<date-time> | null
​
updatedAt
string<date-time> | null
​
closedTime
string | null
​
wideFormat
boolean | null
​
new
boolean | null
​
mailchimpTag
string | null
​
featured
boolean | null
​
archived
boolean | null
​
resolvedBy
string | null
​
restricted
boolean | null
​
marketGroup
integer | null
​
groupItemTitle
string | null
​
groupItemThreshold
string | null
​
questionID
string | null
​
umaEndDate
string | null
​
enableOrderBook
boolean | null
​
orderPriceMinTickSize
number | null
​
orderMinSize
number | null
​
umaResolutionStatus
string | null
​
curationOrder
integer | null
​
volumeNum
number | null
​
liquidityNum
number | null
​
endDateIso
string | null
​
startDateIso
string | null
​
umaEndDateIso
string | null
​
hasReviewedDates
boolean | null
​
readyForCron
boolean | null
​
commentsEnabled
boolean | null
​
volume24hr
number | null
​
volume1wk
number | null
​
volume1mo
number | null
​
volume1yr
number | null
​
gameStartTime
string | null
​
secondsDelay
integer | null
​
clobTokenIds
string | null
​
disqusThread
string | null
​
shortOutcomes
string | null
​
teamAID
string | null
​
teamBID
string | null
​
umaBond
string | null
​
umaReward
string | null
​
fpmmLive
boolean | null
​
volume24hrAmm
number | null
​
volume1wkAmm
number | null
​
volume1moAmm
number | null
​
volume1yrAmm
number | null
​
volume24hrClob
number | null
​
volume1wkClob
number | null
​
volume1moClob
number | null
​
volume1yrClob
number | null
​
volumeAmm
number | null
​
volumeClob
number | null
​
liquidityAmm
number | null
​
liquidityClob
number | null
​
makerBaseFee
integer | null
​
takerBaseFee
integer | null
​
customLiveness
integer | null
​
acceptingOrders
boolean | null
​
notificationsEnabled
boolean | null
​
score
integer | null
​
imageOptimized
object
Show child attributes

​
iconOptimized
object
Show child attributes

​
events
object[]
Show child attributes

​
categories
object[]
Show child attributes

​
tags
object[]
Show child attributes

​
creator
string | null
​
ready
boolean | null
​
funded
boolean | null
​
pastSlugs
string | null
​
readyTimestamp
string<date-time> | null
​
fundedTimestamp
string<date-time> | null
​
acceptingOrdersTimestamp
string<date-time> | null
​
competitive
number | null
​
rewardsMinSize
number | null
​
rewardsMaxSpread
number | null
​
spread
number | null
​
automaticallyResolved
boolean | null
​
oneDayPriceChange
number | null
​
oneHourPriceChange
number | null
​
oneWeekPriceChange
number | null
​
oneMonthPriceChange
number | null
​
oneYearPriceChange
number | null
​
lastTradePrice
number | null
​
bestBid
number | null
​
bestAsk
number | null
​
automaticallyActive
boolean | null
​
clearBookOnStart
boolean | null
​
chartColor
string | null
​
seriesColor
string | null
​
showGmpSeries
boolean | null
​
showGmpOutcome
boolean | null
​
manualActivation
boolean | null
​
negRiskOther
boolean | null
​
gameId
string | null
​
groupItemRange
string | null
​
sportsMarketType
string | null
​
line
number | null
​
umaResolutionStatuses
string | null
​
pendingDeployment
boolean | null
​
deploying
boolean | null
​
deployingTimestamp
string<date-time> | null
​
scheduledDeploymentTimestamp
string<date-time> | null
​
rfqEnabled
boolean | null
​
eventStartTime
string<date-time> | null

# --- markets by id, tags, or slug ---

curl --request GET \
 --url https://gamma-api.polymarket.com/markets/{id}

curl --request GET \
 --url https://gamma-api.polymarket.com/markets/{id}/tags

curl --request GET \
 --url https://gamma-api.polymarket.com/markets/slug/{slug}
