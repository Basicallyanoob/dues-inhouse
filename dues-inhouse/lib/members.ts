/** Account links, approvals, roster members and roles. */
import { db, bumpDataVersion, type Tx } from "./db";
import { accountKey, validAccount } from "./accounts";
import { uniqueSlug } from "./auth";
import type { Game } from "./games";

export class MemberError extends Error {}

export async function requestLink(playerId: string, game: Game, account: string): Promise<"pending" | "approved"> {
  const problem = validAccount(game, account);
  if (problem) throw new MemberError(problem);
  const key = accountKey(game, account);
  const sql = db();
  const [mine] = await sql`select status from game_accounts where player_id = ${playerId} and game = ${game} and account_key = ${key} and status <> 'rejected'`;
  if (mine) throw new MemberError(mine.status === "approved" ? "That account is already linked to you." : "You've already asked to link that account.");
  const [owner] = await sql`
    select p.auth_id, p.discord_id from game_accounts a join players p on p.id = a.player_id
    where a.game = ${game} and a.account_key = ${key} and a.status = 'approved'`;
  if (owner?.auth_id || owner?.discord_id) throw new MemberError("Another member has already linked that account. Ask an officer if it's yours.");
  await sql`insert into game_accounts (player_id, game, account, account_key) values (${playerId}, ${game}, ${account.trim()}, ${key})`;
  return "pending";
}

export async function removeLink(playerId: string, accountId: number, officer: boolean) {
  const sql = db();
  const [a] = await sql`select * from game_accounts where id = ${accountId}`;
  if (!a || (!officer && a.player_id !== playerId)) throw new MemberError("No such account.");
  await sql`delete from game_accounts where id = ${accountId}`;
  await bumpDataVersion(sql);
}

/**
 * Approve a link. If the account belonged to a roster entry made before the
 * person signed in, that entry is folded into them: its other accounts move
 * across, and the roster entry is removed.
 */
export async function approveLink(accountId: number, officerId: string) {
  try {
    await approveLinkTx(accountId, officerId);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new MemberError("Someone else just linked that account. Reload and check.");
    throw e;
  }
}

async function approveLinkTx(accountId: number, officerId: string) {
  await db().begin(async (tx) => {
    const [a] = await tx`select * from game_accounts where id = ${accountId} for update`;
    if (!a || a.status !== "pending") throw new MemberError("That request has already been handled.");
    const [held] = await tx`
      select a.id, a.player_id, p.auth_id, p.discord_id from game_accounts a join players p on p.id = a.player_id
      where a.game = ${a.game} and a.account_key = ${a.account_key} and a.status = 'approved'`;
    if (held && held.player_id !== a.player_id) {
      // Only unclaimed roster entries are folded in; someone known by Discord (site or bot) is a real other member.
      if (held.auth_id || held.discord_id) throw new MemberError("Another member already has that account. Remove it from them first.");
      await mergeRoster(tx, held.player_id, a.player_id);
    }
    await tx`delete from game_accounts where id <> ${accountId} and player_id = ${a.player_id}
             and game = ${a.game} and account_key = ${a.account_key}`;
    await tx`update game_accounts set status = 'approved', reviewed_by = ${officerId}, reviewed_at = now() where id = ${accountId}`;
    if (a.game === "valorant") await learnPuuidFromGames(tx, accountId);
    await tx`update game_accounts set status = 'rejected', reviewed_by = ${officerId}, reviewed_at = now()
             where id <> ${accountId} and game = ${a.game} and account_key = ${a.account_key} and status = 'pending'`;
    await bumpDataVersion(tx);
  });
}

