# For Odds API

Bookmakers
Bookmakers are segmented by region, which can be specified in an API request or in the add-on for Excel and Google Sheets. Regions include:

US Bookmakers
UK Bookmakers
EU Bookmakers
AU Bookmakers
New bookmakers are added periodically. Suggest new bookmakers (opens new window). These bookmakers are covered for moneyline odds markets.


#US Bookmakers
The API lists odds from the following US bookmakers:

Region key	Bookmaker key	Bookmaker	Note
us	betonlineag	BetOnline.ag (opens new window)	
us	betmgm	BetMGM (opens new window)	
us	betrivers	BetRivers (opens new window)	
us	betus	BetUS (opens new window)	
us	bovada	Bovada (opens new window)	
us	williamhill_us	Caesars (opens new window)	Only available on paid subscriptions
us	draftkings	DraftKings (opens new window)	
us	fanatics	Fanatics (opens new window)	Only available on paid subscriptions
us	fanduel	FanDuel (opens new window)	
us	lowvig	LowVig.ag (opens new window)	
us	mybookieag	MyBookie.ag (opens new window)	
us2	ballybet	Bally Bet (opens new window)	
us2	betanysports	BetAnything (opens new window)	Formerly BetAnySports
us2	betparx	betPARX (opens new window)	
us2	espnbet	ESPN BET (opens new window)	
us2	fliff	Fliff (opens new window)	
us2	hardrockbet	Hard Rock Bet (opens new window)	
us2	rebet	ReBet (opens new window)	Only available on paid subscriptions

#US Daily Fantasy Sports (DFS) Sites
The API covers player props from the following US DFS sites. Odds on DFS sites can vary based on user selections, therefore odds are indicative only.

Region key	Bookmaker key	Bookmaker	Note
us_dfs	pick6	DraftKings Pick6 (opens new window)	Selections with non-default multipliers (not x1) are included in _alternate markets
us_dfs	prizepicks	PrizePicks (opens new window)	Demons and goblins are included under _alternate markets, for example "player_points_alternate".
Goblins have been assigned the default odds, demons have been assigned even odds (+100).
us_dfs	underdog	Underdog Fantasy (opens new window)	Selections with non-default multipliers (not x1) are included in _alternate markets
#US Exchanges
Region key	Bookmaker key	Bookmaker	Note
us_ex	betopenly	BetOpenly (opens new window)	Use the "includeBetLimits" parameter to find open bets
us_ex	novig	Novig (opens new window)	
us_ex	prophetx	ProphetX (opens new window)	