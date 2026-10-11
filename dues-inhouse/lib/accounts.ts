/** Linking in-game accounts to members. */
import { db, type Tx } from "./db";
import { normaliseRiot } from "./val/match";
import type { Game } from "./games";

/** Logs show 'Kestrel' where a BattleTag reads 'Kestrel#21934'. */
export const normaliseBattleTag = (name: string) => name.trim().replace(/#\d+$/, "").toLowerCase();

export function accountKey(game: Game, account: string): string {
  return game === "overwatch" ? normaliseBattleTag(account) : normaliseRiot(account);
}

export function validAccount(game: Game, account: string): string | null {
  const a = account.trim();
  if (!a) return "Enter your account name.";
  if (a.length > 64) return "That name is too long.";
  if (game === "overwatch" && !/^[^#]+(#\d{3,6})?$/.test(a)) return "A BattleTag looks like Name#1234.";
  if (game === "valorant" && !/^[^#]{2,16}#[^#]{2,5}$/.test(a)) return "A Riot ID looks like Name#Tag, with the tag after #.";
  return null;
}

export interface ApprovedAccount {
  id: number;
  playerId: string;
  game: Game;
  account: string;
  key: string;
  puuid: string | null;
}

export async function approvedAccounts(sql: ReturnType<typeof db> | Tx = db()): Promise<ApprovedAccount[]> {
  const rows = await sql`
    select id, player_id, game, account, account_key, puuid from game_accounts where status = 'approved'`;
  return rows.map((r) => ({ id: r.id, playerId: r.player_id, game: r.game, account: r.account, key: r.account_key, puuid: r.puuid }));
}

/** Lookup tables from in-game identity to member id. */
export function accountIndex(accounts: ApprovedAccount[]) {
  const ow = new Map<string, string>();
  const valKey = new Map<string, string>();
  const valName = new Map<string, string | null>(); // name without tag; null when two members share it
  const valPuuid = new Map<string, string>();
  for (const a of accounts) {
    if (a.game === "overwatch") ow.set(a.key, a.playerId);
    else {
      valKey.set(a.key, a.playerId);
      const bare = a.key.split("#")[0];
      valName.set(bare, valName.has(bare) && valName.get(bare) !== a.playerId ? null : a.playerId);
      if (a.puuid) valPuuid.set(a.puuid, a.playerId);
    }
  }
  return {
    ow: (name: string) => ow.get(normaliseBattleTag(name)) ?? null,
    val: (puuid: string, name: string, tag: string) =>
      valPuuid.get(puuid) ?? (tag ? valKey.get(normaliseRiot(`${name}#${tag}`)) ?? null : valName.get(normaliseRiot(name)) ?? null),
  };
}
