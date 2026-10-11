/**
 * Automatic Valorant import. Every linked member's Riot ID is an anchor: the
 * site reads each anchor's recent games from the HenrikDev API and keeps
 * finished custom games with enough players, at least a few of them members.
 * The free key allows 30 requests a minute, so anchors are checked in batches,
 * oldest-checked first, within a time budget.
 */
import { db } from "../db";
import { saveValMatch } from "../ingest";
import { isCustomGame, matchesIn, normaliseRiot, trim, type ApiMatch } from "./match";

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

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export async function fetchHistory(account: string, key: string, region: string, fetcher: Fetcher = fetch, deadline = Infinity): Promise<ApiMatch[]> {
  const [name, ...tag] = account.split("#");
  const url = `https://api.henrikdev.xyz/valorant/v4/matches/${encodeURIComponent(region)}/pc/${encodeURIComponent(name.trim())}/${encodeURIComponent(tag.join("#").trim())}?size=10`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetcher(url, { headers: { Authorization: key, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    } catch (e) {
      throw new FetchError(`could not reach the API (${(e as Error).message})`);
    }
    if (res.ok) return matchesIn(await res.json());
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchReport {
  checked: string[];
  remaining: number;
  added: string[];
  duplicates: number;
  skipped: Record<string, number>;
  errors: string[];
}

/**
 * Check anchors not checked since `since`, stopping before `budgetMs` runs out.
 * Call again until `remaining` is 0 to cover everyone.
 */
export async function fetchBatch(opts: { since?: Date; budgetMs?: number; fetcher?: Fetcher; uploader?: string | null } = {}): Promise<FetchReport> {
  const s = valSettings();
  if (!s.key) throw new FetchError("no API key: set HENRIKDEV_API_KEY in the site's environment variables");
  const sql = db();
  const since = opts.since ?? new Date(Date.now() - 6 * 3600 * 1000);
  const deadline = Date.now() + (opts.budgetMs ?? 40000);
  const report: FetchReport = { checked: [], remaining: 0, added: [], duplicates: 0, skipped: {}, errors: [] };

  const anchors = await sql`
    select id, account from game_accounts
    where game = 'valorant' and status = 'approved' and (last_checked_at is null or last_checked_at < ${since})
    order by last_checked_at nulls first, id`;
  const members = await sql`select account_key, puuid from game_accounts where game = 'valorant' and status = 'approved'`;
  const memberKeys = new Set(members.map((m) => m.account_key as string));
  const memberIds = new Set(members.filter((m) => m.puuid).map((m) => m.puuid as string));

  let i = 0;
  for (; i < anchors.length; i++) {
    if (Date.now() + s.gapMs + 8000 > deadline) break;
    const a = anchors[i];
    if (i > 0) await sleep(s.gapMs);
    try {
      const history = await fetchHistory(a.account, s.key, s.region, opts.fetcher, deadline);
      for (const raw of history) {
        const [ok, why] = isCustomGame(raw, s.minPlayers);
        if (!ok) { report.skipped[why] = (report.skipped[why] ?? 0) + 1; continue; }
        const inLobby = (raw.players ?? []).filter((p: ApiMatch) =>
          memberIds.has(p.puuid) || memberKeys.has(normaliseRiot(`${p.name}#${p.tag}`))).length;
        if (inLobby < s.minMembers) {
          const why2 = `fewer than ${s.minMembers} members in the lobby`;
          report.skipped[why2] = (report.skipped[why2] ?? 0) + 1;
          continue;
        }
        const m = trim(raw);
        if ((await saveValMatch(m, opts.uploader ?? null)) === "added") report.added.push(`${m.mapName} ${m.score[0]}–${m.score[1]}`);
        else report.duplicates++;
      }
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
