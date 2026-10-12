/**
 * The weekly cycle, as data: a session per club night, sign-ups for the first
 * game, a check-in before each later one (so someone leaving is swapped for
 * whoever is waiting), balanced teams and a map vote among each game's ten.
 * Discord is only the front end (lib/discord); everything here is plain database work.
 */
import { db, type Tx } from "../db";
import { mapPool } from "../games";
import { display } from "../ratings";
import { getSite } from "../season";
import { nightKey } from "../time";
import { fetchRank } from "../val/fetch";
import { parseWindow, weeklyWindow, type Window } from "../val/window";
import { balanceTeams, chooseLineup } from "./balance";
import { lobbyStrengths, type Strength } from "./strength";

export class WeeklyError extends Error {}

export const LOBBY_SIZE = 10;
export const voteSeconds = () => Number(process.env.WEEKLY_VOTE_SECONDS ?? 120);
export const checkinSeconds = () => Number(process.env.WEEKLY_CHECKIN_SECONDS ?? 300);

export interface Session {
  id: number;
  night: string;
  status: "signup" | "playing" | "closed";
  windowStart: Date;
  windowEnd: Date;
  channelId: string | null;
  signupMessageId: string | null;
  checkinFor: number | null;
  checkinMessageId: string | null;
  checkinClosesAt: Date | null;
}

export interface Game {
  id: number;
  sessionId: number;
  number: number;
  status: "voting" | "ready" | "played" | "cancelled";
  teamA: string[];
  teamB: string[];
  mapOptions: string[];
  mapName: string | null;
  voteClosesAt: Date;
  messageId: string | null;
  matchId: string | null;
  createdAt: Date;
}

type Sql = ReturnType<typeof db> | Tx;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const toSession = (r: Row): Session => ({
  id: r.id, night: typeof r.night === "string" ? r.night : new Date(r.night).toISOString().slice(0, 10), status: r.status,
  windowStart: new Date(r.window_start), windowEnd: new Date(r.window_end), channelId: r.channel_id, signupMessageId: r.signup_message_id,
  checkinFor: r.checkin_for, checkinMessageId: r.checkin_message_id, checkinClosesAt: r.checkin_closes_at ? new Date(r.checkin_closes_at) : null,
});
const toGame = (r: Row): Game => ({
  id: r.id, sessionId: r.session_id, number: r.number, status: r.status, teamA: r.team_a, teamB: r.team_b,
  mapOptions: r.map_options, mapName: r.map_name, voteClosesAt: new Date(r.vote_closes_at), messageId: r.message_id,
  matchId: r.match_id, createdAt: new Date(r.created_at),
});

/**
 * The window games must start in to count for a session opened at `now`: the
 * weekly window when it's that day (VAL_WINDOW), otherwise an ad-hoc evening
 * from half an hour ago to 12 hours ahead, for one-off events.
 */
export function sessionWindow(now: Date): Window {
  const spec = parseWindow();
  if (spec) {
    const w = weeklyWindow(now, spec);
    if (w.start.getTime() - now.getTime() < 18 * 3600 * 1000) return w;
  }
  return { start: new Date(now.getTime() - 30 * 60 * 1000), end: new Date(now.getTime() + 12 * 3600 * 1000) };
}

export async function getSession(id: number, sql: Sql = db()): Promise<Session | null> {
  const [r] = await sql`select * from weekly_sessions where id = ${id}`;
  return r ? toSession(r) : null;
}

/** The newest session that isn't closed. */
export async function currentSession(sql: Sql = db()): Promise<Session | null> {
  const [r] = await sql`select * from weekly_sessions where status <> 'closed' order by window_start desc limit 1`;
  return r ? toSession(r) : null;
}

export async function openSession(opts: { now?: Date; channelId: string | null; by: string | null }): Promise<Session> {
  const now = opts.now ?? new Date();
  const w = sessionWindow(now);
  const night = nightKey(w.start);
  const sql = db();
  const [existing] = await sql`select * from weekly_sessions where night = ${night}`;
  if (existing) {
    if (existing.status !== "closed") throw new WeeklyError("Sign-ups for tonight are already open.");
    // Reopening a closed night: keep its games, take sign-ups again.
    const [r] = await sql`update weekly_sessions set status = 'signup', channel_id = coalesce(${opts.channelId}, channel_id)
                          where id = ${existing.id} returning *`;
    return toSession(r);
  }
  const [r] = await sql`
    insert into weekly_sessions (night, window_start, window_end, channel_id, created_by)
    values (${night}, ${w.start}, ${w.end}, ${opts.channelId}, ${opts.by}) returning *`;
  return toSession(r);
}

