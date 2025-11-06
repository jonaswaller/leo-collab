# Odds API Documentation V4

https://the-odds-api.com/liveapi/guides/v4/

# Full list of sections

Overview
Host
GET sports
Endpoint
Parameters
Schema
Example Request
Example Response
Response Headers
Usage Quota Costs
GET odds
Endpoint
Parameters
Schema
Example Request
Example Response
Response Headers
Usage Quota Costs
More info
GET scores
Endpoint
Parameters
Schema
Example Request
Example Response
Response Headers
Usage Quota Costs
GET events
Endpoint
Parameters
Schema
Example Request
Example Response
Response Headers
Usage Quota Costs
GET event odds
Endpoint
Parameters
Schema
Example Request
Example Response
Response Headers
Usage Quota Costs
More info
GET event markets
Endpoint
Parameters
Schema
Example Request
Example Response
Response Headers
Usage Quota Costs
GET participants
Endpoint
Parameters
Schema
Example Request
Example Response
Response Headers
Usage Quota Costs
GET historical odds
Endpoint
Parameters
Schema
Example Request
Example Response
Response Headers
Usage Quota Costs
More info
GET historical events
Endpoint
Parameters
Schema
Example Request
Example Response
Response Headers
Usage Quota Costs
GET historical event odds
Endpoint
Parameters
Schema
Example Request
Example Response
Response Headers
Usage Quota Costs
More info
Rate Limiting (status code 429)
Code Samples
More Info

# Below are the 2 GETs I think are most relevant, though let me know if you'd like to see any other documentation

# --- GET Sports ---

Returns a list of in-season sport objects. The sport key can be used as the sport parameter in other endpoints. This endpoint does not count against the usage quota.

#Endpoint
GET /v4/sports/?apiKey={apiKey}

#Parameters
apiKey The API key associated with your subscription. See usage plans

all Optional - if this parameter is set to true (all=true), a list of both in and out of season sports will be returned

Try it out in the browser

https://api.the-odds-api.com/v4/sports/?apiKey=YOUR_API_KEY(opens new window)

Viewing JSON in the browser is easier with a prettifier such as JSON Viewer (opens new window)for Chrome

#Schema
For a detailed API spec, see the Swagger API docs(opens new window)

#Example Request
GET https://api.the-odds-api.com/v4/sports/?apiKey=YOUR_API_KEY(opens new window)

