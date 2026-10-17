<p align="center"><img src="public/logo.png" alt="DUES crest" width="96"></p>

# DUES Inhouses

Leaderboards, records, player profiles and team builders for the Dublin University Esports Society's **Overwatch** and **Valorant** inhouses, with a Discord bot that runs the Saturday Valorant weeklies.

It grew out of the static Overtime site and follows [Blueward](https://github.com/Kickblip/blueward), the League of Legends club tracker, feature for feature where it fits. It's written from scratch: Blueward has no licence, so none of its code or art is used.

## What it does

- **Two games, one site.** A switch at the top moves between Overwatch and Valorant. Each has a ladder, every match with full scoreboards, single-game records, hero or agent stats, and a team builder.
- **Ratings.** Openskill (Plackett-Luce), the same model as the Overtime site: an overall rating per game, plus tank, damage and support ratings in Overwatch. In Valorant everyone starts on 1000, whatever their rank, and only games move it: winning or losing sets the direction, the round margin scales the whole game (13–11 about 0.86×, 13–3 about 1.2×, `VAL_MARGIN_WEIGHT`), and performance in the lobby (mostly ACS, plus K/D and ADR) shares each team's change out, by up to ±30% (`VAL_PERF_WEIGHT`). Winners never lose rating, losers never gain, and performance only moves rating between teammates. Ratings are recomputed from the stored games, so changing a weight re-rates every past game. Competitive rank (current and peak) is used only to balance teams.
- **Profiles.** One per member across both games: Discord picture, level, a 75-character note, rating chart, heroes or agents, best teammates and every game.
- **Getting games in.**
  - *Overwatch:* hosts play with the ScrimTime Workshop mode; an officer drops the night's log files (or a zip) on **Admin > Games**.
  - *Valorant:* automatic. Every member's linked Riot ID is an anchor: the site reads each anchor's recent custom games from the unofficial [HenrikDev API](https://docs.henrikdev.xyz) and keeps finished ones that started in the Saturday window (18:30–03:30 Irish time) and are either a game the Discord bot set up (all ten of its players, on its map) or have at least 3 members. The full API response is kept for each game, so new stats can be worked out for past weeks later. A scoreboard can also be typed into a CSV when the API is down.
- **Weeklies in Discord.** `/link Name#TAG` once (the bot looks up the account and its current and peak rank), then a **Join** button each Saturday. At 18:45 the bot balances the ten into two teams on rank and leaderboard rating, the ten vote on the map (2 minutes, tonight's maps left out), and after each game it posts the result with everyone's rating change. Then everyone checks in again for the next game, so someone leaving is swapped for whoever's waiting, and the new teams use the updated leaderboard.
- **Accounts.** Members sign in with Discord, then ask to link their BattleTag and Riot ID. An officer approves each link, which joins every past and future game on that account to them and pays them for it. Roster entries for people who haven't signed in yet merge into them when they claim the account. A Riot name change doesn't split a profile: the site follows the account.
- **Valorant stats.** ACS, kills per round, damage per round, first bloods per round (the round's first kill, from the kill feed), headshot rate, spike plants and K/D. The full API response is kept for every game, so when the site learns to read a new stat, past games are re-read from it on the next import.
- **Levels.** XP from every game in either game; the badge colour changes at levels 5, 10, 15, 25 and 40.
- **Admin.** Approve account links, upload games, fetch Valorant, remove games, add roster members or import the old Overtime roster, set roles.

What's still to come (stages 2 and 3): live rooms with captain drafts, predictions on games, and events such as a climb challenge.

## How it's built

Next.js 16 on **Vercel**, with **Supabase** for the database (Postgres), and Discord sign-in. Both have free plans that cover a society this size: Supabase's free plan gives a 500 MB database and 1 GB of storage, and pauses a project after a week with no activity, which the weekly schedule prevents.

The Discord bot runs on Vercel too: Discord sends slash commands and button clicks to `/api/discord` as signed web requests, so nothing has to stay running. The timer is a **GitHub Actions** workflow (`.github/workflows/schedule.yml`, at the top of the repository) that calls the site every 10 minutes on Saturday evenings and twice on Sunday. Vercel's free plan only allows cron jobs once a day, so it keeps one weekly run as a fallback. GitHub Actions doesn't use GitHub Pages or any domain.

```
app/                 pages and server actions (admin/, overwatch/, valorant/, players/, me/)
app/api/             JSON endpoints: uploads, Valorant fetch, cron, discord
lib/discord/         the bot: request signatures, commands, buttons, messages, the Saturday schedule
lib/weekly/          sessions, sign-ups, team balancing, map votes, recognising each game's result
lib/ow/parse.ts      ScrimTime log parser
lib/val/             HenrikDev API import, Valorant match format, typed-in scoreboards, the Saturday window
lib/season.ts        everything the stats pages show, rebuilt when games change
lib/ratings.ts       openskill ratings (checked against the Python site's numbers in tests)
lib/members.ts       account links, approvals, roster merges, roles
lib/levels.ts        XP per game and the level curve
config/              heroes.yaml (hero roles), agents.yaml (agent classes), maps.yaml (map vote pool)
supabase/            schema.sql for the database
public/              team builder scripts, fonts, crest
tests/               vitest: parsing, ratings, linking, weeklies, Valorant import, builders
```

## Setting up

You need free accounts on GitHub, [Supabase](https://supabase.com), [Vercel](https://vercel.com) and the [Discord Developer Portal](https://discord.com/developers/applications). Allow about 30 minutes.

### 1. Database (Supabase)

1. Create a project. Pick the **West EU (Ireland)** region and save the database password somewhere safe. A password of only letters and numbers saves trouble later: `@ # / ? %` in a password break the connection string unless URL-encoded.
2. Open **SQL Editor > New query**, paste all of `supabase/schema.sql`, and press **Run**. When `schema.sql` changes later, run it again: it adds what's missing and removes what the site no longer uses (such as the old banner and Crests tables).

### 2. Discord sign-in

1. In the Discord Developer Portal, **New Application**, named e.g. "DUES Inhouses". Under **OAuth2**, copy the **Client ID** and reset and copy the **Client Secret**.
2. In Supabase, **Authentication > Sign In / Providers > Discord**: turn it on and paste the ID and secret. Copy the **Callback URL** it shows (it ends in `/auth/v1/callback`).
3. Back in Discord, **OAuth2 > Redirects > Add Redirect**, and paste that callback URL. Save.
4. In Supabase, still under **Sign In / Providers**, **turn off Email** (and anonymous sign-ins if on). The site only uses Discord, and leaving email sign-up on lets people create accounts that aren't tied to Discord.

### 3. The site (Vercel)

1. Push the repository to GitHub.
2. In Vercel, **Add New > Project** and import the repository. The site is in the `dues-inhouse` folder, not at the top of the repository, so set **Root Directory** to `dues-inhouse` (or Vercel says it can't find Next.js). Before deploying, open **Environment Variables** and add:

   | Name | Where to find it |
   | --- | --- |
   | `DATABASE_URL` | Supabase **Connect** (top bar) > **Transaction pooler** connection string (port 6543, host `…pooler.supabase.com`, user `postgres.<project ref>`), with your database password filled in. Not the *Direct connection* (`db.<ref>.supabase.co`): Vercel can't reach it and every page times out. If you used Vercel's Supabase integration, it makes `POSTGRES_URL` instead; copy its pooler value into `DATABASE_URL` |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase **Project Settings > Data API**: Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase **Project Settings > API Keys**: the publishable (anon) key |
   | `ADMIN_DISCORD_IDS` | Your Discord user id (Discord settings > Advanced > Developer Mode on, then right-click your name > Copy User ID). Several ids can be separated by commas |
   | `HENRIKDEV_API_KEY` | Your HenrikDev key (`HDEV-...`) |
   | `CRON_SECRET` | Any long random text; the schedule sends it to the site's scheduled checks |
   | `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY` | Discord Developer Portal > your application > **General Information**: Application ID and Public Key |
   | `DISCORD_BOT_TOKEN` | Same application > **Bot** > Reset Token |
   | `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID` | Right-click the club's server, then the weeklies channel > **Copy ID** |

3. Deploy. Copy the site's address (e.g. `https://dues-inhouse.vercel.app`).
4. In Supabase, **Authentication > URL Configuration**: set **Site URL** to that address, and add `https://<your address>/**` under **Redirect URLs**, with the two stars: sign-in comes back to `/auth/callback?next=...`, which an entry without them doesn't match, and Supabase then drops you on the home page with `?code=` still signed out. Always open the site at that address, not a deployment's own `…-<hash>.vercel.app` address, or sign-in can't finish.
5. Open the site and **Sign in with Discord**. Because your id is in `ADMIN_DISCORD_IDS`, you're an admin. Make other committee members officers on **Admin > Members** once they've signed in.

If a page shows an error after deploying, open the deployment's **Logs** in Vercel. `DATABASE_URL is not set` means the variable is missing (or was added after the deploy: redeploy); a timeout or `ENOTFOUND` means it's the direct connection rather than the pooler.

### 4. The Discord bot

Use the same Discord application as the sign-in.

1. **Bot**: turn off **Public Bot**. Optionally turn on **Server Members Intent**, so the DUES member check reads the whole server at once (see DUES members below); nothing else needs it.
2. **Installation** (or **OAuth2 > URL Generator**): scopes `bot` and `applications.commands`; bot permissions **View Channels**, **Send Messages**, **Embed Links**. Open the link and add the bot to the club's server. Make sure it can post in the weeklies channel.
3. **General Information > Interactions Endpoint URL**: `https://<your address>/api/discord`, then **Save**. Discord tests the address first, so the site must be deployed with `DISCORD_PUBLIC_KEY` set. Use the production address: Vercel's Deployment Protection blocks Discord from preview addresses.
4. Register the slash commands on the server, from your computer, with the four `DISCORD_` values in `.env.local`:
   ```
   npm run discord:register
   ```
   Run it again whenever `lib/discord/commands.ts` changes.

Officers in the bot are the site's officers and admins, anyone in `ADMIN_DISCORD_IDS`, and anyone with **Manage Server** in Discord.

**DUES members.** The leaderboards have an **Everyone / DUES members** switch. Anyone with the **Trinity** role in the Discord server counts as a member (change the role with `DUES_MEMBER_ROLE`). The bot reads it whenever someone uses it or signs in to the site, and for everyone with the Sunday import or **Admin > Members > Check Discord roles now**. To check the whole server in one request, turn on **Server Members Intent** under **Bot** in the Developer Portal; without it the bot asks about people one at a time, which is slower but works. On **Admin > Members** an officer can set anyone to Yes or No by hand, for example someone who isn't on Discord or whose role is wrong. Only people with a profile (signed in, or added on Admin > Members) can be members; players the site only knows from game logs show under Everyone.

### 5. The schedule (GitHub Actions)

In the GitHub repository, **Settings > Secrets and variables > Actions**:

- **Variables** tab: `SITE_URL` = the site's address, e.g. `https://dues-inhouse.vercel.app` (no trailing slash).
- **Secrets** tab: `CRON_SECRET` = the same value as on Vercel.

Then **Actions > Weekly schedule > Run workflow** once to check it works (the log should end with a JSON reply, not an error). It runs by itself from then on. This only calls the Vercel site; it doesn't need GitHub Pages or a domain, so another project using your GitHub Pages is unaffected. GitHub pauses schedules in public repositories after 60 days with no commits (it emails first, and one click re-enables them); the weekly Vercel cron keeps the Sunday import going meanwhile.

### 6. Bring over the Overtime data

1. **Admin > Members > Import the old roster**: upload the Overtime `config/players.csv`. Everyone on it becomes a roster entry with their accounts linked, and merges into them when they sign in.
2. **Admin > Games > Upload games**: zip the Overtime `logs/` and `valorant/` folders and drop the zip in. Files already imported are skipped, so it's safe to repeat.

## Running a night

- **Overwatch:** the host saves logs as before (ScrimTime with Log Generator and Player Stat Summary on, and *Enable Workshop Inspector Log File* in Overwatch's settings). Afterwards an officer uploads the night's files from `Documents/Overwatch/Workshop` on **Admin > Games**.
- **Valorant (Saturday weeklies):** it runs itself in the weeklies channel.
  1. **17:00** the bot posts sign-ups. New players use `/link Name#TAG` once; after that it's the **Join** button.
  2. **18:45** with at least 10 signed up, it posts balanced teams (each side's average rating) and pings the ten. With fewer, it says so, and an officer starts with `/weekly teams` when ready.
  3. **Map vote**: the ten press a map button. It closes when all ten have voted or after 2 minutes (**Lock in map** then works for anyone in the lobby; officers can lock it any time). Ties are random; maps already played tonight aren't offered.
  4. The host makes the custom lobby with those teams on that map.
  5. Within about 10 minutes of the game ending, the bot posts the result: score, each player's rating change and their place in the lobby. It counts a custom game as that weekly game only if all ten players were in it, on that map, during the session.
  6. **Check-in for the next game**: when the result is posted (or someone presses **Next game** / `/weekly next`), the bot asks tonight's players **I'm in** or **I'm out**; newcomers can press **I'm in** too. Teams are made as soon as ten are in and everyone has answered, or after 5 minutes (`WEEKLY_CHECKIN_SECONDS`) with ten in. An officer can press **Make teams** to go with fewer. With more than ten in, whoever sat out goes first. If the last game's result isn't in yet, the bot looks for it first, so the new teams use the updated leaderboard. Teams differ from earlier splits that night.
  - **Balancing** blends competitive rank (mostly current, some peak) with the weekly leaderboard rating. Rank counts fully on someone's first night and less as they play (half each after 8 games, `WEEKLY_RANK_GAMES`). Each player's rank is refreshed when they join, at most every 3 days. The game post shows each player's leaderboard rating and rank; the team numbers are the balancing blend.
  7. On Sunday morning and afternoon the full import checks every linked account for anything missed, and posts a short summary (including a warning if Riot's data looks different). The night closes by itself; `/weekly end` closes it early.
  - Officers can run a session on any day with `/weekly open` in a channel; games then count from half an hour before until 12 hours after.
  - Without the bot, customs during the Saturday window with at least 3 linked members are still imported, and **Fetch now** on **Admin > Games** still works.
- **Team builders** on each game's **Team builder** page split the ten players in the lobby into the most even teams.

## Changing things

- **New season / reset ratings:** on **Admin > Games > Season**, pick a start date. Only games from that day count (everyone starts again on 1,000); older games stay saved but are left out, and imports don't bring them back. Clear it to count every game again. Games removed on Admin > Games aren't re-imported either.

- **Levels:** `lib/levels.ts` (XP per game and the level curve).
- **New heroes or agents:** add them to `config/heroes.yaml` or `config/agents.yaml`. The leaderboards say when one is missing.
- **Map pool:** `config/maps.yaml`. Keep it to the current competitive rotation; commit and the next deploy uses it.
- **Other settings** (Vercel environment variables, all optional): `MIN_GAMES_RANKED` (games before someone gets a rank number, default 3; until then they're on the ladder as provisional, below the ranked players), `VAL_MIN_PLAYERS` (default 10), `VAL_MIN_MEMBERS` (default 3), `VAL_REGION` (default `eu`), `CLUB_TIME_ZONE` (default `Europe/Dublin`), `VAL_WINDOW` (default `sat 18:30-03:30`; `off` imports customs at any time), `VAL_PERF_WEIGHT` (default `0.3`; `0` for result-only ratings), `VAL_MARGIN_WEIGHT` (default `0.2`; `0` to ignore the round margin), `WEEKLY_AUTO` (`0` to open sign-ups and make teams by hand), `WEEKLY_SIGNUPS_OPEN` (default `17:00`), `WEEKLY_TEAMS_AT` (default `18:45`), `WEEKLY_VOTE_SECONDS` (default `120`), `WEEKLY_CHECKIN_SECONDS` (default `300`), `WEEKLY_RANK_GAMES` (default `8`), `DISCORD_LOG_CHANNEL_ID` (where the Sunday summary goes), `DUES_MEMBER_ROLE` (the Discord role for DUES members, by name or id; default `Trinity`, `off` to stop reading it). If you change the Saturday times a lot, check the times in `.github/workflows/schedule.yml` still cover them.

## Running it on your computer

Needs Node 20 or newer and PostgreSQL 15 or newer.

```
npm install
npm run db:local                       # starts Postgres in .data/ and loads the schema
cp .env.example .env.local             # then set DATABASE_URL to what db:local printed, and DEV_LOGIN=1
DATABASE_URL=postgres://postgres@localhost:5433/dues npm run db:seed-demo   # invented demo season
npm run dev                            # http://localhost:3000
npm test                               # uses a separate dues_test database (TEST_DATABASE_URL to change it)
DATABASE_SERIAL=1 npm test             # the same, talking to the database the way the live site does (one query at a time)
```

With `DEV_LOGIN=1`, the sign-in page lets you act as any player without Discord. It never works in production.

To check the HenrikDev API against a real account (with `HENRIKDEV_API_KEY` in `.env.local`): `npm run henrik:check -- "Name#TAG"`. It prints the account's rank and its last 10 custom games, with what the import would do with each.

## Limitations

- Valorant games are only found if a linked member was in the lobby, and while the game is still among that member's last 10 custom games. With the checks during the session and on Sunday, that's rarely a problem.
- `/link` approves a Riot ID straight away, since the API shows it exists, but it can't prove the account is the person's own. An account someone else already linked can't be taken; officers can remove a wrong link on **Admin > Members**.
- GitHub can start scheduled runs 5–15 minutes late, so teams may appear a little after 18:45. An officer can always use `/weekly teams`.
- The HenrikDev key allows 30 requests a minute. Every request the site makes (imports, result checks, `/link`, rank refreshes) takes a slot from one shared count in the database first, capped at 28 a minute (`HENRIK_RATE_LIMIT`). Rank refreshes only use part of that and are skipped when it's busy, so they never hold up results. Using the same key elsewhere at the same time (e.g. `npm run henrik:check`) counts against the same 30.
- The HenrikDev API is unofficial and run by one person. If it changes or stops, typed-in scoreboards still work.
- Riot leaves its per-player performance score empty for custom games, so the site doesn't show one.
- Ratings from one term are noisy; treat small gaps as ties.
- The site is public. Members should know their in-game names and stats appear on it.

## Credits

- [Blueward](https://github.com/Kickblip/blueward) by Longhorn LoL, for the idea and the feature set.
- [ScrimTime](https://workshop.codes/FYHQV) by Caldoran writes the Overwatch logs.
- [HenrikDev API](https://docs.henrikdev.xyz) for Valorant match history.
- [openskill.js](https://github.com/philihp/openskill.js) for the rating model.
- Inter by Rasmus Andersson, under the SIL Open Font License (`public/fonts/OFL-Inter.txt`). Apple devices show their own system font instead.
- The DUES crest belongs to the Dublin University Esports Society.

Overwatch is a trademark of Blizzard Entertainment. This site isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, Valorant and all associated properties are trademarks or registered trademarks of Riot Games, Inc. Neither company is affiliated with this site.