export async function setSignupMessage(sessionId: number, channelId: string, messageId: string) {
  await db()`update weekly_sessions set channel_id = ${channelId}, signup_message_id = ${messageId} where id = ${sessionId}`;
}

export async function setCheckinMessage(sessionId: number, messageId: string) {
  await db()`update weekly_sessions set checkin_message_id = ${messageId} where id = ${sessionId}`;
}

export async function setGameMessage(gameId: number, messageId: string) {
  await db()`update weekly_games set message_id = ${messageId} where id = ${gameId}`;
}

export interface Signup { playerId: string; name: string; discordId: string | null; at: Date }

/** Tonight's roster: everyone who signed up, or checked in for a later game. */
export async function signups(sessionId: number, sql: Sql = db()): Promise<Signup[]> {
  const rows = await sql`
    select s.player_id, s.signed_up_at, p.display_name, p.discord_id from weekly_signups s join players p on p.id = s.player_id
    where s.session_id = ${sessionId} order by s.signed_up_at, s.player_id`;
  return rows.map((r) => ({ playerId: r.player_id, name: r.display_name, discordId: r.discord_id, at: new Date(r.signed_up_at) }));
}

export async function hasRiotId(playerId: string, sql: Sql = db()): Promise<boolean> {
  const [r] = await sql`select 1 from game_accounts where player_id = ${playerId} and game = 'valorant' and status = 'approved'`;
  return Boolean(r);
}

const NEED_LINK = "Link your Riot ID first: `/link Name#TAG`. You only need to do it once.";

export async function join(sessionId: number, playerId: string): Promise<"joined" | "already"> {
  const sql = db();
  const s = await getSession(sessionId, sql);
  if (!s || s.status === "closed") throw new WeeklyError("This session is closed.");
  if (!(await hasRiotId(playerId, sql))) throw new WeeklyError(NEED_LINK);
  const rows = await sql`insert into weekly_signups (session_id, player_id, signed_up_at) values (${sessionId}, ${playerId}, ${new Date()})
                         on conflict do nothing returning player_id`;
  return rows.length ? "joined" : "already";
}

export async function leave(sessionId: number, playerId: string): Promise<"left" | "not signed up"> {
  const rows = await db()`delete from weekly_signups where session_id = ${sessionId} and player_id = ${playerId} returning player_id`;
  return rows.length ? "left" : "not signed up";
}

/** Refresh a player's competitive rank if it's more than a few days old. Best effort: balancing copes without it. */
export async function refreshRank(playerId: string, maxAgeDays = 3): Promise<void> {
  const sql = db();
  const accounts = await sql`
    select id, account, puuid from game_accounts where player_id = ${playerId} and game = 'valorant' and status = 'approved'
      and (rank_checked_at is null or rank_checked_at < now() - make_interval(days => ${maxAgeDays}))`;
  for (const a of accounts) {
    try {
      // Low priority: skipped when the API budget is busy, so it never delays results. Tried again next join.
      const r = await fetchRank({ puuid: a.puuid, account: a.account }, undefined, undefined, "low");
      await sql`update game_accounts set current_tier = ${r.current}, peak_tier = coalesce(${r.peak}, peak_tier), rank_checked_at = now()
                where id = ${a.id}`;
    } catch (e) {
      console.warn(`could not refresh the rank of ${a.account}`, (e as Error).message);
    }
  }
}

// ---------- check-ins between games ----------

export interface Checkin {
  gameNumber: number;
  closesAt: Date;
  playing: Signup[];
  out: Signup[];
  /** On tonight's roster, not yet answered, and didn't say "out" last time. */
  waiting: Signup[];
}

/**
 * Open the check-in for the next game (after a result, or when someone presses
 * Next game). Doing it twice is harmless. Not while a map vote is running.
 */