#Example Response
[
{
"key": "americanfootball_ncaaf",
"group": "American Football",
"title": "NCAAF",
"description": "US College Football",
"active": true,
"has_outrights": false
},
{
"key": "americanfootball_nfl",
"group": "American Football",
"title": "NFL",
"description": "US Football",
"active": true,
"has_outrights": false
},
{
"key": "americanfootball_nfl_super_bowl_winner",
"group": "American Football",
"title": "NFL Super Bowl Winner",
"description": "Super Bowl Winner 2021/2022",
"active": true,
"has_outrights": true
},
{
"key": "aussierules_afl",
"group": "Aussie Rules",
"title": "AFL",
"description": "Aussie Football",
"active": true,
"has_outrights": false
},
{
"key": "baseball_mlb",
"group": "Baseball",
"title": "MLB",
"description": "Major League Baseball",
"active": true,
"has_outrights": false
},
{
"key": "basketball_nba",
"group": "Basketball",
"title": "NBA",
"description": "US Basketball",
"active": true,
"has_outrights": false
},
{
"key": "cricket_test_match",
"group": "Cricket",
"title": "Test Matches",
"description": "International Test Matches",
"active": true,
"has_outrights": false
},
{
"key": "golf_masters_tournament_winner",
"group": "Golf",
"title": "Masters Tournament Winner",
"description": "2022 WInner",
"active": true,
"has_outrights": true
},
{
"key": "golf_the_open_championship_winner",
"group": "Golf",
"title": "The Open Winner",
"description": "2021 WInner",
"active": true,
"has_outrights": true
},
{
"key": "golf_us_open_winner",
"group": "Golf",
"title": "US Open Winner",
"description": "2021 WInner",
"active": true,
"has_outrights": true
},
{
"key": "icehockey_nhl",
"group": "Ice Hockey",
"title": "NHL",
"description": "US Ice Hockey",
"active": true,
"has_outrights": false
},
{
"key": "mma_mixed_martial_arts",
"group": "Mixed Martial Arts",
"title": "MMA",
"description": "Mixed Martial Arts",
"active": true,
"has_outrights": false
},
{
"key": "rugbyleague_nrl",
"group": "Rugby League",
"title": "NRL",
"description": "Aussie Rugby League",
"active": true,
"has_outrights": false
},
{
"key": "soccer_australia_aleague",
"group": "Soccer",
"title": "A-League",
"description": "Aussie Soccer",
"active": true,
"has_outrights": false
},
{
"key": "soccer_brazil_campeonato",
"group": "Soccer",
"title": "Brazil Série A",
"description": "Brasileirão Série A",
"active": true,
"has_outrights": false
},
{
"key": "soccer_denmark_superliga",
"group": "Soccer",
"title": "Denmark Superliga",
"description": "",
"active": true,
"has_outrights": false
},
{
"key": "soccer_finland_veikkausliiga",
"group": "Soccer",
"title": "Veikkausliiga - Finland",
"description": "",
"active": true,
"has_outrights": false
},
{
"key": "soccer_japan_j_league",
"group": "Soccer",
"title": "J League",
"description": "Japan Soccer League",
"active": true,
"has_outrights": false
},
{
"key": "soccer_league_of_ireland",
"group": "Soccer",
"title": "League of Ireland",
"description": "Airtricity League Premier Division",
"active": true,
"has_outrights": false
},
{
"key": "soccer_norway_eliteserien",
"group": "Soccer",
"title": "Eliteserien - Norway",
"description": "Norwegian Soccer",
"active": true,
"has_outrights": false
},
{
"key": "soccer_spain_segunda_division",
"group": "Soccer",
"title": "La Liga 2 - Spain",
"description": "Spanish Soccer",
"active": true,
"has_outrights": false
},
{
"key": "soccer_sweden_allsvenskan",
"group": "Soccer",
"title": "Allsvenskan - Sweden",
"description": "Swedish Soccer",
"active": true,
"has_outrights": false
},
{
"key": "soccer_sweden_superettan",
"group": "Soccer",
"title": "Superettan - Sweden",
"description": "Swedish Soccer",
"active": true,
"has_outrights": false
},
{
"key": "soccer_uefa_european_championship",
"group": "Soccer",
"title": "UEFA Euro 2020",
"description": "UEFA European Championship",
"active": true,
"has_outrights": false
},
{
"key": "soccer_usa_mls",
"group": "Soccer",
"title": "MLS",
"description": "Major League Soccer",
"active": true,
"has_outrights": false
},
{
"key": "tennis_atp_french_open",
"group": "Tennis",
"title": "ATP French Open",
"description": "Men's Singles",
"active": true,
"has_outrights": false
},
{
"key": "tennis_wta_french_open",
"group": "Tennis",
"title": "WTA French Open",
"description": "Women's Singles",
"active": true,
"has_outrights": false
}
]
#Response Headers
Calls to the /sports endpoint will not affect the quota usage. The following response headers are returned:

x-requests-remaining The usage credits remaining until the quota resets
x-requests-used The usage credits used since the last quota reset
x-requests-last The usage cost of the last API call
#Usage Quota Costs
This endpoint does not count against the usage quota.

# --- GET Odds ---

GET odds
Returns a list of upcoming and live games with recent odds for a given sport, region and market

#Endpoint
GET /v4/sports/{sport}/odds/?apiKey={apiKey}&regions={regions}&markets={markets}

#Parameters
sport The sport key obtained from calling the /sports endpoint. upcoming is always valid, returning any live games as well as the next 8 upcoming games across all sports

apiKey The API key associated with your subscription. See usage plans

regions Determines the bookmakers to be returned. For example, us, us2 (United States), uk (United Kingdom), au (Australia) and eu (Europe). Multiple regions can be specified if comma delimited. See the list of bookmakers by region.

