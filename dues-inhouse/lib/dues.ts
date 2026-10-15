/**
 * DUES membership, for the members-only leaderboards.
 *
 * Someone counts as a DUES member when they have the member role in the club
 * Discord (DUES_MEMBER_ROLE, "Trinity" by default), unless an officer has said
 * otherwise on Admin > Members. The role is read:
 *  - whenever they use the bot (Discord sends their roles with every click),
 *  - when they sign in on the site,
 *  - for everyone, with the Sunday import or when an officer asks for it.
 */
import { bumpDataVersion, db } from "./db";
import { DiscordError, discordConfig, guildMember, guildMembers, guildRoles } from "./discord/api";

/** SQL for "is a DUES member": the officer's say if they gave one, otherwise the Discord role. */
export const IS_DUES = "coalesce(dues_override, dues_role)";

export const memberRoleSetting = () => (process.env.DUES_MEMBER_ROLE ?? "Trinity").trim();
const switchedOff = () => ["", "off"].includes(memberRoleSetting().toLowerCase());
const botReady = () => Boolean(discordConfig().botToken && discordConfig().guildId);

let cached: { at: number; setting: string; id: string | null } | null = null;
export const forgetRoleCache = () => { cached = null; };

/** The member role's id (the setting may be its name or its id), looked up at most every 10 minutes. */
export async function memberRoleId(): Promise<string | null> {
  if (switchedOff() || !botReady()) return null;
  const setting = memberRoleSetting();
  if (/^\d{15,22}$/.test(setting)) return setting;
  if (cached && cached.setting === setting && Date.now() - cached.at < 10 * 60 * 1000) return cached.id;
  const want = setting.replace(/^@/, "").toLowerCase();
  const id = (await guildRoles()).find((r) => r.name.toLowerCase() === want)?.id ?? null;
  cached = { at: Date.now(), setting, id };
  return id;
}

/**
 * Save what Discord says about people's roles. Returns how many changed; the
 * leaderboards recompute only if someone's shown status did.
 */
export async function saveRoles(seen: { discordId: string; isMember: boolean }[]): Promise<number> {
  if (!seen.length) return 0;
  const sql = db();
  const ids = sql.array(seen.map((s) => s.discordId));
  const flags = sql.array(seen.map((s) => (s.isMember ? "t" : "f")));
  const [r] = await sql`
    with v as (select * from unnest(${ids}::text[], ${flags}::text[]::boolean[]) as v(discord_id, member)),
    ch as (
      update players p set dues_role = v.member from v
      where p.discord_id = v.discord_id and p.dues_role is distinct from v.member
      returning p.dues_override
    )
    select count(*)::int as changed, count(*) filter (where dues_override is null)::int as shown from ch`;
  await sql`update players set dues_checked_at = now() where discord_id = any(${ids}::text[])`;
  if (r.shown > 0) await bumpDataVersion(sql);
  return r.changed;
}

const notInServer = (e: unknown) => e instanceof DiscordError && e.status === 404;

/** From a bot click or command: the roles Discord sent with it. */
export async function rolesFromInteraction(discordId: string, roleIds: string[] | undefined): Promise<void> {
  if (!roleIds) return;
  const role = await memberRoleId();
  if (role) await saveRoles([{ discordId, isMember: roleIds.includes(role) }]);
}

/** Ask Discord about one person (on sign-in). null when there's nothing to check against. */
export async function checkOne(discordId: string): Promise<boolean | null> {
  const role = await memberRoleId();
  if (!role) return null;
  let isMember: boolean;
  try {
    isMember = (await guildMember(discordId)).roles.includes(role);
  } catch (e) {
    if (!notInServer(e)) throw e;
    isMember = false; // not in the server at all
  }
  await saveRoles([{ discordId, isMember }]);
  return isMember;
}

export interface RoleCheck {
  role: string;
  ok: boolean;
  checked: number;
  changed: number;
  remaining: number;
  members: number;
  note?: string;
}

const countMembers = async () => (await db().unsafe(`select count(*)::int as n from players where ${IS_DUES}`))[0].n as number;

/**
 * Check everyone who has a Discord account. Reads the whole server in one
 * request when the bot is allowed to (Server Members Intent); otherwise asks
 * person by person, least recently checked first, until the time budget runs out.
 */
export async function checkEveryone(budgetMs = 40000): Promise<RoleCheck> {
  const role = memberRoleSetting();
  const out: RoleCheck = { role, ok: false, checked: 0, changed: 0, remaining: 0, members: 0 };
  if (switchedOff()) return { ...out, note: "Switched off (DUES_MEMBER_ROLE is off)." };
  if (!botReady()) return { ...out, note: "The Discord bot isn't set up (DISCORD_BOT_TOKEN and DISCORD_GUILD_ID)." };
  const roleId = await memberRoleId();
  if (!roleId) return { ...out, members: await countMembers(), note: `There's no role called “${role}” in the Discord server.` };
  out.ok = true;
  const people = (await db()`select discord_id from players where discord_id is not null order by dues_checked_at nulls first`)
    .map((r) => r.discord_id as string);

  try {
    const roles = new Map<string, string[]>();
    for (let after = "0"; ;) {
      const page = await guildMembers(after);
      for (const m of page) roles.set(m.user.id, m.roles);
      if (page.length < 1000) break;
      after = page.at(-1)!.user.id;
    }
    out.changed = await saveRoles(people.map((id) => ({ discordId: id, isMember: roles.get(id)?.includes(roleId) ?? false })));
    out.checked = people.length;
    return { ...out, members: await countMembers() };
  } catch (e) {
    if (!(e instanceof DiscordError && e.status === 403)) throw e;
    out.note = "Checked one at a time. Turning on Server Members Intent for the bot lets it check everyone at once.";
  }

  const start = Date.now();
  const seen: { discordId: string; isMember: boolean }[] = [];
  for (const id of people) {
    if (Date.now() - start > budgetMs) break;
    try {
      seen.push({ discordId: id, isMember: (await guildMember(id)).roles.includes(roleId) });
    } catch (e) {
      if (!notInServer(e)) throw e;
      seen.push({ discordId: id, isMember: false });
    }
  }
  out.changed = await saveRoles(seen);
  out.checked = seen.length;
  out.remaining = people.length - seen.length;
  return { ...out, members: await countMembers() };
}

/** With the Sunday import: check everyone, at most twice a day, in a short slot so the import keeps its time. */
export async function checkEveryoneIfDue(): Promise<RoleCheck | null> {
  const sql = db();
  const [last] = await sql`select value from site_state where key = 'dues_checked_at'`;
  if (last && Date.now() - Number(last.value) < 12 * 3600 * 1000) return null;
  const report = await checkEveryone(10000);
  if (report.remaining === 0) {
    await sql`insert into site_state (key, value) values ('dues_checked_at', ${String(Date.now())})
              on conflict (key) do update set value = excluded.value`;
  }
  return report;
}

/** An officer's say: true or false, or null to follow the Discord role again. */
export async function setOverride(playerId: string, value: boolean | null): Promise<void> {
  const sql = db();
  await sql`update players set dues_override = ${value} where id = ${playerId}`;
  await bumpDataVersion(sql);
}

/**
 * Officers just pick Yes or No. If that's what the Discord role already says,
 * the person keeps following the role; if it differs, the officer's answer
 * sticks until someone changes it.
 */
export async function setDues(playerId: string, member: boolean): Promise<void> {
  const sql = db();
  await sql`update players set dues_override = case when dues_role = ${member} then null else ${member} end where id = ${playerId}`;
  await bumpDataVersion(sql);
}
