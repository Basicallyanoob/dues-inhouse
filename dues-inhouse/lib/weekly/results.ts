/**
 * Recognising a weekly game in the API's data. The bot already knows which ten
 * players and which map each game should have, so a custom game counts as that
 * weekly game only if every one of them is in it, on that map, inside the
 * session's window.
 */
import { db, type Tx } from "../db";
import { normaliseRiot, type StoredValMatch } from "../val/match";

type Sql = ReturnType<typeof db> | Tx;

const sameMap = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The id of the unfinished weekly game this match is, or null. */
export async function findWeeklyGame(m: StoredValMatch, sql: Sql = db()): Promise<number | null> {
  const games = await sql`
    select g.id, g.status, g.map_name, g.map_options, g.team_a || g.team_b as lineup
    from weekly_games g join weekly_sessions s on s.id = g.session_id
    where g.status in ('voting', 'ready') and s.window_start <= ${m.playedAt} and ${m.playedAt} < s.window_end
      and not exists (select 1 from weekly_games x where x.match_id = ${m.id})
    order by g.number`;
  if (!games.length) return null;
  const ids = new Set(m.players.map((p) => p.puuid));
  const keys = new Set(m.players.map((p) => normaliseRiot(`${p.name}#${p.tag}`)));
  for (const g of games) {
    // Before the vote closes there's no map yet; any map on the ballot will do.
    const mapOk = g.map_name ? sameMap(g.map_name, m.mapName) : (g.map_options as string[]).some((x) => sameMap(x, m.mapName));
    if (!mapOk) continue;
    const accounts = await sql`
      select player_id, account_key, puuid from game_accounts
      where game = 'valorant' and status = 'approved' and player_id = any(${sql.array(g.lineup as string[])}::uuid[])`;
    const present = new Set(accounts.filter((a) => (a.puuid && ids.has(a.puuid)) || keys.has(a.account_key)).map((a) => a.player_id));
    if ((g.lineup as string[]).every((p) => present.has(p))) return g.id;
  }
  return null;
}

/** Mark a weekly game played with this match. False if something else got there first. */
export async function linkWeeklyGame(gameId: number, matchId: string, sql: Sql = db()): Promise<boolean> {
  const rows = await sql`
    update weekly_games set status = 'played', match_id = ${matchId}
    where id = ${gameId} and status in ('voting', 'ready') and match_id is null returning id`;
  return rows.length > 0;
}
