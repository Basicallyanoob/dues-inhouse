/**
 * Automatic Valorant import. Every linked member's Riot ID is an anchor: the
 * site reads each anchor's recent custom games from the HenrikDev API and keeps
 * finished ones that started inside a weekly session window and either are a
 * game the Discord bot set up (all ten of its players, on its map) or have
 * enough members in the lobby. The free key allows 30 requests a minute, so
 * anchors are checked in batches, oldest-checked first, within a time budget.
 */
import { db, type Tx } from "../db";
import { saveValMatch } from "../ingest";
import { findWeeklyGame, linkWeeklyGame } from "../weekly/results";
import { isCustomGame, matchesIn, normaliseRiot, trim, type ApiMatch } from "./match";
import { RateLimited, takeSlot, type Priority } from "./limiter";
import { inWeeklyWindow, parseWindow } from "./window";

export function valSettings() {
  return {
    key: (process.env.HENRIKDEV_API_KEY ?? "").trim(),
    region: (process.env.VAL_REGION ?? "eu").trim().toLowerCase(),
    minPlayers: Number(process.env.VAL_MIN_PLAYERS ?? 10),
    minMembers: Number(process.env.VAL_MIN_MEMBERS ?? 3),
    gapMs: Number(process.env.VAL_REQUEST_GAP_MS ?? 2100), // keeps under 30 requests a minute
  };
}

export class FetchError extends Error {}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const API = "https://api.henrikdev.xyz/valorant";

/**
 * GET a HenrikDev endpoint. Every attempt first takes a slot from the shared
 * limiter (lib/val/limiter.ts), so the site stays under the key's limit; if
 * the API still says 429 (say the key was used elsewhere), wait as it asks.
 */
