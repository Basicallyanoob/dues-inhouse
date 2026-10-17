/**
 * The season start, and games an officer removed. Ratings, leaderboards,
 * records and profiles only count games from the season start on; older ones
 * stay saved but are left out, and the importer doesn't bring them back.
 * Removed games are remembered, so the next import doesn't add them again.
 */
import { bumpDataVersion, db, type Tx } from "./db";
import { zonedToUtc } from "./time";

type Sql = ReturnType<typeof db> | Tx;

/** "2026-10-17", or null when every game counts. */
export async function seasonStartDay(sql: Sql = db()): Promise<string | null> {
  const [r] = await sql`select value from site_state where key = 'season_start'`;
  return r?.value && /^\d{4}-\d{2}-\d{2}$/.test(r.value) ? r.value : null;
}

/** The moment the season starts: 5am Irish time on that day, so a night's games all fall on one side. */
export function seasonStartAt(day: string | null): Date | null {
  if (!day) return null;
  const [y, m, d] = day.split("-").map(Number);
  return zonedToUtc(y, m, d, 5, 0, 0);
}

export async function seasonStart(sql: Sql = db()): Promise<Date | null> {
  return seasonStartAt(await seasonStartDay(sql));
}

/** Start a new season on a day ("2026-10-17"), or null to count every game again. */
export async function setSeasonStart(day: string | null): Promise<void> {
  if (day !== null && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("A season start looks like 2026-10-17.");
  const sql = db();
  if (day === null) await sql`delete from site_state where key = 'season_start'`;
  else await sql`insert into site_state (key, value) values ('season_start', ${day}) on conflict (key) do update set value = excluded.value`;
  await bumpDataVersion(sql);
}

/** Remember a removed game so imports skip it. */
export async function forgetGame(game: "overwatch" | "valorant", id: string, sql: Sql = db()): Promise<void> {
  await sql`insert into removed_games (game, id) values (${game}, ${id}) on conflict do nothing`.catch(missingTable);
}

export async function removedGames(game: "overwatch" | "valorant", sql: Sql = db()): Promise<Set<string>> {
  const rows = await sql`select id from removed_games where game = ${game}`.catch(missingTable);
  return new Set((rows ?? []).map((r) => r.id as string));
}

/** Before supabase/schema.sql has been run again there's no removed_games table: carry on without it. */
function missingTable(e: unknown): undefined {
  if ((e as { code?: string }).code === "42P01") return undefined;
  throw e;
}
