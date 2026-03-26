
HomeAPISheetsAccount
#Betting Markets
The Odds API covers the betting markets listed below.

#Featured Betting Markets
These are the most common markets that are featured by bookmakers. Terminology for betting markets can vary by country, sport and even amongst bookmakers. We aim to simplify this by defining the following markets

Market Key
(use in the API)	Market Names	Description
h2h	Head to head, Moneyline	Bet on the winning team or player of a game (includes the draw for soccer)
spreads	Points spread, Handicap	The spreads market as featured by a bookmaker. Bet on the winning team after a points handicap has been applied to each team
totals	Total points/goals, Over/Under	The totals market as featured by a bookmaker. Bet on the total score of the game being above or below a threshold
outrights	Outrights, Futures	Bet on a final outcome of a tournament or competition
h2h_lay	Same as h2h	Bet against a h2h outcome. This market is only applicable to betting exchanges
outrights_lay	Same as outrights	Bet against an outrights outcome. This market is only applicable to betting exchanges

spreads and totals markets are mainly available for US sports and bookmakers at this time.

For descriptions of these markets, see examples of betting markets.

#Additional Markets
Starting in 2023, more markets are becoming available in the API. Additional markets are currently limited to US sports and selected bookmakers, however coverage is expanding. Additional markets update at 1 minute intervals.

Due to the growing size of the API response, additional markets need to be accessed one event at a time using the new /events/{eventId}/odds endpoint.

Market Key
(use in the API)	Market Name	Description
alternate_spreads	Alternate Spreads (handicap)	All available point spread outcomes for each team
alternate_totals	Alternate Totals (Over/Under)	All available over/under outcomes
btts	Both Teams to Score	Odds that both teams will score during the game. Outcomes are "Yes" or "No". Available for soccer.
draw_no_bet	Draw No Bet	Odds for the match winner, excluding the draw outcome. A draw will result in a returned bet. Available for soccer
h2h_3_way	Head to head / Moneyline 3 way	Match winner including draw
team_totals	Team Totals	Featured team totals (Over/Under)
alternate_team_totals	Alternate Team Totals	All available team totals (Over/Under)
Suggest new markets

We are exploring new markets to add. Suggest new markets. (opens new window).

For updates on new markets and other features, check out our Twitter page (opens new window).

#Game Period Markets
Game period markets depend on the sport, and can include quarter time odds, half time odds, period odds, and innings odds.