async function henrik(url: string, key: string, fetcher: Fetcher, deadline: number, priority: Priority = "high"): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await takeSlot(priority, deadline);
    } catch (e) {
      if (e instanceof RateLimited) throw new FetchError(e.message);
      throw e;
    }
    let res: Response;
    try {
      res = await fetcher(url, { headers: { Authorization: key, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    } catch (e) {
      throw new FetchError(`could not reach the API (${(e as Error).message})`);
    }
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 2) {
      const wait = 1000 * Math.min(60, Number(res.headers.get("retry-after")) || 20);
      if (Date.now() + wait + 9000 > deadline) throw new FetchError("rate limited; the rest will be checked next time");
      await sleep(wait);
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new FetchError("the API key was refused; check HENRIKDEV_API_KEY");
    if (res.status === 404) throw new FetchError("account not found: check the Riot ID and region");
    throw new FetchError(`the API answered ${res.status}`);
  }
  throw new FetchError("rate limited; try again in a minute");
}

const splitRiot = (account: string) => {
  const [name, ...tag] = account.split("#");
  return [encodeURIComponent(name.trim()), encodeURIComponent(tag.join("#").trim())];
};

/** An account's last 10 custom games. mode=custom filters on the API's side; isCustomGame checks again. */
export async function fetchHistory(account: string, key: string, region: string, fetcher: Fetcher = fetch,
  deadline = Date.now() + 20000): Promise<ApiMatch[]> {
  const [name, tag] = splitRiot(account);
  return matchesIn(await henrik(`${API}/v4/matches/${encodeURIComponent(region)}/pc/${name}/${tag}?mode=custom&size=10`, key, fetcher, deadline));
}

export interface Rank { current: number | null; peak: number | null }
export interface RiotAccount extends Rank { puuid: string; name: string; tag: string }

const tierOf = (t: ApiMatch | undefined) => (t && Number(t.id) >= 3 ? Number(t.id) : null);

/**
 * Current and peak competitive rank, used only to balance teams. By account id
 * when known (survives name changes), else by Riot ID. No rank data (never
 * played ranked, or the API has none) is null, not an error.
 */
export async function fetchRank(who: { puuid?: string | null; account: string }, region?: string, fetcher: Fetcher = fetch,
  priority: Priority = "high"): Promise<Rank> {
  const s = valSettings();
  if (!s.key) throw new FetchError("no API key: set HENRIKDEV_API_KEY in the site's environment variables");
  const r = encodeURIComponent((region || s.region).toLowerCase());
  const [name, tag] = splitRiot(who.account);
  const urls = [
    ...(who.puuid ? [`${API}/v3/by-puuid/mmr/${r}/pc/${encodeURIComponent(who.puuid)}`] : []),
    `${API}/v3/mmr/${r}/pc/${name}/${tag}`,
  ];
  for (const url of urls) {
    try {
      const mmr = ((await henrik(url, s.key, fetcher, Date.now() + 20000, priority)) as ApiMatch)?.data ?? {};
      return { current: tierOf(mmr.current?.tier), peak: tierOf(mmr.peak?.tier) };
    } catch (e) {
      // Only "not found" is worth a second try by name; anything else (rate limit, outage) would just repeat.
      if (!(e instanceof FetchError) || !/not found/.test(e.message)) throw e;
    }
  }
  return { current: null, peak: null };
}

/** Look a Riot ID up: its account id (which survives name changes) and its rank. */
export async function lookupAccount(account: string, fetcher: Fetcher = fetch): Promise<RiotAccount> {
  const s = valSettings();
  if (!s.key) throw new FetchError("no API key: set HENRIKDEV_API_KEY in the site's environment variables");
  const [name, tag] = splitRiot(account);
  const acc = ((await henrik(`${API}/v2/account/${name}/${tag}`, s.key, fetcher, Date.now() + 20000)) as ApiMatch)?.data ?? {};
  if (!acc.puuid) throw new FetchError("account not found: check the Riot ID");
  const found = { puuid: String(acc.puuid), name: String(acc.name ?? ""), tag: String(acc.tag ?? "") };
  const rank = await fetchRank({ account: found.name && found.tag ? `${found.name}#${found.tag}` : account }, acc.region, fetcher);
  return { ...found, ...rank };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchReport {
  checked: string[];
  remaining: number;
  added: string[];
  duplicates: number;
  skipped: Record<string, number>;
  errors: string[];
  /** Weekly games whose custom game was found in this run. */
  weekly: { gameId: number; matchId: string }[];
}

const blankReport = (): FetchReport => ({ checked: [], remaining: 0, added: [], duplicates: 0, skipped: {}, errors: [], weekly: [] });

interface Context {
  sql: ReturnType<typeof db> | Tx;
  memberKeys: Set<string>;
  memberIds: Set<string>;
  sessions: { start: Date; end: Date }[];
  minPlayers: number;
  minMembers: number;
  uploader: string | null;
}

async function context(uploader: string | null): Promise<Context> {
  const sql = db();
  const s = valSettings();
  const members = await sql`select account_key, puuid from game_accounts where game = 'valorant' and status = 'approved'`;
  const sessions = await sql`select window_start, window_end from weekly_sessions where window_end > now() - interval '21 days'`;
  return {
    sql, uploader, minPlayers: s.minPlayers, minMembers: s.minMembers,
    memberKeys: new Set(members.map((m) => m.account_key as string)),
    memberIds: new Set(members.filter((m) => m.puuid).map((m) => m.puuid as string)),
    sessions: sessions.map((r) => ({ start: new Date(r.window_start), end: new Date(r.window_end) })),
  };
}

const skip = (report: FetchReport, why: string) => { report.skipped[why] = (report.skipped[why] ?? 0) + 1; };

/** Sort one account's history into saved, duplicate and skipped games. */
async function processHistory(history: ApiMatch[], ctx: Context, report: FetchReport) {
  const spec = parseWindow();
  for (const raw of history) {
    const [ok, why] = isCustomGame(raw, ctx.minPlayers);
    if (!ok) { skip(report, why); continue; }
    const m = trim(raw);
    const inSession = ctx.sessions.some((w) => w.start <= m.playedAt && m.playedAt < w.end);
    if (!inSession && !inWeeklyWindow(m.playedAt, spec)) { skip(report, "outside the session window"); continue; }
    const weeklyGame = await findWeeklyGame(m, ctx.sql);
    if (weeklyGame === null) {
      const inLobby = m.players.filter((p) => ctx.memberIds.has(p.puuid) || ctx.memberKeys.has(normaliseRiot(`${p.name}#${p.tag}`))).length;
      if (inLobby < ctx.minMembers) { skip(report, `fewer than ${ctx.minMembers} members in the lobby`); continue; }
    }
    if ((await saveValMatch(m, ctx.uploader, ctx.sql, raw)) === "added") report.added.push(`${m.mapName} ${m.score[0]}–${m.score[1]}`);
    else report.duplicates++;
    if (weeklyGame !== null && (await linkWeeklyGame(weeklyGame, m.id, ctx.sql))) report.weekly.push({ gameId: weeklyGame, matchId: m.id });
  }
}

/**
 * Check anchors not checked since `since`, stopping before `budgetMs` runs out.
 * Call again until `remaining` is 0 to cover everyone.
 */
export async function fetchBatch(opts: { since?: Date; budgetMs?: number; fetcher?: Fetcher; uploader?: string | null } = {}): Promise<FetchReport> {
  const s = valSettings();
  if (!s.key) throw new FetchError("no API key: set HENRIKDEV_API_KEY in the site's environment variables");
  const ctx = await context(opts.uploader ?? null);
  const sql = ctx.sql;
  const since = opts.since ?? new Date(Date.now() - 6 * 3600 * 1000);
  const deadline = Date.now() + (opts.budgetMs ?? 40000);
  const report = blankReport();

  const anchors = await sql`
    select id, account from game_accounts
    where game = 'valorant' and status = 'approved' and (last_checked_at is null or last_checked_at < ${since})
    order by last_checked_at nulls first, id`;

  let i = 0;
  for (; i < anchors.length; i++) {
    if (Date.now() + s.gapMs + 8000 > deadline) break;
    const a = anchors[i];
    if (i > 0) await sleep(s.gapMs);
    try {
      await processHistory(await fetchHistory(a.account, s.key, s.region, opts.fetcher, deadline), ctx, report);
      report.checked.push(a.account);
    } catch (e) {
      if (e instanceof FetchError && /key/.test(e.message)) throw e;
      if (e instanceof FetchError && /rate limited/.test(e.message)) { report.errors.push(e.message); break; }
      report.errors.push(`${a.account}: ${(e as Error).message}`);
    }
    await sql`update game_accounts set last_checked_at = now() where id = ${a.id}`;
  }
  report.remaining = anchors.length - i;
  return report;
}

/**
 * During a session: one API call. Reads the custom games of whichever player in
 * an unfinished weekly game was checked longest ago, so results appear in
 * Discord shortly after each game.
 */
export async function fetchLobby(sessionId: number, opts: { fetcher?: Fetcher } = {}): Promise<FetchReport | null> {
  const s = valSettings();
  if (!s.key) throw new FetchError("no API key: set HENRIKDEV_API_KEY in the site's environment variables");
  const sql = db();
  const [a] = await sql`
    select a.id, a.account from weekly_games g
    cross join lateral unnest(g.team_a || g.team_b) as lineup(player_id)
    join game_accounts a on a.player_id = lineup.player_id and a.game = 'valorant' and a.status = 'approved'
    where g.session_id = ${sessionId} and g.status in ('voting', 'ready')
    order by a.last_checked_at nulls first, a.id limit 1`;
  if (!a) return null;
  const ctx = await context(null);
  const report = blankReport();
  try {
    await processHistory(await fetchHistory(a.account, s.key, s.region, opts.fetcher), ctx, report);
    report.checked.push(a.account);
  } catch (e) {
    if (!(e instanceof FetchError)) throw e;
    report.errors.push(`${a.account}: ${e.message}`);
  }
  await sql`update game_accounts set last_checked_at = now() where id = ${a.id}`;
  return report;
}