markets Optional - Determines which odds market is returned. Defaults to h2h (head to head / moneyline). Valid markets are h2h (moneyline), spreads (points handicaps), totals (over/under) and outrights (futures). Multiple markets can be specified if comma delimited. spreads and totals markets are mainly available for US sports and bookmakers at this time. Each specified market costs 1 against the usage quota, for each region.

Lay odds are automatically included with h2h results for relevant betting exchanges (Betfair, Matchbook etc). These have a h2h_lay market key.

For sports with outright markets (such as Golf), the market will default to outrights if not specified. Lay odds for outrights (outrights_lay) will automatically be available for relevant exchanges.

For more info, see descriptions of betting markets.

dateFormat Optional - Determines the format of timestamps in the response. Valid values are unix and iso (ISO 8601). Defaults to iso.

oddsFormat Optional - Determines the format of odds in the response. Valid values are decimal and american. Defaults to decimal. When set to american, small discrepancies might exist for some bookmakers due to rounding errors.

eventIds Optional - Comma-separated game ids. Filters the response to only return games with the specified ids.

bookmakers Optional - Comma-separated list of bookmakers to be returned. If both bookmakers and regions are both specified, bookmakers takes priority. Bookmakers can be from any region. Every group of 10 bookmakers is the equivalent of 1 region. For example, specifying up to 10 bookmakers counts as 1 region. Specifying between 11 and 20 bookmakers counts as 2 regions.

commenceTimeFrom Optional - filter the response to show games that commence on and after this parameter. Values are in ISO 8601 format, for example 2023-09-09T00:00:00Z. This parameter has no effect if the sport is set to 'upcoming'.

commenceTimeTo Optional - filter the response to show games that commence on and before this parameter. Values are in ISO 8601 format, for example 2023-09-10T23:59:59Z. This parameter has no effect if the sport is set to 'upcoming'.

includeLinks Optional - if true, the response will include bookmaker links to events, markets, and betslips if available. Valid values are true or false

includeSids Optional - if true, the response will include source ids (bookmaker ids) for events, markets and outcomes if available. Valid values are true or false. This field can be useful to construct your own links to handle variations in state or mobile app links.

includeBetLimits Optional - if true, the response will include the bet limit of each betting option, mainly available for betting exchanges. Valid values are true or false

includeRotationNumbers Optional - if true, the response will include the home and away rotation numbers if available. See this link for details. Valid values are true or false.

Try it out in the browser

https://api.the-odds-api.com/v4/sports/upcoming/odds/?regions=...(opens new window)

Viewing JSON in the browser is easier with a prettifier such as JSON Viewer (opens new window)for Chrome

#Schema
For a detailed API spec, see the Swagger API docs (opens new window)

#Example Request
GET https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?apiKey=YOUR_API_KEY&regions=us&markets=h2h,spreads&oddsFormat=american(opens new window)