Market Key
(use in the API)	Market Name	Note
h2h_q1	Moneyline 1st Quarter	
h2h_q2	Moneyline 2nd Quarter	
h2h_q3	Moneyline 3rd Quarter	
h2h_q4	Moneyline 4th Quarter	
h2h_h1	Moneyline 1st Half	
h2h_h2	Moneyline 2nd Half	
h2h_p1	Moneyline 1st Period	Valid for ice hockey
h2h_p2	Moneyline 2nd Period	Valid for ice hockey
h2h_p3	Moneyline 3rd Period	Valid for ice hockey
h2h_3_way_q1	1st Quarter 3 Way Result	
h2h_3_way_q2	2nd Quarter 3 Way Result	
h2h_3_way_q3	3rd Quarter 3 Way Result	
h2h_3_way_q4	4th Quarter 3 Way Result	
h2h_3_way_h1	1st Half 3 Way Result	
h2h_3_way_h2	2nd Half 3 Way Result	
h2h_3_way_p1	1st Period 3 Way Result	Valid for ice hockey
h2h_3_way_p2	2nd Period 3 Way Result	Valid for ice hockey
h2h_3_way_p3	3rd Period 3 Way Result	Valid for ice hockey
h2h_1st_1_innings	Moneyline 1st inning	Valid for baseball
h2h_1st_3_innings	Moneyline 1st 3 innings	Valid for baseball
h2h_1st_5_innings	Moneyline 1st 5 innings	Valid for baseball
h2h_1st_7_innings	Moneyline 1st 7 innings	Valid for baseball
h2h_3_way_1st_1_innings	3-way moneyline 1st inning	Valid for baseball
h2h_3_way_1st_3_innings	3-way moneyline 1st 3 innings	Valid for baseball
h2h_3_way_1st_5_innings	3-way moneyline 1st 5 innings	Valid for baseball
h2h_3_way_1st_7_innings	3-way moneyline 1st 7 innings	Valid for baseball
spreads_q1	Spreads 1st Quarter	
spreads_q2	Spreads 2nd Quarter	
spreads_q3	Spreads 3rd Quarter	
spreads_q4	Spreads 4th Quarter	
spreads_h1	Spreads 1st Half	
spreads_h2	Spreads 2nd Half	
spreads_p1	Spreads 1st Period	Valid for ice hockey
spreads_p2	Spreads 2nd Period	Valid for ice hockey
spreads_p3	Spreads 3rd Period	Valid for ice hockey
spreads_1st_1_innings	Spreads 1st inning	Valid for baseball
spreads_1st_3_innings	Spreads 1st 3 innings	Valid for baseball
spreads_1st_5_innings	Spreads 1st 5 innings	Valid for baseball
spreads_1st_7_innings	Spreads 1st 7 innings	Valid for baseball
alternate_spreads_1st_1_innings	Alternate spreads 1st inning	Valid for baseball
alternate_spreads_1st_3_innings	Alternate spreads 1st 3 innings	Valid for baseball
alternate_spreads_1st_5_innings	Alternate spreads 1st 5 innings	Valid for baseball
alternate_spreads_1st_7_innings	Alternate spreads 1st 7 innings	Valid for baseball
alternate_spreads_q1	Alternate spreads 1st Quarter	
alternate_spreads_q2	Alternate spreads 2nd Quarter	
alternate_spreads_q3	Alternate spreads 3rd Quarter	
alternate_spreads_q4	Alternate spreads 4th Quarter	
alternate_spreads_h1	Alternate spreads 1st Half	
alternate_spreads_h2	Alternate spreads 2nd Half	
alternate_spreads_p1	Alternate spreads 1st Period	Valid for ice hockey
alternate_spreads_p2	Alternate spreads 2nd Period	Valid for ice hockey
alternate_spreads_p3	Alternate spreads 3rd Period	Valid for ice hockey
totals_q1	Over/under 1st Quarter	
totals_q2	Over/under 2nd Quarter	
totals_q3	Over/under 3rd Quarter	
totals_q4	Over/under 4th Quarter	
totals_h1	Over/under 1st Half	
totals_h2	Over/under 2nd Half	
totals_p1	Over/under 1st Period	Valid for ice hockey
totals_p2	Over/under 2nd Period	Valid for ice hockey
totals_p3	Over/under 3rd Period	Valid for ice hockey
totals_1st_1_innings	Over/under 1st inning	Valid for baseball
totals_1st_3_innings	Over/under 1st 3 innings	Valid for baseball
totals_1st_5_innings	Over/under 1st 5 innings	Valid for baseball
totals_1st_7_innings	Over/under 1st 7 innings	Valid for baseball
alternate_totals_1st_1_innings	Alternate over/under 1st inning	Valid for baseball
alternate_totals_1st_3_innings	Alternate over/under 1st 3 innings	Valid for baseball
alternate_totals_1st_5_innings	Alternate over/under 1st 5 innings	Valid for baseball
alternate_totals_1st_7_innings	Alternate over/under 1st 7 innings	Valid for baseball
alternate_totals_q1	Alternate totals 1st Quarter	
alternate_totals_q2	Alternate totals 2nd Quarter	
alternate_totals_q3	Alternate totals 3rd Quarter	
alternate_totals_q4	Alternate totals 4th Quarter	
alternate_totals_h1	Alternate totals 1st Half	
alternate_totals_h2	Alternate totals 2nd Half	
alternate_totals_p1	Alternate totals 1st Period	Valid for ice hockey
alternate_totals_p2	Alternate totals 2nd Period	Valid for ice hockey
alternate_totals_p3	Alternate totals 3rd Period	Valid for ice hockey
team_totals_h1	Team Totals 1st Half	
team_totals_h2	Team Totals 2nd Half	
team_totals_q1	Team Totals 1st Quarter	
team_totals_q2	Team Totals 2nd Quarter	
team_totals_q3	Team Totals 3rd Quarter	
team_totals_q4	Team Totals 4th Quarter	
team_totals_p1	Team Totals 1st Period	Valid for ice hockey
team_totals_p2	Team Totals 2nd Period	Valid for ice hockey
team_totals_p3	Team Totals 3rd Period	Valid for ice hockey
alternate_team_totals_h1	Alternate Team Totals 1st Half	
alternate_team_totals_h2	Alternate Team Totals 2nd Half	
alternate_team_totals_q1	Alternate Team Totals 1st Quarter	
alternate_team_totals_q2	Alternate Team Totals 2nd Quarter	
alternate_team_totals_q3	Alternate Team Totals 3rd Quarter	
alternate_team_totals_q4	Alternate Team Totals 4th Quarter	
alternate_team_totals_p1	Alternate Team Totals 1st Period	Valid for ice hockey
alternate_team_totals_p2	Alternate Team Totals 2nd Period	Valid for ice hockey
alternate_team_totals_p3	Alternate Team Totals 3rd Period	Valid for ice hockey
#Player Props API Markets
Coverage of player props is mainly limited to US sports and US bookmakers at this time.