export async function openCheckin(sessionId: number, now = new Date()): Promise<{ session: Session; fresh: boolean }> {
  return db().begin(async (tx) => {
    const [s] = await tx`select * from weekly_sessions where id = ${sessionId} for update`;
    if (!s || s.status === "closed") throw new WeeklyError("This session is closed.");
    const [last] = await tx`select * from weekly_games where session_id = ${sessionId} order by number desc limit 1`;
    if (!last) throw new WeeklyError("The first game's teams come from the sign-ups. An officer can make them with `/weekly teams`.");
    if (last.status === "voting") throw new WeeklyError(`Game ${last.number}'s map vote is still open.`);
    const next = last.number + 1;
    if (s.checkin_for === next) return { session: toSession(s), fresh: false };
    const [u] = await tx`update weekly_sessions set checkin_for = ${next}, checkin_message_id = null,
                         checkin_closes_at = ${new Date(now.getTime() + checkinSeconds() * 1000)}
                         where id = ${sessionId} returning *`;
    return { session: toSession(u), fresh: true };
  });
}

export async function checkinState(sessionId: number, sql: Sql = db()): Promise<Checkin | null> {
  const s = await getSession(sessionId, sql);
  if (!s?.checkinFor) return null;
  const roster = await signups(sessionId, sql);
  const answers = await sql`select player_id, playing, answered_at from weekly_checkins
                            where session_id = ${sessionId} and game_number = ${s.checkinFor} order by answered_at, player_id`;
  const outBefore = new Set((await sql`select player_id from weekly_checkins
    where session_id = ${sessionId} and game_number = ${s.checkinFor - 1} and not playing`).map((r) => r.player_id));
  const byId = new Map(roster.map((p) => [p.playerId, p]));
  const answered = new Set(answers.map((a) => a.player_id));
  const pick = (yes: boolean) => answers.filter((a) => a.playing === yes).map((a) => byId.get(a.player_id)).filter((p): p is Signup => Boolean(p));
  return {
    gameNumber: s.checkinFor, closesAt: s.checkinClosesAt!, playing: pick(true), out: pick(false),
    waiting: roster.filter((p) => !answered.has(p.playerId) && !outBefore.has(p.playerId)),
  };
}

/** Teams can be made once ten are in and everyone has answered, or ten are in and time is up. */
export const checkinReady = (c: Checkin, now = new Date()) =>
  c.playing.length >= LOBBY_SIZE && (c.waiting.length === 0 || now >= c.closesAt);

export async function checkIn(sessionId: number, playerId: string, playing: boolean): Promise<Checkin> {
  const sql = db();
  const s = await getSession(sessionId, sql);
  if (!s || s.status === "closed") throw new WeeklyError("This session is closed.");
  if (!s.checkinFor) throw new WeeklyError("There's no check-in open right now.");
  if (playing) {
    if (!(await hasRiotId(playerId, sql))) throw new WeeklyError(NEED_LINK);
    await sql`insert into weekly_signups (session_id, player_id, signed_up_at) values (${sessionId}, ${playerId}, ${new Date()})
              on conflict do nothing`;
  }
  await sql`insert into weekly_checkins (session_id, game_number, player_id, playing, answered_at)
            values (${sessionId}, ${s.checkinFor}, ${playerId}, ${playing}, ${new Date()})
            on conflict (session_id, game_number, player_id) do update set playing = excluded.playing`;
  return (await checkinState(sessionId, sql))!;
}

// ---------- games ----------

export async function sessionGames(sessionId: number, sql: Sql = db()): Promise<Game[]> {
  return (await sql`select * from weekly_games where session_id = ${sessionId} order by number`).map(toGame);
}

export async function getGame(id: number, sql: Sql = db()): Promise<Game | null> {
  const [r] = await sql`select * from weekly_games where id = ${id}`;
  return r ? toGame(r) : null;
}

export interface PlayerStanding extends Strength { rating: number; games: number }

/**
 * For balancing a lobby: each player's leaderboard rating and games (from the
 * latest results), their rank, and the blend of the two that teams are balanced on.
 */