#Example Response
[
{
"id": "bda33adca828c09dc3cac3a856aef176",
"sport_key": "americanfootball_nfl",
"commence_time": "2021-09-10T00:20:00Z",
"home_team": "Tampa Bay Buccaneers",
"away_team": "Dallas Cowboys",
"bookmakers": [
{
"key": "unibet",
"title": "Unibet",
"last_update": "2021-06-10T13:33:18Z",
"markets": [
{
"key": "h2h",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": 240
},
{
"name": "Tampa Bay Buccaneers",
"price": -303
}
]
},
{
"key": "spreads",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": -109,
"point": 6.5
},
{
"name": "Tampa Bay Buccaneers",
"price": -111,
"point": -6.5
}
]
}
]
},
{
"key": "caesars",
"title": "Caesars",
"last_update": "2021-06-10T13:33:48Z",
"markets": [
{
"key": "h2h",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": 240
},
{
"name": "Tampa Bay Buccaneers",
"price": -278
}
]
},
{
"key": "spreads",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": -110,
"point": 6.5
},
{
"name": "Tampa Bay Buccaneers",
"price": -110,
"point": -6.5
}
]
}
]
},
{
"key": "sugarhouse",
"title": "SugarHouse",
"last_update": "2021-06-10T13:34:07Z",
"markets": [
{
"key": "h2h",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": 240
},
{
"name": "Tampa Bay Buccaneers",
"price": -305
}
]
},
{
"key": "spreads",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": -109,
"point": 6.5
},
{
"name": "Tampa Bay Buccaneers",
"price": -112,
"point": -6.5
}
]
}
]
},
{
"key": "draftkings",
"title": "DraftKings",
"last_update": "2021-06-10T13:33:26Z",
"markets": [
{
"key": "h2h",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": 240
},
{
"name": "Tampa Bay Buccaneers",
"price": -305
}
]
},
{
"key": "spreads",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": -109,
"point": 6.5
},
{
"name": "Tampa Bay Buccaneers",
"price": -112,
"point": -6.5
}
]
}
]
},
{
"key": "pointsbetus",
"title": "PointsBet (US)",
"last_update": "2021-06-10T13:36:20Z",
"markets": [
{
"key": "h2h",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": 230
},
{
"name": "Tampa Bay Buccaneers",
"price": -291
}
]
},
{
"key": "spreads",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": -110,
"point": 6.5
},
{
"name": "Tampa Bay Buccaneers",
"price": -110,
"point": -6.5
}
]
}
]
},
{
"key": "betonlineag",
"title": "BetOnline.ag",
"last_update": "2021-06-10T13:37:29Z",
"markets": [
{
"key": "h2h",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": 240
},
{
"name": "Tampa Bay Buccaneers",
"price": -286
}
]
},
{
"key": "spreads",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": -105,
"point": 6
},
{
"name": "Tampa Bay Buccaneers",
"price": -115,
"point": -6
}
]
}
]
},
{
"key": "betmgm",
"title": "BetMGM",
"last_update": "2021-06-10T13:32:45Z",
"markets": [
{
"key": "h2h",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": 225
},
{
"name": "Tampa Bay Buccaneers",
"price": -275
}
]
},
{
"key": "spreads",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": -110,
"point": 6.5
},
{
"name": "Tampa Bay Buccaneers",
"price": -110,
"point": -6.5
}
]
}
]
},
{
"key": "betrivers",
"title": "BetRivers",
"last_update": "2021-06-10T13:35:33Z",
"markets": [
{
"key": "h2h",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": 240
},
{
"name": "Tampa Bay Buccaneers",
"price": -305
}
]
},
{
"key": "spreads",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": -109,
"point": 6.5
},
{
"name": "Tampa Bay Buccaneers",
"price": -112,
"point": -6.5
}
]
}
]
},
{
"key": "fanduel",
"title": "FanDuel",
"last_update": "2021-06-10T13:33:23Z",
"markets": [
{
"key": "h2h",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": 225
},
{
"name": "Tampa Bay Buccaneers",
"price": -275
}
]
},
{
"key": "spreads",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": -110,
"point": 6.5
},
{
"name": "Tampa Bay Buccaneers",
"price": -110,
"point": -6.5
}
]
}
]
},
{
"key": "barstool",
"title": "Barstool Sportsbook",
"last_update": "2021-06-10T13:34:48Z",
"markets": [
{
"key": "h2h",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": 240
},
{
"name": "Tampa Bay Buccaneers",
"price": -305
}
]
},
{
"key": "spreads",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": -109,
"point": 6.5
},
{
"name": "Tampa Bay Buccaneers",
"price": -112,
"point": -6.5
}
]
}
]
},
{
"key": "bovada",
"title": "Bovada",
"last_update": "2021-06-10T13:35:51Z",
"markets": [
{
"key": "h2h",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": 240
},
{
"name": "Tampa Bay Buccaneers",
"price": -290
}
]
},
{
"key": "spreads",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": -110,
"point": 6.5
},
{
"name": "Tampa Bay Buccaneers",
"price": -110,
"point": -6.5
}
]
}
]
},
{
"key": "williamhill_us",
"title": "William Hill (US)",
"last_update": "2021-06-10T13:34:10Z",
"markets": [
{
"key": "h2h",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": 240
},
{
"name": "Tampa Bay Buccaneers",
"price": -280
}
]
},
{
"key": "spreads",
"outcomes": [
{
"name": "Dallas Cowboys",
"price": -110,
"point": 6.5
},
{
"name": "Tampa Bay Buccaneers",
"price": -110,
"point": -6.5
}
]
}
]
}
]
},
...
#Response Headers
The following response headers are returned