Player props can be accessed one event at a time using the /events/{eventId}/odds endpoint.

#NFL, NCAAF, CFL Player Props API
Market Key
(use in the API)	Market Name
player_assists	Assists (Over/Under)
player_defensive_interceptions	Defensive Interceptions (Over/Under)
player_field_goals	Field Goals (Over/Under)
player_kicking_points	Kicking Points (Over/Under)
player_pass_attempts	Pass Attempts (Over/Under)
player_pass_completions	Pass Completions (Over/Under)
player_pass_interceptions	Pass Intercepts (Over/Under)
player_pass_longest_completion	Longest Pass Completion (Over/Under)
player_pass_rush_yds	Pass + Rush Yards (Over/Under)
player_pass_rush_reception_tds	Pass + Rush + Reception Touchdowns (Over/Under)
player_pass_rush_reception_yds	Pass + Rush + Reception Yards (Over/Under)
player_pass_tds	Pass Touchdowns (Over/Under)
player_pass_yds	Pass Yards (Over/Under)
player_pass_yds_q1	1st Quarter Pass Yards (Over/Under)
player_pats	Points After Touchdown (Over/Under)
player_receptions	Receptions (Over/Under)
player_reception_longest	Longest Reception (Over/Under)
player_reception_tds	Reception Touchdowns (Over/Under)
player_reception_yds	Reception Yards (Over/Under)
player_rush_attempts	Rush Attempts (Over/Under)
player_rush_longest	Longest Rush (Over/Under)
player_rush_reception_tds	Rush + Reception Touchdowns (Over/Under)
player_rush_reception_yds	Rush + Reception Yards (Over/Under)
player_rush_tds	Rush Touchdowns (Over/Under)
player_rush_yds	Rush Yards (Over/Under)
player_sacks	Sacks (Over/Under)
player_solo_tackles	Solo Tackles (Over/Under)
player_tackles_assists	Tackles + Assists (Over/Under)
player_tds_over	Touchdowns (Over only)
player_1st_td	1st Touchdown Scorer (Yes/No)
player_anytime_td	Anytime Touchdown Scorer (Yes/No)
player_last_td	Last Touchdown Scorer (Yes/No)
#Alternate NFL Player Props API
Market Key
(use in the API)	Market Name
player_assists_alternate	Alternate Assists (Over/Under)
player_field_goals_alternate	Alternate Field Goals (Over/Under)
player_kicking_points_alternate	Alternate Kicking Points (Over/Under)
player_pass_attempts_alternate	Alternate Pass Attempts (Over/Under)
player_pass_completions_alternate	Alternate Pass Completions (Over/Under)
player_pass_interceptions_alternate	Alternate Pass Interceptions (Over/Under)
player_pass_longest_completion_alternate	Alternate Longest Pass Completion (Over/Under)
player_pass_rush_yds_alternate	Alternate Pass + Rush Yards (Over/Under)
player_pass_rush_reception_tds_alternate	Alternate Pass + Rush + Reception Touchdowns (Over/Under)
player_pass_rush_reception_yds_alternate	Alternate Pass + Rush + Reception Yards (Over/Under)
player_pass_tds_alternate	Alternate Pass Touchdowns (Over/Under)
player_pass_yds_alternate	Alternate Pass Yards (Over/Under)
player_pats_alternate	Alternate Points After Touchdown (Over/Under)
player_receptions_alternate	Alternate Receptions (Over/Under)
player_reception_longest_alternate	Alternate Longest Reception (Over/Under)
player_reception_tds_alternate	Alternate Reception Touchdowns (Over/Under)
player_reception_yds_alternate	Alternate Reception Yards (Over/Under)
player_rush_attempts_alternate	Alternate Rush Attempts (Over/Under)
player_rush_longest_alternate	Alternate Longest Rush (Over/Under)
player_rush_reception_tds_alternate	Alternate Rush + Reception Touchdowns (Over/Under)
player_rush_reception_yds_alternate	Alternate Rush + Reception Yards (Over/Under)
player_rush_tds_alternate	Alternate Rush Touchdowns (Over/Under)
player_rush_yds_alternate	Alternate Rush Yards (Over/Under)
player_sacks_alternate	Alternate Sacks (Over/Under)
player_solo_tackles_alternate	Alternate Solo Tackles (Over/Under)
player_tackles_assists_alternate	Alternate Tackles + Assists (Over/Under)
#NBA, NCAAB, WNBA Player Props API
Market Key
(use in the API)	Market Name
player_points	Points (Over/Under)
player_points_q1	1st Quarter Points (Over/Under)
player_rebounds	Rebounds (Over/Under)
player_rebounds_q1	1st Quarter Rebounds (Over/Under)
player_assists	Assists (Over/Under)
player_assists_q1	1st Quarter Assists (Over/Under)
player_threes	Threes (Over/Under)
player_blocks	Blocks (Over/Under)
player_steals	Steals (Over/Under)
player_blocks_steals	Blocks + Steals (Over/Under)
player_turnovers	Turnovers (Over/Under)
player_points_rebounds_assists	Points + Rebounds + Assists (Over/Under)
player_points_rebounds	Points + Rebounds (Over/Under)
player_points_assists	Points + Assists (Over/Under)
player_rebounds_assists	Rebounds + Assists (Over/Under)
player_field_goals	Field Goals (Over/Under)
player_frees_made	Frees made (Over/Under)
player_frees_attempts	Frees attempted (Over/Under)
player_first_basket	First Basket Scorer (Yes/No)
player_first_team_basket	First Basket Scorer on Team (Yes/No)
player_double_double	Double Double (Yes/No)
player_triple_double	Triple Double (Yes/No)
player_method_of_first_basket	Method of First Basket (Various)
player_fantasy_points	Fantasy points (Over/Under), DFS only
#Alternate NBA Player Props API
Alternate player prop markets include X+ lines, and markets labeled by bookmakers as "alternate".

