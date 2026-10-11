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
  banner_id integer,
  last_daily date,
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

-- Coins. The balance is the sum of a player's rows; nothing is ever edited in place.
create table if not exists ledger (
  id bigserial primary key,
  player_id uuid not null references players(id) on delete cascade,
  kind text not null check (kind in ('game', 'daily', 'promo', 'roll', 'purchase', 'refund', 'admin', 'prediction')),
  amount integer not null,
  ref text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists ledger_player on ledger (player_id, created_at desc);
-- A game pays each player once, however often it is re-imported.
create unique index if not exists ledger_game_once on ledger (player_id, ref) where kind = 'game';

-- Banners: the collectibles. Art is uploaded by officers; until then a banner
-- shows a placeholder in its rarity's colours.
create table if not exists banner_sets (
  id serial primary key,
  slug text not null unique,
  name text not null,
  description text not null default '',
  kind text not null default 'standard' check (kind in ('standard', 'limited')),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  roll_cost integer not null default 1000,
  rates jsonb not null default '{"common": 56, "rare": 30, "epic": 11, "legendary": 2.5, "ultimate": 0.5}',
  pity integer not null default 60,  -- the Nth roll without a legendary or better is guaranteed one; 0 turns it off
  featured_banner_id integer,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists banners (
  id serial primary key,
  name text not null,
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary', 'ultimate')),
  set_id integer references banner_sets(id) on delete set null,
  image_url text,
  media text not null default 'image' check (media in ('image', 'video')),
  credit text not null default '',
  buyable boolean not null default false,
  price integer,                   -- overrides the rarity's default price
  is_default boolean not null default false,  -- everyone owns it from the start
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists owned_banners (
  player_id uuid not null references players(id) on delete cascade,
  banner_id integer not null references banners(id) on delete cascade,
  how text not null default 'roll' check (how in ('roll', 'buy', 'promo', 'admin')),
  obtained_at timestamptz not null default now(),
  primary key (player_id, banner_id)
);

create table if not exists rolls (
  id bigserial primary key,
  player_id uuid not null references players(id) on delete cascade,
  set_id integer not null references banner_sets(id) on delete cascade,
  banner_id integer not null references banners(id) on delete cascade,
  rarity text not null,
  duplicate boolean not null,
  refund integer not null default 0,
  pity boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists rolls_player_set on rolls (player_id, set_id, id desc);

create table if not exists promo_codes (
  code text primary key,           -- stored in capitals
  reward text not null check (reward in ('coins', 'banner')),
  amount integer not null default 0,
  banner_id integer references banners(id) on delete cascade,
  max_uses integer,
  expires_at timestamptz,
  created_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists promo_redemptions (
  code text not null references promo_codes(code) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (code, player_id)
);

-- Small key/value settings; data_version changes whenever games change, so
-- the site knows to recompute ratings.
create table if not exists site_state (
  key text primary key,
  value text not null
);
insert into site_state (key, value) values ('data_version', '0') on conflict do nothing;

alter table players enable row level security;
alter table game_accounts enable row level security;
alter table ow_maps enable row level security;
alter table val_matches enable row level security;
alter table ledger enable row level security;
alter table banner_sets enable row level security;
alter table banners enable row level security;
alter table owned_banners enable row level security;
alter table rolls enable row level security;
alter table promo_codes enable row level security;
alter table promo_redemptions enable row level security;
alter table site_state enable row level security;