x-requests-remaining The usage credits remaining until the quota resets
x-requests-used The usage credits used since the last quota reset
x-requests-last The usage cost of the last API call
#Usage Quota Costs
The usage quota cost is 1 per region per market.

cost = [number of markets specified] x [number of regions specified]

Examples

1 market, 1 region
Cost: 1
Example /v4/sports/americanfootball_nfl/odds?markets=h2h&regions=us®...

3 markets, 1 region
Cost: 3
Example /v4/sports/americanfootball_nfl/odds?markets=h2h,spreads,totals&regions=us®...

1 market, 3 regions
Cost: 3
Example /v4/sports/soccer_epl/odds?markets=h2h&regions=us,uk,eu®...

3 markets, 3 regions
Cost: 9
Example: /v4/sports/basketball_nba/odds?markets=h2h,spreads,totals&regions=us,uk,au®...

Keeping track of quota usage

To keep track of usage credits, every API call includes the following response headers:

x-requests-remaining The usage credits remaining until the quota resets
x-requests-used The usage credits used since the last quota reset
x-requests-last The usage cost of the last API call
#More info
The list of events returned in the /odds endpoint mirrors events that are listed by major bookmakers. This usually includes games for the current round
Events may temporarily become unavailable after a round, before bookmakers begin listing the next round of games
Events may be unavailable if the sport is not in season. For popular sports, bookmakers may begin listing new season events a few months in advance
If no events are returned, the request will not count against the usage quota
To determine if an event is in-play, the commence_time can be used. If commence_time is less than the current time, the event is in-play. The /odds endpoint does not return completed events

# --- Rate Limits ---

EXCEEDED_FREQ_LIMIT
The request was rate-limited (HTTP status code 429). Reduce the number of API calls being sent concurrently by spacing out API calls over several seconds. The rate limit is currently 30 API calls per second.

There are a couple of reasons that 429s can occur:

If our system receives a large increase in traffic, it will take some time to scale up, usually in the order of minutes. Whilst this is happening, some requests might be knocked back with 429s.

If requests are sent at a rate close to the limit, some requests can still trigger rate limiting since our servers can receive requests at a different rate to which they are sent. For example, if you send 30 requests per second for 2 seconds, our servers might receive 25 requests in the first second, 33 in the next second (3 of which will be limited), and the remaining 2 requests after that. The rate at which our systems receive the requests will depend on network conditions, which are influenced by many factors outside of our control.

Both of these scenarios mean that 429s can occur sometimes, and they are more likely if requests are being sent close to the limit.

To handle a request that has been rate limited, consider retrying the request after a couple of seconds. Also avoid unnecessary API calls. For example, API calls to the sports or events endpoints can be made infrequently, since the responses don't change often.

#OUT_OF_USAGE_CREDITS
The usage credit limit of the subscription has been reached for the month.

Usage credits can be monitored by accessing the HTTP response headers, which are returned with every API call:

x-requests-remaining The usage credits remaining until the quota resets
x-requests-used The usage credits used since the last quota reset
x-requests-last The usage cost of the last API call
Usage can be tracked and subscriptions can be changed in the accounts portal (opens new window). If you have not already done so, you will need to create a new account, even if you have active subscriptions. A new account can be created here (opens new window).

#Troubleshooting Unexpected Usage
If usage is higher than expected, these tips might help identify the cause:

Be sure to familiarize yourself with usage quota costs of API calls. This will depend on the endpoint being called. Details and examples can be found in the "Usage Quota Costs" section of relevant endpoints in the docs.

If an unexpected increase in usage corresponds with recent code changes, check if a bug was recently added to your code.

Consider if you have any automated scripts running which may have been forgotten.

