# Setting up and running DUES Inhouses

The full reference: deploying the site, the Discord bot and the schedule, running a night, and every setting. For an overview, see the [README](../README.md).

- [Setting up](#setting-up)
- [Running a night](#running-a-night)
- [Configuration](#configuration)
- [Local development](#local-development)
- [Limitations](#limitations)

## Setting up

You need free accounts on GitHub, [Supabase](https://supabase.com), [Vercel](https://vercel.com) and the [Discord Developer Portal](https://discord.com/developers/applications). Allow about 30 minutes.

### 1. Database (Supabase)

1. Create a project in the **West EU (Ireland)** region and save the database password somewhere safe. A password of only letters and numbers saves trouble later: `@ # / ? %` break the connection string unless URL-encoded.
2. Open **SQL Editor > New query**, paste all of [`dues-inhouse/supabase/schema.sql`](../dues-inhouse/supabase/schema.sql), and press **Run**. When the schema changes later, run it again: it adds what's missing and removes what the site no longer uses.
3. Recommended: under **Project Settings > JWT Keys**, switch to the new asymmetric signing keys. The site can then check who's signed in without asking Supabase on every page load.

### 2. Discord sign-in

1. In the Discord Developer Portal, choose **New Application** (e.g. "DUES Inhouses"). Under **OAuth2**, copy the **Client ID**, then reset and copy the **Client Secret**.
2. In Supabase, go to **Authentication > Sign In / Providers > Discord**. Turn it on and paste the ID and secret. Copy the **Callback URL** it shows (it ends in `/auth/v1/callback`).
3. Back in Discord, **OAuth2 > Redirects > Add Redirect**: paste that callback URL and save.
4. In Supabase, still under **Sign In / Providers**, **turn off Email** (and anonymous sign-ins if they're on). The site only uses Discord, and leaving email sign-up on lets people create accounts that aren't tied to Discord.

### 3. The site (Vercel)

1. Push the repository to GitHub.
2. In Vercel, **Add New > Project** and import the repository. Set **Root Directory** to `dues-inhouse`, because the app isn't at the top of the repository (otherwise Vercel says it can't find Next.js).
3. Before deploying, open **Environment Variables** and add these:

   | Name | Where to find it |
   | --- | --- |
   | `DATABASE_URL` | Supabase **Connect** (top bar) > **Transaction pooler** connection string (port 6543, host `…pooler.supabase.com`, user `postgres.<project ref>`), with your password filled in. **Not** the *Direct connection* (`db.<ref>.supabase.co`): Vercel can't reach it and every page times out. Vercel's Supabase integration sets `POSTGRES_URL` instead; copy its pooler value into `DATABASE_URL` |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase **Project Settings > Data API**: Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase **Project Settings > API Keys**: the publishable (anon) key |
   | `ADMIN_DISCORD_IDS` | Your Discord user id (Discord settings > Advanced > Developer Mode on, then right-click your name > Copy User ID). Separate several with commas |
   | `HENRIKDEV_API_KEY` | Your HenrikDev key (`HDEV-...`) |
   | `CRON_SECRET` | Any long random text; the schedule sends it to the site's scheduled checks |
   | `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY` | Discord Developer Portal > your application > **General Information**: Application ID and Public Key |
   | `DISCORD_BOT_TOKEN` | Same application > **Bot** > Reset Token |
   | `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID` | Right-click the club's server, then the weeklies channel > **Copy ID** |

4. Under **Settings > Functions > Function Region**, pick **Dublin (`dub1`)** so the site sits next to the database. On the US default, every database query crosses the Atlantic and pages are noticeably slower.
5. Deploy, and copy the site's address (e.g. `https://dues-inhouse.vercel.app`).
6. In Supabase, open **Authentication > URL Configuration**. Set **Site URL** to that address, and add `https://<your address>/**` under **Redirect URLs**, including the two stars. Sign-in comes back to `/auth/callback?next=...`, and an entry without the stars doesn't match it: Supabase then drops you on the home page, still signed out, with `?code=` in the address. Always open the site at that address, not a deployment's own `…-<hash>.vercel.app` address, or sign-in can't finish.
7. Open the site and **Sign in with Discord**. Your id is in `ADMIN_DISCORD_IDS`, so you're an admin. Make other committee members officers on **Admin > Members** once they've signed in.

> **Troubleshooting:** if a page shows an error after deploying, open the deployment's **Logs** in Vercel. `DATABASE_URL is not set` means the variable is missing, or was added after the deploy (redeploy). A timeout or `ENOTFOUND` means it's the direct connection rather than the pooler.

### 4. The Discord bot

Use the same Discord application as the sign-in.

1. **Bot**: turn off **Public Bot**. Optionally turn on **Server Members Intent**, so the DUES member check can read the whole server at once.
2. **Installation** (or **OAuth2 > URL Generator**): scopes `bot` and `applications.commands`; bot permissions **View Channels**, **Send Messages** and **Embed Links**. Open the link and add the bot to the club's server, and make sure it can post in the weeklies channel.
3. **General Information > Interactions Endpoint URL**: `https://<your address>/api/discord`, then **Save**. Discord tests the address first, so the site must already be deployed with `DISCORD_PUBLIC_KEY` set. Use the production address: Vercel's Deployment Protection blocks Discord from preview addresses.
4. Register the slash commands from your computer, with the four `DISCORD_` values in `dues-inhouse/.env.local`:
   ```
   cd dues-inhouse
   npm run discord:register
   ```
   Run it again whenever `lib/discord/commands.ts` changes.

Officers in the bot are the site's officers and admins, anyone in `ADMIN_DISCORD_IDS`, and anyone with **Manage Server** in Discord.

**DUES members.** Anyone with the **Trinity** role in the Discord server counts as a member (change it with `DUES_MEMBER_ROLE`). The bot reads the role whenever someone uses the bot or signs in to the site, and for everyone during the Sunday import or from **Admin > Members > Check Discord roles now**. With **Server Members Intent** on, it checks the whole server in one request; without it, it asks about people one at a time, which is slower but works. An officer can also set anyone to Yes or No by hand on **Admin > Members**. Only people with a profile (signed in, or added on Admin > Members) can be members. Players the site only knows from game logs show under Everyone.

### 5. The schedule (GitHub Actions)

In the GitHub repository, go to **Settings > Secrets and variables > Actions**:

- **Variables** tab: `SITE_URL` = the site's address, e.g. `https://dues-inhouse.vercel.app` (no trailing slash).
- **Secrets** tab: `CRON_SECRET` = the same value as on Vercel.

Then run **Actions > Weekly schedule > Run workflow** once to check it works; the log should end with a JSON reply, not an error. From then on it runs by itself. It only calls the Vercel site, so it doesn't need GitHub Pages or a domain. GitHub pauses schedules in public repositories after 60 days with no commits (it emails first, and one click re-enables them); the weekly Vercel cron keeps the Sunday import going meanwhile.

### 6. Bring over the Overtime data

1. **Admin > Members > Import the old roster**: upload the Overtime `config/players.csv`. Everyone on it becomes a roster entry with their accounts linked, and merges into their profile when they sign in.
2. **Admin > Games > Upload games**: zip the Overtime `logs/` and `valorant/` folders and drop the zip in. Files already imported are skipped, so it's safe to repeat.

## Running a night

### Overwatch

The host saves logs as before: ScrimTime with Log Generator and Player Stat Summary on, and *Enable Workshop Inspector Log File* in Overwatch's settings. Afterwards an officer uploads the night's files from `Documents/Overwatch/Workshop` on **Admin > Games**.

### Valorant (Saturday weeklies)

It runs itself in the weeklies channel:

1. **17:00:** the bot posts sign-ups. New players use `/link Name#TAG` once; after that it's the **Join** button.
2. **18:45:** with at least 10 signed up, it posts balanced teams and pings the ten. With fewer, it says so, and an officer starts with `/weekly teams` when ready.
3. **Map vote:** the ten press a map button. Voting closes when all ten have voted or after 2 minutes. After that **Lock in map** works for anyone in the lobby, and officers can lock it any time. Ties are settled at random, and maps already played that night aren't offered.
4. The host makes the custom lobby with those teams on that map.
5. **Result:** within about 10 minutes of the game ending, the bot posts the score, each player's rating change and their place in the lobby. A custom game only counts as that weekly game if all ten players were in it, on that map, during the session.
6. **Check-in for the next game:** the bot asks that night's players **I'm in** or **I'm out**, and newcomers can press **I'm in** too. Teams are made as soon as ten are in and everyone has answered, or after 5 minutes with ten in; an officer can press **Make teams** to go with fewer. With more than ten in, whoever sat out last plays first. Teams differ from earlier splits that night.
7. **Sunday:** in the morning and afternoon, a full import checks every linked account for anything missed and posts a short summary. The night closes by itself, or `/weekly end` closes it early.

**Balancing** blends competitive rank (mostly current, some peak) with the leaderboard rating. Rank counts fully on someone's first night and less as they play: after 8 games the two count equally (`WEEKLY_RANK_GAMES`). Each player's rank is refreshed when they join, at most every 3 days.

Officers can run a session on any day with `/weekly open` in a channel; games then count from half an hour before until 12 hours after. Without the bot, customs in the Saturday window with at least 3 linked members are still imported, and **Fetch now** on **Admin > Games** still works.

### How ratings work

[Openskill](https://github.com/philihp/openskill.js) (Plackett-Luce): an overall rating per game, plus tank, damage and support ratings in Overwatch.

In Valorant everyone starts on 1,000 whatever their rank, and only games move it:

- Winning or losing sets the direction.
- The round margin scales the whole game: 13–11 is about 0.86×, 13–3 about 1.2× (`VAL_MARGIN_WEIGHT`).
- Performance in the lobby (mostly ACS, plus K/D and ADR) shares each team's change out between teammates, by up to ±30% (`VAL_PERF_WEIGHT`).

Winners never lose rating and losers never gain. Ratings are recomputed from the stored games, so changing a weight re-rates every past game. Competitive rank (current and peak) is used only to balance teams.

## Configuration

**New season / reset ratings:** on **Admin > Games > Season**, pick a start date. Only games from that day count, and everyone starts again on 1,000. Older games stay saved but are left out, and imports don't bring them back. Clear the date to count every game again.

**Files to edit:**

- **Heroes or agents:** [`config/heroes.yaml`](../dues-inhouse/config/heroes.yaml), [`config/agents.yaml`](../dues-inhouse/config/agents.yaml). The leaderboards say when one is missing.
- **Map pool:** [`config/maps.yaml`](../dues-inhouse/config/maps.yaml). Keep it to the current competitive rotation.
- **Levels:** [`lib/levels.ts`](../dues-inhouse/lib/levels.ts) (XP per game and the level curve).

**Optional environment variables** (on Vercel):

| Variable | Default | What it does |
| --- | --- | --- |
| `MIN_GAMES_RANKED` | `3` | Games before someone gets a rank number. Until then they're shown as provisional, below the ranked players |
| `VAL_PERF_WEIGHT` | `0.3` | How far performance moves a rating change (±30%). `0` for result-only ratings |
| `VAL_MARGIN_WEIGHT` | `0.2` | How much the round margin counts. `0` to ignore it |
| `VAL_WINDOW` | `sat 18:30-03:30` | When imported customs must start. `off` for any time |
| `VAL_MIN_PLAYERS` / `VAL_MIN_MEMBERS` | `10` / `3` | Players in a game, and linked members among them, for it to count |
| `VAL_REGION` | `eu` | Riot region for the HenrikDev API |
| `CLUB_TIME_ZONE` | `Europe/Dublin` | Time zone for nights and the schedule |
| `WEEKLY_AUTO` | `1` | `0`: officers open sign-ups and make teams themselves |
| `WEEKLY_SIGNUPS_OPEN` / `WEEKLY_TEAMS_AT` | `17:00` / `18:45` | Saturday times, Irish time |
| `WEEKLY_VOTE_SECONDS` | `120` | How long the map vote lasts |
| `WEEKLY_CHECKIN_SECONDS` | `300` | How long the check-in before each later game waits |
| `WEEKLY_RANK_GAMES` | `8` | Games after which rank and leaderboard rating count equally in balancing |
| `HENRIK_RATE_LIMIT` | `28` | HenrikDev requests a minute, site-wide (the key allows 30) |
| `DISCORD_LOG_CHANNEL_ID` | `DISCORD_CHANNEL_ID` | Where the Sunday import summary goes |
| `DUES_MEMBER_ROLE` | `Trinity` | Discord role (name or id) that marks a DUES member. `off` to stop reading it |

If you move the Saturday times a lot, check that the times in [`schedule.yml`](../.github/workflows/schedule.yml) still cover them.

## Local development

Needs Node 20 or newer and PostgreSQL 15 or newer. All commands run from the `dues-inhouse` folder.

```bash
cd dues-inhouse
npm install
npm run db:local                       # starts Postgres in .data/ and loads the schema
cp .env.example .env.local             # set DATABASE_URL to what db:local printed, and DEV_LOGIN=1
DATABASE_URL=postgres://postgres@localhost:5433/dues npm run db:seed-demo   # an invented demo season
npm run dev                            # http://localhost:3000
npm test                               # uses a separate dues_test database (TEST_DATABASE_URL to change it)
DATABASE_SERIAL=1 npm test             # the same, but one query at a time, as on the live site
npm run typecheck
```

With `DEV_LOGIN=1`, the sign-in page lets you act as any player without Discord. It never works in production.

**On Windows** without a system Postgres, the [`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres) npm package can run one on port 5433 instead of `db:local`. It needs a password, so point the tests at it with `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/dues_test`.

To check the HenrikDev API against a real account (with `HENRIKDEV_API_KEY` in `.env.local`), run `npm run henrik:check -- "Name#TAG"`. It prints the account's rank and its last 10 custom games, with what the import would do with each.

## Limitations

- Valorant games are only found if a linked member was in the lobby, and only while the game is still among that member's last 10 custom games. With checks during the session and on Sunday, that's rarely a problem.
- `/link` approves a Riot ID straight away, since the API shows the account exists, but it can't prove the account belongs to that person. An account someone else already linked can't be taken, and officers can remove a wrong link on **Admin > Members**.
- GitHub can start scheduled runs 5–15 minutes late, so teams may appear a little after 18:45. An officer can always use `/weekly teams`.
- The HenrikDev key allows 30 requests a minute. Everything the site sends to HenrikDev shares one count of 28 a minute, kept in the database. Rank refreshes are skipped when it's busy, so they never hold up results. Using the same key elsewhere at the same time counts against the same 30.
- The HenrikDev API is unofficial and run by one person. If it changes or stops, typed-in scoreboards still work.
- Riot leaves its per-player performance score empty for custom games, so the site doesn't show one.
- Ratings from one term are noisy; treat small gaps as ties.
- The site is public. Members should know their in-game names and stats appear on it.