async function mergeRoster(tx: Tx, fromId: string, intoId: string) {
  // Keep any learned account ids before dropping the roster's copy of an account.
  await tx`update game_accounts t set puuid = coalesce(t.puuid, f.puuid)
           from game_accounts f where f.player_id = ${fromId} and t.player_id = ${intoId}
             and t.game = f.game and t.account_key = f.account_key`;
  await tx`delete from game_accounts f where f.player_id = ${fromId} and exists (
             select 1 from game_accounts t where t.player_id = ${intoId} and t.game = f.game and t.account_key = f.account_key)`;
  await tx`update game_accounts set player_id = ${intoId} where player_id = ${fromId}`;
  await tx`delete from players where id = ${fromId} and auth_id is null`;
}

/** A Riot ID linked after its games were imported gets its account id from the latest of them. */
async function learnPuuidFromGames(tx: Tx, accountId: number) {
  await tx`
    update game_accounts a set puuid = (
      select p->>'puuid' from val_matches m, jsonb_array_elements(m.data->'players') p
      where lower((p->>'name') || '#' || (p->>'tag')) = a.account_key and p->>'puuid' not like 'manual:%'
      order by m.played_at desc limit 1)
    where a.id = ${accountId} and a.puuid is null`;
}

/**
 * /link from Discord. The API lookup has already shown the Riot ID exists, so
 * the link is approved straight away (officers can still remove it on Admin >
 * Members). Its account id and rank are stored: the id keeps the link working
 * through name changes; the rank is only used to balance teams.
 */
export async function linkFromDiscord(playerId: string, riot: { account: string; puuid: string; current: number | null; peak: number | null }):
  Promise<"linked" | "updated"> {
  const problem = validAccount("valorant", riot.account);
  if (problem) throw new MemberError(problem);
  const key = accountKey("valorant", riot.account);
  const sql = db();
  // The same account under a different name (renamed since it was linked) is found by its id.
  const [mine] = await sql`select id from game_accounts where player_id = ${playerId} and game = 'valorant' and status = 'approved'
                           and (account_key = ${key} or puuid = ${riot.puuid})`;
  if (mine) {
    await sql`update game_accounts set account = ${riot.account.trim()}, account_key = ${key}, puuid = ${riot.puuid},
              current_tier = ${riot.current}, peak_tier = ${riot.peak}, rank_checked_at = now() where id = ${mine.id}`;
    await bumpDataVersion(sql);
    return "updated";
  }
  const [other] = await sql`select 1 from game_accounts a join players p on p.id = a.player_id
    where a.game = 'valorant' and a.status = 'approved' and a.player_id <> ${playerId}
      and (a.account_key = ${key} or a.puuid = ${riot.puuid}) and (p.auth_id is not null or p.discord_id is not null)`;
  if (other) throw new MemberError("Another member has already linked that Riot ID. Ask an officer if it's yours.");
  await sql`delete from game_accounts where player_id = ${playerId} and game = 'valorant' and account_key = ${key} and status = 'pending'`;
  const [row] = await sql`insert into game_accounts (player_id, game, account, account_key)
                          values (${playerId}, 'valorant', ${riot.account.trim()}, ${key}) returning id`;
  await approveLink(row.id, playerId);
  await sql`update game_accounts set puuid = ${riot.puuid}, current_tier = ${riot.current}, peak_tier = ${riot.peak},
            rank_checked_at = now() where id = ${row.id}`;
  await bumpDataVersion(sql);
  return "linked";
}

