# For Odds API

The Odds API covers the betting markets listed below.

#Featured Betting Markets
These are the most common markets that are featured by bookmakers. Terminology for betting markets can vary by country, sport and even amongst bookmakers. We aim to simplify this by defining the following markets

Market Key
(use in the API) Market Names Description
h2h Head to head, Moneyline Bet on the winning team or player of a game (includes the draw for soccer)
spreads Points spread, Handicap The spreads market as featured by a bookmaker. Bet on the winning team after a points handicap has been applied to each team
totals Total points/goals, Over/Under The totals market as featured by a bookmaker. Bet on the total score of the game being above or below a threshold
outrights Outrights, Futures Bet on a final outcome of a tournament or competition
h2h_lay Same as h2h Bet against a h2h outcome. This market is only applicable to betting exchanges
outrights_lay Same as outrights Bet against an outrights outcome. This market is only applicable to betting exchanges

spreads and totals markets are mainly available for US sports and bookmakers at this time.

For descriptions of these markets, see examples of betting markets.

#Additional Markets
Starting in 2023, more markets are becoming available in the API. Additional markets are currently limited to US sports and selected bookmakers, however coverage is expanding. Additional markets update at 1 minute intervals.

Due to the growing size of the API response, additional markets need to be accessed one event at a time using the new /events/{eventId}/odds endpoint.

Market Key
(use in the API) Market Name Description
alternate_spreads Alternate Spreads (handicap) All available point spread outcomes for each team
alternate_totals Alternate Totals (Over/Under) All available over/under outcomes
btts Both Teams to Score Odds that both teams will score during the game. Outcomes are "Yes" or "No". Available for soccer.
draw_no_bet Draw No Bet Odds for the match winner, excluding the draw outcome. A draw will result in a returned bet. Available for soccer
h2h_3_way Head to head / Moneyline 3 way Match winner including draw
team_totals Team Totals Featured team totals (Over/Under)
alternate_team_totals Alternate Team Totals All available team totals (Over/Under)
Suggest new markets

We are exploring new markets to add. Suggest new markets. (opens new window).

For updates on new markets and other features, check out our Twitter page (opens new window).

#Game Period Markets
Game period markets depend on the sport, and can include quarter time odds, half time odds, period odds, and innings odds.