export async function standings(players: string[]): Promise<Map<string, PlayerStanding>> {
  if (!players.length) return new Map();
  const site = await getSite();
  const ranks = await db()`
    select player_id, max(current_tier) as current, max(peak_tier) as peak from game_accounts
    where game = 'valorant' and status = 'approved' and player_id = any(${db().array(players)}::uuid[]) group by player_id`;
  const rankOf = new Map(ranks.map((r) => [r.player_id, r]));
  const input = players.map((p) => {
    const r = site.val.book.get(p);
    return { player: p, rating: display(r.mu), games: r.maps, current: rankOf.get(p)?.current ?? null, peak: rankOf.get(p)?.peak ?? null };
  });
  const strengths = lobbyStrengths(input);
  return new Map(input.map((x) => [x.player, { ...strengths.get(x.player)!, rating: x.rating, games: x.games }]));
}

/** Who wanted to play game n: the sign-ups for game 1, the check-in for later games. */
async function candidatesFor(sessionId: number, n: number, sql: Sql): Promise<string[]> {
  if (n === 1) return (await signups(sessionId, sql)).map((p) => p.playerId);
  return (await sql`select player_id from weekly_checkins where session_id = ${sessionId} and game_number = ${n} and playing
                    order by answered_at, player_id`).map((r) => r.player_id);
}

/**
 * Make the next game from the sign-ups (game 1) or the open check-in: pick the
 * ten (whoever sat out most goes first), balance them on rank and leaderboard
 * rating while avoiding earlier splits, and open a map vote without tonight's
 * maps. Making teams twice at once makes one game, not two.
 */
export async function startGame(sessionId: number, opts: { now?: Date; random?: () => number; minPlayers?: number } = {}):
  Promise<{ game: Game; resting: string[]; fresh: boolean }> {
  const now = opts.now ?? new Date();
  const sql = db();
  const before = await getSession(sessionId, sql);
  const games0 = await sessionGames(sessionId, sql);
  const n0 = before?.checkinFor ?? (games0.length ? null : 1);
  const standing = n0 ? await standings(await candidatesFor(sessionId, n0, sql)) : new Map<string, PlayerStanding>();
  return sql.begin(async (tx) => {
    const [s] = await tx`select * from weekly_sessions where id = ${sessionId} for update`;
    if (!s || s.status === "closed") throw new WeeklyError("This session is closed.");
    const games = (await tx`select * from weekly_games where session_id = ${sessionId} order by number`).map(toGame);
    const last = games.at(-1);
    if (last && last.status === "voting" && now.getTime() - last.createdAt.getTime() < 30_000) {
      return { game: last, resting: [], fresh: false };
    }
    const n = s.checkin_for ?? (games.length ? null : 1);
    if (!n) throw new WeeklyError("Open a check-in for the next game first (the **Next game** button, or `/weekly next`).");
    if (last?.status === "voting") throw new WeeklyError(`Game ${last.number}'s map vote is still open.`);
    const wanted = await candidatesFor(sessionId, n, tx);
    const min = opts.minPlayers ?? 2;
    if (wanted.length < min) throw new WeeklyError(`Only ${wanted.length} ${n === 1 ? "signed up" : "checked in"}; need at least ${min}.`);
    const played = games.filter((g) => g.status !== "cancelled");
    const satOut = new Map<string, number>();
    for (const g of played) {
      const lineup = new Set([...g.teamA, ...g.teamB]);
      for (const p of await candidatesFor(sessionId, g.number, tx)) if (!lineup.has(p)) satOut.set(p, (satOut.get(p) ?? 0) + 1);
    }
    const { playing, resting } = chooseLineup(wanted.map((p, i) => ({ player: p, sat: satOut.get(p) ?? 0, order: i })), LOBBY_SIZE);
    const strength = (p: string) => standing.get(p)?.strength ?? 1000;
    const split = balanceTeams(playing, strength, played.map((g) => [g.teamA, g.teamB]), opts.random);
    const usedMaps = new Set(played.map((g) => g.mapName?.toLowerCase()).filter(Boolean));
    let options = mapPool().filter((m) => !usedMaps.has(m.toLowerCase()));
    if (options.length < 2) options = mapPool();
    const [g] = await tx`
      insert into weekly_games (session_id, number, team_a, team_b, map_options, vote_closes_at, created_at)
      values (${sessionId}, ${n}, ${tx.array(split.a)}::uuid[], ${tx.array(split.b)}::uuid[],
              ${tx.array(options)}::text[], ${new Date(now.getTime() + voteSeconds() * 1000)}, ${now})
      returning *`;
    await tx`update weekly_sessions set status = 'playing', checkin_for = null where id = ${sessionId}`;
    return { game: toGame(g), resting, fresh: true };
  });
}