/** The member a Discord user is, making a roster entry for someone new. They merge on first web sign-in. */
export async function playerForDiscord(user: { id: string; name: string }, create: boolean): Promise<{ id: string; role: string } | null> {
  const sql = db();
  const [p] = await sql`select id, role from players where discord_id = ${user.id}`;
  if (p || !create) return (p as { id: string; role: string }) ?? null;
  const name = user.name.replace(/#0$/, "").slice(0, 40).trim() || "Member";
  const isAdminId = (process.env.ADMIN_DISCORD_IDS ?? "").split(/[,\s]+/).filter(Boolean).includes(user.id);
  try {
    const [row] = await sql`insert into players (discord_id, display_name, slug, role)
      values (${user.id}, ${name}, ${await uniqueSlug(name)}, ${isAdminId ? "admin" : "member"}) returning id, role`;
    await bumpDataVersion(sql);
    return row as { id: string; role: string };
  } catch (e) {
    if ((e as { code?: string }).code !== "23505") throw e;
    const [again] = await sql`select id, role from players where discord_id = ${user.id}`;
    return (again as { id: string; role: string }) ?? null;
  }
}

export async function rejectLink(accountId: number, officerId: string) {
  await db()`update game_accounts set status = 'rejected', reviewed_by = ${officerId}, reviewed_at = now()
             where id = ${accountId} and status = 'pending'`;
}

/** An officer adds someone who hasn't signed in yet, with accounts already approved. */
export async function addRosterMember(name: string, battletags: string[], riotIds: string[], officerId: string): Promise<string> {
  const display = name.trim();
  if (!display || display.length > 40) throw new MemberError("Give them a name of up to 40 characters.");
  for (const b of battletags) { const e = validAccount("overwatch", b); if (e) throw new MemberError(`${b}: ${e}`); }
  for (const r of riotIds) { const e = validAccount("valorant", r); if (e) throw new MemberError(`${r}: ${e}`); }
  return db().begin(async (tx) => {
    const [p] = await tx`insert into players (display_name, slug) values (${display}, ${await uniqueSlug(display)}) returning id`;
    for (const [game, list] of [["overwatch", battletags], ["valorant", riotIds]] as [Game, string[]][]) {
      for (const acc of list) {
        const key = accountKey(game, acc);
        const [taken] = await tx`select 1 from game_accounts where game = ${game} and account_key = ${key} and status = 'approved'`;
        if (taken) throw new MemberError(`${acc} is already linked to someone.`);
        const [row] = await tx`insert into game_accounts (player_id, game, account, account_key, status, reviewed_by, reviewed_at)
                 values (${p.id}, ${game}, ${acc.trim()}, ${key}, 'approved', ${officerId}, now()) returning id`;
        if (game === "valorant") await learnPuuidFromGames(tx, row.id);
      }
    }
    await bumpDataVersion(tx);
    return p.id;
  });
}

/** players.csv from the old Overtime site: name, ingame_names, roles, riot_ids. */
export async function importRoster(csvText: string, officerId: string): Promise<string[]> {
  const { parseCsvRows } = await import("./val/scoreboard");
  const rows = parseCsvRows(csvText);
  if (!rows.length) return ["The file is empty."];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => header.findIndex((h) => names.includes(h));
  const iName = col(["name", "player", "display name"]);
  const iOw = col(["ingame_names", "in-game names", "battletag", "battletags", "aliases"]);
  const iRiot = col(["riot_ids", "riot id", "riot ids", "riot"]);
  if (iName < 0) return ["Needs a 'name' column."];
  const split = (t: string | undefined) => (t ?? "").split(/[;|\n]/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const r of rows.slice(1)) {
    const name = r[iName]?.trim();
    if (!name) continue;
    const ow = iOw >= 0 ? split(r[iOw]) : [];
    const riot = iRiot >= 0 ? split(r[iRiot]) : [];
    try {
      await addRosterMember(name, [...new Set(ow.length ? ow : [name])], riot, officerId);
      out.push(`${name}: added`);
    } catch (e) {
      out.push(`${name}: ${(e as Error).message}`);
    }
  }
  return out;
}

export async function setRole(playerId: string, role: "member" | "officer" | "admin") {
  await db()`update players set role = ${role} where id = ${playerId}`;
}

export async function updateProfile(playerId: string, name: string, note: string) {
  const display = name.trim();
  if (!display || display.length > 40) throw new MemberError("Your name needs 1 to 40 characters.");
  if (note.length > 75) throw new MemberError("Keep your note to 75 characters.");
  await db()`update players set display_name = ${display}, slug = ${await uniqueSlug(display, playerId)}, note = ${note.trim() || null}
             where id = ${playerId}`;
  await bumpDataVersion();
}