Market Key
(use in the API)	Market Name
player_points_alternate	Alternate Points (Over/Under)
player_rebounds_alternate	Alternate Rebounds (Over/Under)
player_assists_alternate	Alternate Assists (Over/Under)
player_blocks_alternate	Alternate Blocks (Over/Under)
player_steals_alternate	Alternate Steals (Over/Under)
player_turnovers_alternate	Alternate Turnovers (Over/Under)
player_threes_alternate	Alternate Threes (Over/Under)
player_points_assists_alternate	Alternate Points + Assists (Over/Under)
player_points_rebounds_alternate	Alternate Points + Rebounds (Over/Under)
player_rebounds_assists_alternate	Alternate Rebounds + Assists (Over/Under)
player_points_rebounds_assists_alternate	Alternate Points + Rebounds + Assists (Over/Under)
player_fantasy_points_alternate	Fantasy points (Over/Under), DFS only
#MLB Player Props API
Market Key
(use in the API)	Market Name
batter_home_runs	Batter home runs (Over/Under)
batter_first_home_run	Batter first home run (Yes/No)
batter_hits	Batter hits (Over/Under)
batter_total_bases	Batter total bases (Over/Under)
batter_rbis	Batter RBIs (Over/Under)
batter_runs_scored	Batter runs scored (Over/Under)
batter_hits_runs_rbis	Batter hits + runs + RBIs (Over/Under)
batter_singles	Batter singles (Over/Under)
batter_doubles	Batter doubles (Over/Under)
batter_triples	Batter triples (Over/Under)
batter_walks	Batter walks (Over/Under)
batter_strikeouts	Batter strikeouts (Over/Under)
batter_stolen_bases	Batter stolen bases (Over/Under)
pitcher_strikeouts	Pitcher strikeouts (Over/Under)
pitcher_record_a_win	Pitcher to record a win (Yes/No)
pitcher_hits_allowed	Pitcher hits allowed (Over/Under)
pitcher_walks	Pitcher walks (Over/Under)
pitcher_earned_runs	Pitcher earned runs (Over/Under)
pitcher_outs	Pitcher outs (Over/Under)
#Alternate MLB Player Props API
Market Key
(use in the API)	Market Name
batter_total_bases_alternate	Alternate batter total bases (Over/Under)
batter_home_runs_alternate	Alternate batter home runs (Over/Under)
batter_hits_alternate	Alternate batter hits (Over/Under)
batter_rbis_alternate	Alternate batter RBIs (Over/Under)
batter_walks_alternate	Alternate batter walks (Over/Under)
batter_strikeouts_alternate	Alternate batter strikeouts (Over/Under)
batter_runs_scored_alternate	Alternate batter runs scored (Over/Under)
batter_singles_alternate	Alternate batter singles (Over/Under)
batter_doubles_alternate	Alternate batter doubles (Over/Under)
batter_triples_alternate	Alternate batter triples (Over/Under)
pitcher_hits_allowed_alternate	Alternate pitcher hits allowed (Over/Under)
pitcher_walks_alternate	Alternate pitcher walks allowed (Over/Under)
pitcher_strikeouts_alternate	Alternate pitcher strikeouts (Over/Under)
#NHL Player Props API
Market Key
(use in the API)	Market Name
player_points	Points (Over/Under)
player_power_play_points	Power play points (Over/Under)
player_assists	Assists (Over/Under)
player_blocked_shots	Blocked shots (Over/Under)
player_shots_on_goal	Shots on goal (Over/Under)
player_goals	Goals (Over/Under)
player_total_saves	Total saves (Over/Under)
player_goal_scorer_first	First Goal Scorer (Yes/No)
player_goal_scorer_last	Last Goal Scorer (Yes/No)
player_goal_scorer_anytime	Anytime Goal Scorer (Yes/No)
#Alternate NHL Player Props API
Alternate player prop markets include X+ lines, and markets labeled by bookmakers as "alternate".

