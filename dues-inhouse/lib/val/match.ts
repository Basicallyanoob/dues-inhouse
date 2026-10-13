/** Valorant games: the API's match format, our stored format, and typed-in scoreboards. */

export const TEAMS = ["Blue", "Red"] as const; // team 1 and team 2

export interface ValLine {
  puuid: string;
  name: string;
  tag: string;
  team: "Blue" | "Red";
  agent: string;
  score: number; // combat score summed over the game; ACS = score / rounds
  kills: number;
  deaths: number;
  assists: number;
  headshots: number | null;
  bodyshots: number | null;
  legshots: number | null;
  damage: number | null;
  first_bloods: number | null;
  plants?: number | null; // spike plants; missing from games stored before plants were counted
}

/** What is stored for each game (val_matches row + data). */
export interface StoredValMatch {
  id: string;
  playedAt: Date;
  mapName: string;
  score: [number, number]; // Blue, Red
  lengthMs: number;
  source: "henrikdev" | "manual";
  server: string;
  players: ValLine[];
}

export const normaliseRiot = (id: string): string => {
  const [name, ...rest] = id.split("#");
  const tag = rest.join("#").trim();
  return tag ? `${name.trim()}#${tag}`.toLowerCase() : name.trim().toLowerCase();
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ApiMatch = Record<string, any>;

/** Matches from an API response, a list of matches, or one match. */
export function matchesIn(payload: unknown): ApiMatch[] {
  let p: any = payload;
  if (p && typeof p === "object" && !Array.isArray(p) && "data" in p) p = p.data;
  if (p && typeof p === "object" && !Array.isArray(p)) p = [p];
  return Array.isArray(p) ? p.filter((m) => m && typeof m === "object" && "metadata" in m) : [];
}

/** Queue ids Riot uses for games that aren't customs. Anything else unexpected is reported by name. */
const KNOWN_QUEUES = new Set(["competitive", "unrated", "swiftplay", "spikerush", "deathmatch", "hurm", "teamdeathmatch",
  "ggteam", "onefa", "snowball", "premier", "newmap", "skirmish"]);

export const UNKNOWN_QUEUE = "skipped unknown queue type";

/**
 * Whether an API match is a finished custom Blue-vs-Red game with enough players.
 * The request already asks for customs only (mode=custom); this checks again,
 * because Riot changed the queue id from 'custom' to '' in 2026 and may change it again.
 */
export function isCustomGame(raw: ApiMatch, minPlayers: number): [boolean, string] {
  const md = raw.metadata ?? {};
  const q = md.queue ?? {};
  const qid = String(q.id ?? "").toLowerCase();
  const qname = String(q.name ?? "").toLowerCase();
  if (!(qname.startsWith("custom") || qid === "custom" || (qid === "" && !qname))) {
    if (qid && !KNOWN_QUEUES.has(qid)) return [false, `${UNKNOWN_QUEUE} "${q.id}"${q.name ? ` (${q.name})` : ""}`];
    return [false, `a ${q.name || q.id || "non-custom"} game`];
  }
  if (md.is_completed === false) return [false, "not finished"];
  const teams = new Set((raw.teams ?? []).map((t: any) => t.team_id));
  if (teams.size !== 2 || !teams.has("Blue") || !teams.has("Red")) return [false, "not a Blue against Red game"];
  const n = (raw.players ?? []).length;
  if (n < minPlayers) return [false, `only ${n} player${n === 1 ? "" : "s"}`];
  return [true, ""];
}

/** Keep what the site uses from an API match (about 3% of its size). */
/**
 * Bump when trim() starts reading something new from the API's data: stored
 * games with a lower number are re-read from their saved API response
 * (val_match_raw) by restatFromRaw, so past weeks get the new stats too.
 */
export const STATS_VERSION = 2;

/** First bloods: the earliest kill of each round in the kill feed (v4 has no per-round field for it). */
function firstBloods(raw: ApiMatch): Map<string, number> | null {
  const kills: any[] = raw.kills ?? [];
  if (!kills.length) return null;
  const earliest = new Map<number, [number, string]>();
  for (const k of kills) {
    const rnd = k?.round, at = k?.time_in_round_in_ms, who = k?.killer?.puuid;
    if (rnd == null || at == null || !who) continue;
    const seen = earliest.get(rnd);
    if (!seen || at < seen[0]) earliest.set(rnd, [at, who]);
  }
  const out = new Map<string, number>();
  for (const [, who] of earliest.values()) out.set(who, (out.get(who) ?? 0) + 1);
  return out;
}

/** Spike plants, from who planted in each round. */
function plants(raw: ApiMatch): Map<string, number> | null {
  const rounds: any[] = raw.rounds ?? [];
  if (!rounds.length) return null;
  const out = new Map<string, number>();
  for (const r of rounds) {
    const who = r?.plant?.player?.puuid;
    if (who) out.set(who, (out.get(who) ?? 0) + 1);
  }
  return out;
}

export function trim(raw: ApiMatch): StoredValMatch {
  const md = raw.metadata;
  const first = firstBloods(raw);
  const planted = plants(raw);
  const won = Object.fromEntries((raw.teams ?? []).map((t: any) => [t.team_id, t.rounds?.won ?? 0]));
  const players: ValLine[] = (raw.players ?? []).map((p: any) => {
    const st = p.stats ?? {};
    return {
      puuid: p.puuid ?? "", name: p.name ?? "", tag: p.tag ?? "", team: p.team_id,
      agent: p.agent?.name || "Unknown", score: st.score ?? 0, kills: st.kills ?? 0, deaths: st.deaths ?? 0,
      assists: st.assists ?? 0, headshots: st.headshots ?? null, bodyshots: st.bodyshots ?? null,
      legshots: st.legshots ?? null, damage: st.damage?.dealt ?? null,
      first_bloods: first ? first.get(p.puuid) ?? 0 : null, plants: planted ? planted.get(p.puuid) ?? 0 : null,
    };
  });
  return {
    id: md.match_id, playedAt: new Date(md.started_at), mapName: md.map?.name || "Unknown map",
    score: [won.Blue ?? 0, won.Red ?? 0], lengthMs: md.game_length_in_ms ?? 0, source: "henrikdev",
    server: md.cluster ?? "", players,
  };
}

/** The trimmed JSON files written by the earlier Overtime site. */
export function fromOvertimeFile(data: any): StoredValMatch {
  return {
    id: data.id, playedAt: new Date(data.started_at), mapName: data.map,
    score: [data.rounds?.Blue ?? 0, data.rounds?.Red ?? 0], lengthMs: data.length_ms ?? 0,
    source: data.source === "manual" ? "manual" : "henrikdev", server: data.server ?? "",
    players: (data.players ?? []).map((p: any) => ({
      puuid: p.puuid, name: p.name, tag: p.tag ?? "", team: p.team, agent: p.agent, score: p.score,
      kills: p.kills, deaths: p.deaths, assists: p.assists, headshots: p.headshots ?? null,
      bodyshots: p.bodyshots ?? null, legshots: p.legshots ?? null, damage: p.damage ?? null,
      first_bloods: p.first_bloods ?? null, plants: p.plants ?? null,
    })),
  };
}

export const winnerOf = (score: [number, number]): 0 | 1 | 2 =>
  score[0] === score[1] ? 0 : score[0] > score[1] ? 1 : 2;