Your API key may have fallen into the hands of an unauthorized user. This can happen if the API key was committed to a public repository, or if it was used on the frontend of a public facing website. An API key can be regenerated in the accounts portal (opens new window).

#MISSING_REGION
The endpoint being called requires a regions query parameter, which specifies regions of bookmakers to be queried, for example &regions=us,uk

Alternatively the bookmakers parameter can be used, for example &bookmakers=draftkings,pinnacle

A list of valid bookmakers and regions can be found here.

#INVALID_REGION
One or more of the specified regions is invalid. A list of valid bookmaker regions can be found here.

Multiple comma-separated regions can be specified, for example

https://api.the-odds-api.com/v4/sports/soccer_epl/odds?apiKey=YOUR_API_KEY&markets=h2h&regions=uk,eu

#INVALID_BOOKMAKERS
The bookmakers parameter can be used as an alternative to the regions parameter. The bookmakers parameter is a comma-separated list of one or more bookmaker keys. A list of bookmaker keys can be found here.

Multiple comma-separated bookmaker keys can be specified. Bookmakers can be from any region, for example

https://api.the-odds-api.com/v4/sports/basketball_nba/odds?apiKey=YOUR_API_KEY&markets=h2h&bookmakers=draftkings,fanduel,pinnacle

#MISSING_MARKET
The endpoint being called requires a markets query parameter, which specifies betting markets to be queried. For most endpoints, this parameter is not required and will default to the h2h market.

#INVALID_MARKET
One or more of the markets being queried are invalid or unsupported by the endpoint being used. A list of valid market keys can be found here.

This error is commonly caused when non-featured markets are used with the odds or historical odds endpoints, which only support featured markets.

Non-featured markets, such as player props, period markets and alternate markets can be queried one event at a time using the event-odds or historical-event-odds endpoints.

For example, this will cause an error since player_points is a non-featured market, and the odds endpoint only accepts featured markets:

https://api.the-odds-api.com/v4/sports/basketball_nba/odds?apiKey=YOUR_API_KEY&regions=us&oddsFormat=american&markets=player_points

The events-odds endpoint accepts any markets. In this example, b308ed60cbb2d1324946c7289190cc88 was the event id of the Timberwolves @ Nuggets game on 2024-05-04. The event id will need to be replaced with a current event id, which can be obtained from the events endpoint.

https://api.the-odds-api.com/v4/sports/basketball_nba/events/b308ed60cbb2d1324946c7289190cc88/odds?apiKey=YOUR_API_KEY&regions=us&oddsFormat=american&markets=player_points

#INVALID_MARKET_COMBO
This error usually occurs if the sportKey represents an outrights (futures) event, in which case the valid market is outrights.

For example this will cause the error:

https://api.the-odds-api.com/v4/sports/americanfootball_nfl_super_bowl_winner/odds?apiKey=YOUR_API_KEY&regions=us&oddsFormat=american&markets=h2h

This is a valid combination

https://api.the-odds-api.com/v4/sports/americanfootball_nfl_super_bowl_winner/odds?apiKey=YOUR_API_KEY&regions=us&oddsFormat=american&markets=outrights

#INVALID_DATE_FORMAT
The specified dateFormat query parameter is invalid. For valid formats, see the "parameters" section for the relevant endpoint in the docs.

The dateFormat parameter is not required for most endpoints, and will default to iso (ISO8601).

#INVALID_ODDS_FORMAT
The specified oddsFormat query parameter is invalid. For valid formats, see the "parameters" section for the relevant endpoint in the docs.

If this parameter is missing, the oddsFormat will default to decimal.

#INVALID_ALL_SPORTS_PARAM
The all query parameter must be true or false.

This will likely be relevant for the sports endpoint.

#INVALID_SPORT
The sport path parameter is missing or invalid. A list of valid sport keys can be found here, or by called the sports endpoint.

#UNKNOWN_SPORT
The specified sport is not found. A list of valid sport keys can be found here, or by called the sports endpoint.

#INVALID_SCORES_DAYS_FROM
The daysFrom parameter must be an integer greater than or equal to 1, and less the maximum specified in the docs (see the "parameters" section of the relevant endpoint).

