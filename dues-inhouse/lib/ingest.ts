/** Saving and removing games. */
import { forgetGame } from "./seasons";
import { db, bumpDataVersion, type Tx } from "./db";
import { fingerprint, type OwMap } from "./ow/parse";
import { STATS_VERSION, matchesIn, trim, type StoredValMatch } from "./val/match";

type Sql = ReturnType<typeof db> | Tx;

/** Run in a transaction, or inside the caller's if there already is one. */
function inTx<T>(sql: Sql, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return "begin" in sql ? (sql.begin((tx) => fn(tx)) as Promise<T>) : fn(sql);
}

export async function saveOwMap(m: OwMap, sourceFile: string | null, uploader: string | null, sql: Sql = db()): Promise<"added" | "duplicate"> {
  return inTx(sql, (tx) => saveOwMapTx(m, sourceFile, uploader, tx));
}

async function saveOwMapTx(m: OwMap, sourceFile: string | null, uploader: string | null, sql: Sql): Promise<"added" | "duplicate"> {
  const fp = fingerprint(m);
  const data = { players: m.players, firstKills: m.firstKills };
  const rows = await sql`
    insert into ow_maps (id, fingerprint, played_at, map_name, map_type, team1, team2, score1, score2, complete, duration, data, source_file, uploaded_by)
    values (${await freeOwId(m.id, sql)}, ${fp}, ${m.playedAt}, ${m.mapName}, ${m.mapType}, ${m.teamNames[0]}, ${m.teamNames[1]},
            ${m.score[0]}, ${m.score[1]}, ${m.complete}, ${m.duration}, ${sql.json(data as never)}, ${sourceFile}, ${uploader})
    on conflict (fingerprint) do nothing returning id`;
  if (!rows.length) return "duplicate";
  await bumpDataVersion(sql);
  return "added";
}

/** Two different logs can share a file name; keep ids unique. */
async function freeOwId(id: string, sql: Sql): Promise<string> {
  const base = id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80) || "map";
  let candidate = base;
  for (let n = 2; (await sql`select 1 from ow_maps where id = ${candidate}`).length; n++) candidate = `${base}-${n}`;
  return candidate;
}

/** raw: the full API response for the game, kept so later stats can be worked out for it. */
export async function saveValMatch(m: StoredValMatch, uploader: string | null, sql: Sql = db(), raw?: unknown): Promise<"added" | "duplicate"> {
  return inTx(sql, (tx) => saveValMatchTx(m, uploader, tx, raw));
}

/** What val_matches.data holds. API games carry the stats version they were read with. */
const storedData = (m: StoredValMatch) => ({ server: m.server, players: m.players, ...(m.source === "henrikdev" ? { stats: STATS_VERSION } : {}) });

async function saveValMatchTx(m: StoredValMatch, uploader: string | null, sql: Sql, raw?: unknown): Promise<"added" | "duplicate"> {
  const data = storedData(m);
  const rows = await sql`
    insert into val_matches (id, played_at, map_name, score_blue, score_red, length_ms, source, data, uploaded_by)
    values (${m.id}, ${m.playedAt}, ${m.mapName}, ${m.score[0]}, ${m.score[1]}, ${m.lengthMs}, ${m.source},
            ${sql.json(data as never)}, ${uploader})
    on conflict (id) do nothing returning id`;
  if (raw) {
    // Also for duplicates: games imported before raw data was kept get it the next time they're seen.
    await sql`insert into val_match_raw (id, raw) values (${m.id}, ${sql.json(raw as never)}) on conflict (id) do nothing`;
  }
  if (!rows.length) {
    // Seen again with its API data: bring older stored stats up to date.
    if (raw && m.source === "henrikdev") {
      const updated = await sql`update val_matches set data = ${sql.json(data as never)}
                                where id = ${m.id} and coalesce((data->>'stats')::int, 1) < ${STATS_VERSION} returning id`;
      if (updated.length) await bumpDataVersion(sql);
    }
    return "duplicate";
  }
  await learnPuuids(m, sql);
  await bumpDataVersion(sql);
  return "added";
}

/** A linked Riot ID gains its account id from the first game it appears in, so name changes don't lose it. */
async function learnPuuids(m: StoredValMatch, sql: Sql) {
  for (const p of m.players) {
    if (!p.puuid || p.puuid.startsWith("manual:") || !p.tag) continue;
    await sql`update game_accounts set puuid = ${p.puuid}
              where game = 'valorant' and status = 'approved' and puuid is null
                and account_key = ${`${p.name}#${p.tag}`.toLowerCase()}`;
  }
}

/**
 * Re-read stored games from their saved API response when trim() has learnt to
 * read more since they were imported (STATS_VERSION), so past weeks get new
 * stats such as plants. A few hundred games at most; cheap when nothing is due.
 */
export async function restatFromRaw(sql: Sql = db(), limit = 200): Promise<number> {
  const rows = await sql`
    select r.id, r.raw from val_match_raw r join val_matches m on m.id = r.id
    where coalesce((m.data->>'stats')::int, 1) < ${STATS_VERSION} limit ${limit}`;
  let n = 0;
  for (const r of rows) {
    const [raw] = matchesIn(r.raw);
    if (!raw) continue;
    const m = trim(raw);
    if (m.id !== r.id) continue;
    await sql`update val_matches set data = ${sql.json(storedData(m) as never)} where id = ${r.id}`;
    n++;
  }
  if (n) await bumpDataVersion(sql);
  return n;
}

/** Remove a game. */
export async function deleteGame(game: "overwatch" | "valorant", id: string, sql: Sql = db()) {
  if (game === "overwatch") await sql`delete from ow_maps where id = ${id}`;
  else await sql`delete from val_matches where id = ${id}`;
  await forgetGame(game, id, sql); // so the next import doesn't add it back
  await bumpDataVersion(sql);
}
