-- DUES Inhouses database. Run once in Supabase: SQL Editor > New query > paste > Run.
-- Safe to run again: everything is "if not exists".
-- The site talks to the database only from its server, so row level security
-- is switched on with no policies: the public API keys can read nothing.

create extension if not exists pgcrypto;

-- People. A row exists for everyone who signs in with Discord, and for roster
-- members an officer added before they signed in (auth_id is then null).
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique,
  discord_id text unique,
  display_name text not null,
  slug text not null unique,
  avatar_url text,
  role text not null default 'member' check (role in ('member', 'officer', 'admin')),
  note varchar(75),
  created_at timestamptz not null default now()
);

-- In-game accounts. A member asks to link one; an officer approves it, which
-- joins every past and future game on that account to the member's profile.
create table if not exists game_accounts (
  id serial primary key,
  player_id uuid not null references players(id) on delete cascade,
  game text not null check (game in ('overwatch', 'valorant')),
  account text not null,          -- as typed: BattleTag Name#1234 or Riot ID Name#Tag
  account_key text not null,      -- normalised for matching
  puuid text,                     -- Valorant account id, learned from the first game seen
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references players(id) on delete set null,
  reviewed_at timestamptz,
  last_checked_at timestamptz,    -- Valorant: when its match history was last fetched
  created_at timestamptz not null default now()
);
-- One member per approved account; requests can queue up until an officer picks one.
create unique index if not exists game_accounts_approved on game_accounts (game, account_key) where status = 'approved';
create unique index if not exists game_accounts_request on game_accounts (player_id, game, account_key) where status <> 'rejected';
create index if not exists game_accounts_player on game_accounts (player_id);

-- Overwatch maps from ScrimTime logs. Player stats live in `data`.
create table if not exists ow_maps (
  id text primary key,
  fingerprint text not null unique,
  played_at timestamptz not null,
  map_name text not null,
  map_type text not null default '',
  team1 text not null,
  team2 text not null,
  score1 integer not null,
  score2 integer not null,
  complete boolean not null,
  duration real not null,
  data jsonb not null,
  source_file text,
  uploaded_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ow_maps_played on ow_maps (played_at);

-- Valorant games from the HenrikDev API or typed-in scoreboards.
create table if not exists val_matches (
  id text primary key,
  played_at timestamptz not null,
  map_name text not null,
  score_blue integer not null,
  score_red integer not null,
  length_ms integer not null default 0,
  source text not null default 'henrikdev',
  data jsonb not null,
  uploaded_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists val_matches_played on val_matches (played_at);

-- The full API response for each imported game, kept apart from val_matches so
-- pages don't load it. Lets later stats (KAST, multi-kills, plants, clutches,
-- weapons) be worked out for every past week without fetching anything again.
create table if not exists val_match_raw (
  id text primary key references val_matches(id) on delete cascade,
  raw jsonb not null,
  fetched_at timestamptz not null default now()
);

-- Every HenrikDev request in the last minute or two, shared by all server
-- instances, so the site as a whole stays under the key's 30 a minute.
create table if not exists api_calls (
  id bigserial primary key,
  at timestamptz not null default now()
);
create index if not exists api_calls_at on api_calls (at);

-- Valorant competitive tiers (3 = Iron 1 ... 27 = Radiant), current and peak,
-- read when a Riot ID is linked from Discord and refreshed when its player
-- joins a weekly. Used only to balance teams; everyone's rating starts level.
alter table game_accounts add column if not exists current_tier integer;
alter table game_accounts add column if not exists peak_tier integer;
alter table game_accounts add column if not exists rank_checked_at timestamptz;

-- Weeklies run from Discord: sign-ups, balanced teams, a map vote per game, and
-- the custom game the API later finds for each one.
create table if not exists weekly_sessions (
  id serial primary key,
  night date not null unique,              -- the club night (Saturday) it belongs to
  status text not null default 'signup' check (status in ('signup', 'playing', 'closed')),
  window_start timestamptz not null,       -- games count if they start inside the window
  window_end timestamptz not null,
  channel_id text,
  signup_message_id text,
  -- Before each game after the first, a check-in: who's playing the next one.
  checkin_for integer,                     -- the game number it's for; null when none is open
  checkin_message_id text,
  checkin_closes_at timestamptz,
  created_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The first game's sign-ups (everyone who played tonight is added here too).
create table if not exists weekly_signups (
  session_id integer not null references weekly_sessions(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  signed_up_at timestamptz not null default now(),
  primary key (session_id, player_id)
);

-- Check-ins for later games: each player says in or out again, so someone
-- leaving mid-night is swapped for whoever is waiting.
create table if not exists weekly_checkins (
  session_id integer not null references weekly_sessions(id) on delete cascade,
  game_number integer not null,
  player_id uuid not null references players(id) on delete cascade,
  playing boolean not null,
  answered_at timestamptz not null default now(),
  primary key (session_id, game_number, player_id)
);

create table if not exists weekly_games (
  id serial primary key,
  session_id integer not null references weekly_sessions(id) on delete cascade,
  number integer not null,
  status text not null default 'voting' check (status in ('voting', 'ready', 'played', 'cancelled')),
  team_a uuid[] not null,
  team_b uuid[] not null,
  map_options text[] not null,
  map_name text,
  vote_closes_at timestamptz not null,
  message_id text,
  match_id text references val_matches(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (session_id, number)
);
create index if not exists weekly_games_open on weekly_games (status) where status in ('voting', 'ready');

create table if not exists weekly_votes (
  game_id integer not null references weekly_games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  map_name text not null,
  primary key (game_id, player_id)
);

-- Small key/value settings; data_version changes whenever games change, so
-- the site knows to recompute ratings.
create table if not exists site_state (
  key text primary key,
  value text not null
);
insert into site_state (key, value) values ('data_version', '0') on conflict do nothing;

-- DUES membership, for the members-only leaderboards. dues_role follows the
-- member role in the Discord server (DUES_MEMBER_ROLE, "Trinity" by default);
-- an officer can override it either way (dues_override: null = follow Discord).
alter table players add column if not exists dues_role boolean not null default false;
alter table players add column if not exists dues_override boolean;
alter table players add column if not exists dues_checked_at timestamptz;

alter table players enable row level security;
alter table game_accounts enable row level security;
alter table ow_maps enable row level security;
alter table val_matches enable row level security;
alter table site_state enable row level security;
alter table val_match_raw enable row level security;
alter table api_calls enable row level security;
alter table weekly_sessions enable row level security;
alter table weekly_signups enable row level security;
alter table weekly_checkins enable row level security;
alter table weekly_games enable row level security;
alter table weekly_votes enable row level security;

-- Removed: the banner shop and Crests (banners, rolls, sets, promo codes, the
-- coin ledger and the daily reward). On a database set up before they were
-- removed, running this file again deletes their tables and columns; on a new
-- one these lines do nothing.
drop table if exists promo_redemptions, promo_codes, rolls, owned_banners, banners, banner_sets, ledger cascade;
alter table players drop column if exists banner_id;
alter table players drop column if exists last_daily;
