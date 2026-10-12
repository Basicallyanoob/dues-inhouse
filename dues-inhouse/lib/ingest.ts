/** Saving games, paying coins for them, and removing them. */
import { db, bumpDataVersion, type Tx } from "./db";
import { accountIndex, approvedAccounts } from "./accounts";
import { gameCoins } from "./economy";
import { fingerprint, winner as owWinner, type OwMap } from "./ow/parse";
import { winnerOf, type StoredValMatch } from "./val/match";

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
  await payOwMap(rows[0].id, sql);
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

async function saveValMatchTx(m: StoredValMatch, uploader: string | null, sql: Sql, raw?: unknown): Promise<"added" | "duplicate"> {
  const data = { server: m.server, players: m.players };
  const rows = await sql`
    insert into val_matches (id, played_at, map_name, score_blue, score_red, length_ms, source, data, uploaded_by)
    values (${m.id}, ${m.playedAt}, ${m.mapName}, ${m.score[0]}, ${m.score[1]}, ${m.lengthMs}, ${m.source},
            ${sql.json(data as never)}, ${uploader})
    on conflict (id) do nothing returning id`;
  if (raw) {
    // Also for duplicates: games imported before raw data was kept get it the next time they're seen.
    await sql`insert into val_match_raw (id, raw) values (${m.id}, ${sql.json(raw as never)}) on conflict (id) do nothing`;
  }
  if (!rows.length) return "duplicate";
  await learnPuuids(m, sql);
  await payValMatch(m.id, sql);
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

async function pay(sql: Sql, playerId: string, ref: string, result: "win" | "loss" | "draw", label: string) {
  await sql`insert into ledger (player_id, kind, amount, ref, note)
            values (${playerId}, 'game', ${gameCoins(result)}, ${ref}, ${label})
            on conflict (player_id, ref) where kind = 'game' do nothing`;
}

type Index = ReturnType<typeof accountIndex>;

export async function payOwMap(id: string, sql: Sql = db(), index?: Index) {
  const [row] = await sql`select * from ow_maps where id = ${id}`;
  if (!row || !row.complete) return; // unfinished maps don't pay
  index ??= accountIndex(await approvedAccounts(sql));
  const w = owWinner([row.score1, row.score2]);
  for (const p of row.data.players as { name: string; team: 1 | 2 }[]) {
    const member = index.ow(p.name);
    if (member) await pay(sql, member, `ow:${id}`, w === 0 ? "draw" : w === p.team ? "win" : "loss", `Overwatch, ${row.map_name}`);
  }
}

export async function payValMatch(id: string, sql: Sql = db(), index?: Index) {
  const [row] = await sql`select * from val_matches where id = ${id}`;
  if (!row) return;
  index ??= accountIndex(await approvedAccounts(sql));
  const w = winnerOf([row.score_blue, row.score_red]);
  for (const p of row.data.players as { puuid: string; name: string; tag: string; team: "Blue" | "Red" }[]) {
    const member = index.val(p.puuid, p.name, p.tag);
    const team = p.team === "Blue" ? 1 : 2;
    if (member) await pay(sql, member, `val:${id}`, w === 0 ? "draw" : w === team ? "win" : "loss", `Valorant, ${row.map_name}`);
  }
}

/** After a link is approved: pay for every earlier game on that account. */
export async function backfillCoins(sql: Sql = db()) {
  const index = accountIndex(await approvedAccounts(sql));
  for (const r of await sql`select id from ow_maps where complete`) await payOwMap(r.id, sql, index);
  for (const r of await sql`select id from val_matches`) await payValMatch(r.id, sql, index);
}

/** Remove a game and take back the coins it paid. */
export async function deleteGame(game: "overwatch" | "valorant", id: string, sql: Sql = db()) {
  const ref = game === "overwatch" ? `ow:${id}` : `val:${id}`;
  await sql`delete from ledger where kind = 'game' and ref = ${ref}`;
  if (game === "overwatch") await sql`delete from ow_maps where id = ${id}`;
  else await sql`delete from val_matches where id = ${id}`;
  await bumpDataVersion(sql);
}