Market Key
(use in the API)	Market Name
player_points_alternate	Alternate Points (Over/Under)
player_assists_alternate	Alternate Assists (Over/Under)
player_power_play_points_alternate	Alternate Power Play Points (Over/Under)
player_goals_alternate	Alternate Goals (Over/Under)
player_shots_on_goal_alternate	Alternate Shots on Goal (Over/Under)
player_blocked_shots_alternate	Alternate Blocked Shots (Over/Under)
player_total_saves_alternate	Alternate Total Saves (Over/Under)
#AFL Player Props API
AFL player props are currently available from select AU bookmakers, including Sportsbet, Ladbrokes, TAB, Pointsbet and Betr

Market Key
(use in the API)	Market Name
player_disposals	Disposals (Over/Under)
player_disposals_over	Disposals (Over only)
player_goal_scorer_first	First Goal Scorer (Yes/No)
player_goal_scorer_last	Last Goal Scorer (Yes/No)
player_goal_scorer_anytime	Anytime Goal Scorer (Yes/No)
player_goals_scored_over	Goals scored (Over only)
player_marks_over	Marks (Over only)
player_marks_most	Most Marks (Yes/No)
player_tackles_over	Tackles (Over only)
player_tackles_most	Tackles (Yes/No)
player_afl_fantasy_points	AFL Fantasy Points (Over/Under)
player_afl_fantasy_points_over	AFL Fantasy Points (Over only)
player_afl_fantasy_points_most	Most AFL Fantasy Points (Yes/No)
player_clearances_over	Clearances (Over only)
player_kicks_over	Kicks (Over only)
player_handballs_over	Handballs (Over only)
#Rugby League Player Props API
NRL player props are currently available from select AU bookmakers, including Sportsbet, Ladbrokes, TAB, Pointsbet and Betr

Market Key
(use in the API)	Market Name
player_try_scorer_first	First Try Scorer (Yes/No)
player_try_scorer_last	Last Try Scorer (Yes/No)
player_try_scorer_anytime	Anytime Try Scorer (Yes/No)
player_try_scorer_over	Tries Scored (Over only)
#Soccer Player Props API
Soccer player props are available for EPL, French Ligue 1, German Bundesliga, Italian Serie A, Spanish La Liga, and MLS. Coverage is currently limited to US bookmakers.

Market Key
(use in the API)	Market Name
player_goal_scorer_anytime	Anytime Goal Scorer (Yes/No)
player_first_goal_scorer	First Goal Scorer (Yes/No)
player_last_goal_scorer	Last Goal Scorer (Yes/No)
player_to_receive_card	Player to receive a card (Yes/No)
player_to_receive_red_card	Player to receive a red card (Yes/No)
player_shots_on_target	Player Shots on Target (Over/Under)
player_shots	Player Shots (Over/Under)
player_assists	Player Assists (Over/Under)
#Other soccer betting markets
Market Key
(use in the API)	Market Name
alternate_spreads_corners	Handicap Corners
alternate_totals_corners	Total Corners (Over/Under)
alternate_spreads_cards	Handicap Cards / Bookings
alternate_totals_cards	Total Cards / Bookings (Over/Under)
double_chance	Double Chance
For half time markets, see Game Period Markets


Suggest new markets

We are continuing to expand coverage of player props. Suggest new markets & bookmakers (opens new window).

#Get Started

To discover the sports, bookmakers and markets that we cover, the first thing you will need is an API key

Get a Free API Key →

To get started with the JSON API, see

Odds API docs
Python and NodeJS code samples
To bring bookmaker odds into your website with a simple HTML tag, and to monetize with bookmaker affiliate links, checkout the Odds Widget

To get sports odds in Excel or Google Sheets at the click of a button (no coding needed), see

Odds in Excel
Odds in Google Sheets