Market Key
(use in the API) Market Name Note
h2h_q1 Moneyline 1st Quarter
h2h_q2 Moneyline 2nd Quarter
h2h_q3 Moneyline 3rd Quarter
h2h_q4 Moneyline 4th Quarter
h2h_h1 Moneyline 1st Half
h2h_h2 Moneyline 2nd Half
h2h_p1 Moneyline 1st Period Valid for ice hockey
h2h_p2 Moneyline 2nd Period Valid for ice hockey
h2h_p3 Moneyline 3rd Period Valid for ice hockey
h2h_3_way_q1 1st Quarter 3 Way Result
h2h_3_way_q2 2nd Quarter 3 Way Result
h2h_3_way_q3 3rd Quarter 3 Way Result
h2h_3_way_q4 4th Quarter 3 Way Result
h2h_3_way_h1 1st Half 3 Way Result
h2h_3_way_h2 2nd Half 3 Way Result
h2h_3_way_p1 1st Period 3 Way Result Valid for ice hockey
h2h_3_way_p2 2nd Period 3 Way Result Valid for ice hockey
h2h_3_way_p3 3rd Period 3 Way Result Valid for ice hockey
h2h_1st_1_innings Moneyline 1st inning Valid for baseball
h2h_1st_3_innings Moneyline 1st 3 innings Valid for baseball
h2h_1st_5_innings Moneyline 1st 5 innings Valid for baseball
h2h_1st_7_innings Moneyline 1st 7 innings Valid for baseball
h2h_3_way_1st_1_innings 3-way moneyline 1st inning Valid for baseball
h2h_3_way_1st_3_innings 3-way moneyline 1st 3 innings Valid for baseball
h2h_3_way_1st_5_innings 3-way moneyline 1st 5 innings Valid for baseball
h2h_3_way_1st_7_innings 3-way moneyline 1st 7 innings Valid for baseball
spreads_q1 Spreads 1st Quarter
spreads_q2 Spreads 2nd Quarter
spreads_q3 Spreads 3rd Quarter
spreads_q4 Spreads 4th Quarter
spreads_h1 Spreads 1st Half
spreads_h2 Spreads 2nd Half
spreads_p1 Spreads 1st Period Valid for ice hockey
spreads_p2 Spreads 2nd Period Valid for ice hockey
spreads_p3 Spreads 3rd Period Valid for ice hockey
spreads_1st_1_innings Spreads 1st inning Valid for baseball
spreads_1st_3_innings Spreads 1st 3 innings Valid for baseball
spreads_1st_5_innings Spreads 1st 5 innings Valid for baseball
spreads_1st_7_innings Spreads 1st 7 innings Valid for baseball
alternate_spreads_1st_1_innings Alternate spreads 1st inning Valid for baseball
alternate_spreads_1st_3_innings Alternate spreads 1st 3 innings Valid for baseball
alternate_spreads_1st_5_innings Alternate spreads 1st 5 innings Valid for baseball
alternate_spreads_1st_7_innings Alternate spreads 1st 7 innings Valid for baseball
alternate_spreads_q1 Alternate spreads 1st Quarter
alternate_spreads_q2 Alternate spreads 2nd Quarter
alternate_spreads_q3 Alternate spreads 3rd Quarter
alternate_spreads_q4 Alternate spreads 4th Quarter
alternate_spreads_h1 Alternate spreads 1st Half
alternate_spreads_h2 Alternate spreads 2nd Half
alternate_spreads_p1 Alternate spreads 1st Period Valid for ice hockey
alternate_spreads_p2 Alternate spreads 2nd Period Valid for ice hockey
alternate_spreads_p3 Alternate spreads 3rd Period Valid for ice hockey
totals_q1 Over/under 1st Quarter
totals_q2 Over/under 2nd Quarter
totals_q3 Over/under 3rd Quarter
totals_q4 Over/under 4th Quarter
totals_h1 Over/under 1st Half
totals_h2 Over/under 2nd Half
totals_p1 Over/under 1st Period Valid for ice hockey
totals_p2 Over/under 2nd Period Valid for ice hockey
totals_p3 Over/under 3rd Period Valid for ice hockey
totals_1st_1_innings Over/under 1st inning Valid for baseball
totals_1st_3_innings Over/under 1st 3 innings Valid for baseball
totals_1st_5_innings Over/under 1st 5 innings Valid for baseball
totals_1st_7_innings Over/under 1st 7 innings Valid for baseball
alternate_totals_1st_1_innings Alternate over/under 1st inning Valid for baseball
alternate_totals_1st_3_innings Alternate over/under 1st 3 innings Valid for baseball
alternate_totals_1st_5_innings Alternate over/under 1st 5 innings Valid for baseball
alternate_totals_1st_7_innings Alternate over/under 1st 7 innings Valid for baseball
alternate_totals_q1 Alternate totals 1st Quarter
alternate_totals_q2 Alternate totals 2nd Quarter
alternate_totals_q3 Alternate totals 3rd Quarter
alternate_totals_q4 Alternate totals 4th Quarter
alternate_totals_h1 Alternate totals 1st Half
alternate_totals_h2 Alternate totals 2nd Half
alternate_totals_p1 Alternate totals 1st Period Valid for ice hockey
alternate_totals_p2 Alternate totals 2nd Period Valid for ice hockey
alternate_totals_p3 Alternate totals 3rd Period Valid for ice hockey
team_totals_h1 Team Totals 1st Half
team_totals_h2 Team Totals 2nd Half
team_totals_q1 Team Totals 1st Quarter
team_totals_q2 Team Totals 2nd Quarter
team_totals_q3 Team Totals 3rd Quarter
team_totals_q4 Team Totals 4th Quarter
team_totals_p1 Team Totals 1st Period Valid for ice hockey
team_totals_p2 Team Totals 2nd Period Valid for ice hockey
team_totals_p3 Team Totals 3rd Period Valid for ice hockey
alternate_team_totals_h1 Alternate Team Totals 1st Half
alternate_team_totals_h2 Alternate Team Totals 2nd Half
alternate_team_totals_q1 Alternate Team Totals 1st Quarter
alternate_team_totals_q2 Alternate Team Totals 2nd Quarter
alternate_team_totals_q3 Alternate Team Totals 3rd Quarter
alternate_team_totals_q4 Alternate Team Totals 4th Quarter
alternate_team_totals_p1 Alternate Team Totals 1st Period Valid for ice hockey
alternate_team_totals_p2 Alternate Team Totals 2nd Period Valid for ice hockey
alternate_team_totals_p3 Alternate Team Totals 3rd Period Valid for ice hockey

#