For example

https://api.the-odds-api.com/v4/sports/baseball_mlb/scores?apiKey=YOUR_API_KEY&daysFrom=2

#INVALID_EVENT_IDS
The eventIds query parameter is invalid. For endpoints that return a list of events, this parameter is used to filter the API response to specific events. This parameter must contain comma separated event ids, each of which is 32 characters in length.

Depending on the endpoint being queried, event ids can be found by calling the events endpoint or the historical events endpoint.

#INVALID_EVENT_ID
The event id parameter in the URL path is invalid. The event id must be 32 characters in length.

Depending on the endpoint being queried, event ids can be found by calling the events endpoint or the historical events endpoint.

For example, c163b5f5f4579c8293266956ccf3d9bd is the event id for Tampa Bay Rays @ Los Angeles Angels on 2024-04-09:

https://api.the-odds-api.com/v4/historical/sports/baseball_mlb/events/c163b5f5f4579c8293266956ccf3d9bd/odds?apiKey=YOUR_API_KEY&markets=totals_1st_5_innings&regions=us&oddsFormat=american&date=2024-04-08T15:10:00Z

#EVENT_NOT_FOUND
The event id specified in the URL path was not found. The most common cause is that the event has concluded. This error can also occur if the event id was not correctly specified.

#MISSING_HISTORICAL_TIMESTAMP
The date parameter is required when querying historical endpoints. This represents the timestamp of the historical snapshot to be queried. More information can be found for the relevant endpoint in the docs.

#INVALID_HISTORICAL_TIMESTAMP
The date parameter must be in ISO8601 format, for example:

https://api.the-odds-api.com/v4/historical/sports/baseball_mlb/odds?apiKey=YOUR_API_KEY&regions=us&markets=h2h,spreads&date=2024-04-30T12:45:00Z

#INVALID_COMMENCE_TIME_FROM
The commenceTimeFrom parameter must be in ISO8601 format, for example 2024-04-30T00:00:00Z

#INVALID_COMMENCE_TIME_TO
The commenceTimeTo parameter must be in ISO8601 format, for example 2024-04-30T23:59:59Z

#INVALID_COMMENCE_TIME_RANGE
The commenceTimeTo parameter must be later than commenceTimeFrom

#HISTORICAL_UNAVAILABLE_ON_FREE_USAGE_PLAN
Historical data is only accessible on paid usage plans.

Sample historical data can be found here.

#INVALID*PARTICIPANT_ID
The participant id is invalid. It must start with par*, for example par_01hqmkq6fceknv7cwebesgrx03

#INVALID_INCLUDE_LINKS
The includeLinks parameter determines whether links to bookmaker websites will be included in the API response.

If includeLinks is provided, it must be either true or false.

If includeLinks is not provided, it will default to false.

#INVALID_INCLUDE_SIDS
The includeSids parameter determines whether source ids (sids) will be included in the API response. An example of a sid includes a bookmaker's id for an event, market or betting selection.

If includeSids is provided, it must be either true or false.

If includeSids is not provided, it will default to false.

#INVALID_INCLUDE_BET_LIMITS
The includeBetLimits parameter determines whether a bookmaker's bet limits will be returned in each betting outcome in the API response.

If includeBetLimits is provided, it must be either true or false.

If includeBetLimits is not provided, it will default to false.

#INVALID_INCLUDE_MULTIPLIERS
The includeMultipliers parameter determines whether a betting outcome's multiplier is included in the the API response. This is only applicable to DFS sites (us_dfs region).

If includeMultipliers is provided, it must be either true or false.

If includeMultipliers is not provided, it will default to false.

#INVALID_INCLUDE_ROTATION_NUMBERS
The includeRotationNumbers parameter determines whether to include rotation numbers in the API response, if available.

If includeRotationNumbers is provided, it must be either true or false.

If includeRotationNumbers is not provided, it will default to false.

#HISTORICAL_MARKETS_UNAVAILABLE_AT_DATE
One or more of the requested market keys are not available at the timestamp of the "date" parameter. The specific market keys will be listed in the API's error message response.