export async function votes(gameId: number, sql: Sql = db()): Promise<Map<string, string>> {
  const rows = await sql`select player_id, map_name from weekly_votes where game_id = ${gameId}`;
  return new Map(rows.map((r) => [r.player_id, r.map_name]));
}

/** A lobby player's vote (changing it is fine). Closes the vote once all ten have voted. */
export async function vote(gameId: number, playerId: string, map: string, opts: { now?: Date; random?: () => number } = {}):
  Promise<{ closed: Game | null }> {
  const sql = db();
  const g = await getGame(gameId, sql);
  if (!g || g.status !== "voting") throw new WeeklyError("Voting on this game has finished.");
  if (![...g.teamA, ...g.teamB].includes(playerId)) throw new WeeklyError("Only the ten players in this game can vote.");
  if (!g.mapOptions.includes(map)) throw new WeeklyError("That map isn't on the ballot.");
  await sql`insert into weekly_votes (game_id, player_id, map_name) values (${gameId}, ${playerId}, ${map})
            on conflict (game_id, player_id) do update set map_name = excluded.map_name`;
  return { closed: await closeVote(gameId, { ...opts, force: false }) };
}

/** Most votes wins; ties, and a vote nobody voted in, are settled at random. */
export function tally(options: string[], cast: Iterable<string>, random: () => number = Math.random): { winner: string; counts: Map<string, number> } {
  const counts = new Map(options.map((m) => [m, 0]));
  for (const m of cast) if (counts.has(m)) counts.set(m, counts.get(m)! + 1);
  const top = Math.max(...counts.values());
  const tied = options.filter((m) => counts.get(m) === top);
  return { winner: tied[Math.floor(random() * tied.length)], counts };
}

/**
 * Close the vote if it's due: everyone has voted, the time is up, or `force`
 * (an officer, or anyone in the lobby once time is up). Returns the game if
 * this call closed it, so only one caller announces the map.
 */
export async function closeVote(gameId: number, opts: { now?: Date; random?: () => number; force?: boolean } = {}): Promise<Game | null> {
  const now = opts.now ?? new Date();
  return db().begin(async (tx) => {
    const [r] = await tx`select * from weekly_games where id = ${gameId} for update`;
    if (!r || r.status !== "voting") return null;
    const g = toGame(r);
    const cast = await votes(gameId, tx);
    const everyone = [...g.teamA, ...g.teamB].every((p) => cast.has(p));
    if (!opts.force && !everyone && now < g.voteClosesAt) return null;
    const { winner } = tally(g.mapOptions, cast.values(), opts.random);
    const [u] = await tx`update weekly_games set status = 'ready', map_name = ${winner} where id = ${gameId} returning *`;
    return toGame(u);
  });
}

/** Votes whose time is up, for the scheduled check to close. */
export async function dueVotes(now = new Date()): Promise<number[]> {
  return (await db()`select id from weekly_games where status = 'voting' and vote_closes_at <= ${now} order by id`).map((r) => r.id);
}

export async function endSession(sessionId: number): Promise<Session | null> {
  const sql = db();
  await sql`update weekly_games set status = 'cancelled' where session_id = ${sessionId} and status = 'voting'`;
  const [r] = await sql`update weekly_sessions set status = 'closed', checkin_for = null where id = ${sessionId} and status <> 'closed' returning *`;
  return r ? toSession(r) : null;
}

/** Names and Discord ids of players, for messages. */
export async function people(ids: string[]): Promise<Map<string, { name: string; discordId: string | null }>> {
  if (!ids.length) return new Map();
  const rows = await db()`select id, display_name, discord_id from players where id = any(${db().array(ids)}::uuid[])`;
  return new Map(rows.map((r) => [r.id, { name: r.display_name, discordId: r.discord_id }]));
}
