import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./db";

/** A fake Discord server: a "Trinity" role and who has it. */
const TRINITY = "900000000000000001";
let members: Record<string, string[]> = {};
let intent = true;
let calls: string[] = [];

async function fakeDiscord(url: string): Promise<Response> {
  const path = url.replace("https://discord.com/api/v10", "");
  calls.push(path);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (path === "/guilds/g1/roles") return json([{ id: "1", name: "@everyone" }, { id: TRINITY, name: "Trinity" }]);
  if (path.startsWith("/guilds/g1/members?")) {
    if (!intent) return json({ message: "Missing Access", code: 50001 }, 403);
    return json(Object.entries(members).map(([id, roles]) => ({ user: { id }, roles })));
  }
  const one = /^\/guilds\/g1\/members\/(\d+)$/.exec(path);
  if (one) return members[one[1]] ? json({ user: { id: one[1] }, roles: members[one[1]] }) : json({ message: "Unknown Member", code: 10007 }, 404);
  return json({ message: "Not found" }, 404);
}

let sql: ReturnType<typeof import("@/lib/db").db>;
const status = async (name: string) =>
  (await sql`select dues_role, dues_override, coalesce(dues_override, dues_role) as dues from players where display_name = ${name}`)[0];

beforeAll(async () => {
  await resetDb();
  process.env.DISCORD_BOT_TOKEN = "test-token";
  process.env.DISCORD_GUILD_ID = "g1";
  delete process.env.DUES_MEMBER_ROLE;
  (await import("@/lib/discord/api")).setDiscordFetch(fakeDiscord as never);
  sql = (await import("@/lib/db")).db();
  await sql`insert into players (discord_id, display_name, slug) values
    ('111', 'Aoife', 'aoife'), ('222', 'Brian', 'brian'), ('333', 'Ciara', 'ciara')`;
  await sql`insert into players (display_name, slug) values ('Roster Rory', 'roster-rory')`;
});
afterAll(async () => (await import("@/lib/discord/api")).setDiscordFetch(null));
beforeEach(async () => {
  (await import("@/lib/dues")).forgetRoleCache();
  members = { "111": [TRINITY], "222": ["5"] }; // Ciara (333) has left the server
  intent = true;
  calls = [];
});

describe("DUES members from the Trinity role", () => {
  it("finds the role by name and reads everyone in one request when the bot may", async () => {
    const { checkEveryone } = await import("@/lib/dues");
    const r = await checkEveryone();
    expect(r).toMatchObject({ ok: true, checked: 3, changed: 1, members: 1, remaining: 0 });
    expect([(await status("Aoife")).dues, (await status("Brian")).dues, (await status("Ciara")).dues]).toEqual([true, false, false]);
    expect(calls.filter((c) => c.startsWith("/guilds/g1/members/"))).toEqual([]);
  });

  it("asks person by person without the Server Members Intent, and counts leaving the server as not a member", async () => {
    const { checkEveryone } = await import("@/lib/dues");
    intent = false;
    members = { "111": [], "222": [TRINITY] };
    const r = await checkEveryone();
    expect(r).toMatchObject({ ok: true, checked: 3, members: 1, remaining: 0 });
    expect(r.note).toMatch(/Server Members Intent/);
    expect([(await status("Aoife")).dues, (await status("Brian")).dues, (await status("Ciara")).dues]).toEqual([false, true, false]);
  });

  it("picks up the role from a bot click, and on sign-in", async () => {
    const { rolesFromInteraction, checkOne } = await import("@/lib/dues");
    await rolesFromInteraction("333", [TRINITY]);
    expect((await status("Ciara")).dues).toBe(true);
    expect(await checkOne("333")).toBe(false); // not in the server any more
    expect((await status("Ciara")).dues).toBe(false);
  });

  it("lets an officer override the role either way, and hand it back", async () => {
    const { setOverride, checkEveryone } = await import("@/lib/dues");
    const [rory] = await sql`select id from players where display_name = 'Roster Rory'`;
    const [brian] = await sql`select id from players where display_name = 'Brian'`;
    await setOverride(rory.id, true); // not on Discord at all
    await setOverride(brian.id, false);
    members = { "222": [TRINITY] };
    await checkEveryone();
    expect(await status("Roster Rory")).toMatchObject({ dues_role: false, dues: true });
    expect(await status("Brian")).toMatchObject({ dues_role: true, dues: false });
    await setOverride(brian.id, null);
    expect((await status("Brian")).dues).toBe(true);
  });

  it("officers just pick Yes or No: matching the role keeps following Discord, differing sticks", async () => {
    const { setDues, checkEveryone } = await import("@/lib/dues");
    const [aoife] = await sql`select id from players where display_name = 'Aoife'`;
    members = { "111": [TRINITY], "222": [TRINITY] };
    await checkEveryone();
    await setDues(aoife.id, true); // already has the role: nothing to override
    expect(await status("Aoife")).toMatchObject({ dues_override: null, dues: true });
    members = { "222": [TRINITY] }; // she loses the role, and follows it
    await checkEveryone();
    expect((await status("Aoife")).dues).toBe(false);
    await setDues(aoife.id, true); // now the officer's Yes sticks
    expect(await status("Aoife")).toMatchObject({ dues_override: true, dues: true });
    await setDues(aoife.id, false); // and back
    expect(await status("Aoife")).toMatchObject({ dues_override: null, dues: false });
  });

  it("shows on the site, so the leaderboards can filter by it", async () => {
    const { getSite } = await import("@/lib/season");
    const site = await getSite();
    const people = [...site.people.values()];
    expect(people.filter((p) => p.dues).map((p) => p.name).sort()).toEqual(["Brian", "Roster Rory"]);
  });

  it("says what's wrong when the role doesn't exist", async () => {
    const { checkEveryone } = await import("@/lib/dues");
    process.env.DUES_MEMBER_ROLE = "Paid Member";
    try {
      const r = await checkEveryone();
      expect(r.ok).toBe(false);
      expect(r.note).toMatch(/no role called “Paid Member”/);
    } finally {
      delete process.env.DUES_MEMBER_ROLE;
    }
  });
});
