import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetDb } from "./db";

/** A Saturday from sign-up to results, with Discord and the HenrikDev API faked. */

interface Call { method: string; url: string; body: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
const calls: Call[] = [];
let lobbyMatch: unknown = null;
let msgId = 0;

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input);
  const method = init.method ?? "GET";
  const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url.startsWith("https://discord.com/")) {
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : {} });
    if (method === "POST" && url.includes("/channels/")) return json({ id: `msg${++msgId}`, channel_id: url.split("/channels/")[1].split("/")[0] });
    return json({});
  }
  if (url.includes("/v2/account/")) return json({ data: { puuid: "id-Linker", name: "Linker", tag: "EUW", region: "eu" } });
  if (url.includes("/mmr/")) return json({ data: { current: { tier: { id: 21, name: "Ascendant 1" } }, peak: { tier: { id: 24, name: "Immortal 1" } } } });
  if (url.includes("/v4/matches/")) return json({ data: lobbyMatch ? [lobbyMatch] : [] });
  throw new Error(`unexpected fetch ${url}`);
}

const user = (n: number) => ({ id: `${1000 + n}`, username: `player${n}` });
const press = (n: number, custom_id: string, permissions = "0") =>
  ({ type: 3, id: `i${Math.random()}`, token: `tok${n}`, channel_id: "chan", member: { user: user(n), permissions }, data: { custom_id } });
const slash = (n: number, name: string, options: unknown[] = [], permissions = "0") =>
  ({ type: 2, id: `i${Math.random()}`, token: `tok${n}`, channel_id: "chan", member: { user: user(n), permissions }, data: { name, options } });

let sql: ReturnType<typeof import("@/lib/db").db>;

describe("a weekly session through Discord", () => {
  let sessionId: number;
  let firstMap: string;
  const ids: string[] = []; // player ids of player0..player10

  beforeAll(async () => {
    await resetDb();
    sql = (await import("@/lib/db")).db();
    vi.stubGlobal("fetch", fakeFetch);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T11:05:00Z")); // Saturday 12:05 in Dublin
    Object.assign(process.env, {
      HENRIKDEV_API_KEY: "HDEV-test", VAL_REQUEST_GAP_MS: "0", DISCORD_BOT_TOKEN: "bot", DISCORD_APP_ID: "app",
      DISCORD_CHANNEL_ID: "chan", WEEKLY_AUTO: "1",
    });
  });
  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function run(i: unknown) {
    const { handleInteraction } = await import("@/lib/discord/interactions");
    const h = await handleInteraction(i as never);
    await h.later?.();
    return h.body;
  }

  it("links a Riot ID with /link, looking up its account id and rank", async () => {
    const body = await run(slash(99, "link", [{ name: "riot_id", type: 3, value: "linker#euw" }]));
    expect(body).toEqual({ type: 5, data: { flags: 64 } });
    const reply = calls.at(-1)!;
    expect(reply.url).toContain("/webhooks/app/tok99/messages/@original");
    expect(reply.body.content).toContain("Linked **Linker#EUW**");
    expect(reply.body.content).toContain("Ascendant 1, peak Immortal 1) is only used to balance teams");
    expect(reply.body.content).toContain("starts the weeklies leaderboard on 1000");
    const [a] = await sql`select puuid, current_tier, peak_tier from game_accounts where account_key = 'linker#euw'`;
    expect(a).toEqual({ puuid: "id-Linker", current_tier: 21, peak_tier: 24 });
  });

  it("opens sign-ups on schedule, and only linked players can join", async () => {
    const { linkFromDiscord, playerForDiscord } = await import("@/lib/members");
    for (let n = 0; n <= 10; n++) {
      const p = (await playerForDiscord({ id: user(n).id, name: `Player${n}` }, true))!;
      await linkFromDiscord(p.id, { account: `Player${n}#EUW`, puuid: `id-${n}`, current: 10 + n, peak: 11 + n });
      ids.push(p.id);
    }
    const { sessionTick } = await import("@/lib/discord/schedule");
    expect((await sessionTick(new Date())).steps).toEqual([]); // 12:05: too early
    vi.setSystemTime(new Date("2026-10-17T16:05:00Z")); // 17:05 in Dublin
    const tick = await sessionTick(new Date());
    expect(tick.errors).toEqual([]);
    expect(tick.steps[0]).toMatch(/^open sign-ups: opened/);
    const [s] = await sql`select * from weekly_sessions`;
    sessionId = s.id;
    expect(s.signup_message_id).toBe("msg1");
    expect(new Date(s.window_start).toISOString()).toBe("2026-10-17T17:30:00.000Z");

    for (let n = 0; n <= 10; n++) await run(press(n, `join:${sessionId}`));
    const last = calls.at(-1)!;
    expect(last.method).toBe("PATCH");
    expect(last.body.embeds[0].fields[0].name).toBe("Signed up (11)");

    await run(press(50, `join:${sessionId}`)); // never linked
    expect(calls.at(-1)!.body).toMatchObject({ flags: 64, content: expect.stringContaining("/link") });
  });

  it("makes balanced teams at 18:45 and runs the map vote among the ten", async () => {
    const { sessionTick } = await import("@/lib/discord/schedule");
    vi.setSystemTime(new Date("2026-10-17T17:46:00Z"));
    const tick = await sessionTick(new Date());
    expect(tick.errors).toEqual([]);
    expect(tick.steps.join()).toContain("Game 1 is up");
    const [g] = await sql`select * from weekly_games where session_id = ${sessionId}`;
    expect(g.team_a).toHaveLength(5);
    expect(g.team_b).toHaveLength(5);
    const lineup: string[] = [...g.team_a, ...g.team_b];
    const post = calls.find((c) => c.method === "POST" && c.body.embeds?.[0]?.title?.startsWith("Game 1"))!;
    expect(post.body.allowed_mentions.users).toHaveLength(10); // the ten are pinged

    const resting = ids.findIndex((id) => !lineup.includes(id));
    await run(press(resting, `vote:${g.id}:0`));
    expect(calls.at(-1)!.body.content).toContain("Only the ten players");

    const bind = (g.map_options as string[]).indexOf("Bind");
    for (const [k, id] of lineup.entries()) await run(press(ids.indexOf(id), `vote:${g.id}:${k < 6 ? bind : 0}`));
    const [after] = await sql`select status, map_name from weekly_games where id = ${g.id}`;
    expect(after).toEqual({ status: "ready", map_name: "Bind" });
    firstMap = after.map_name;
    expect(calls.some((c) => c.body.content === "Game 1 is on **Bind**.")).toBe(true);
  });

  it("finds the finished game with one API call and posts rating changes", async () => {
    const [g] = await sql`select * from weekly_games where session_id = ${sessionId}`;
    const lineup: string[] = [...g.team_a, ...g.team_b];
    const players = lineup.map((id, k) => {
      const n = ids.indexOf(id);
      return { puuid: `id-${n}`, name: `Player${n}`, tag: "EUW", team_id: k < 5 ? "Blue" : "Red", agent: { name: "Jett" },
        stats: { score: 2000 + n * 300, kills: 8 + n, deaths: 14, assists: 3, headshots: 10, bodyshots: 30, legshots: 2, damage: { dealt: 2000 + n * 200 } } };
    });
    lobbyMatch = {
      metadata: { match_id: "weekly-1", map: { name: firstMap }, started_at: "2026-10-17T18:05:00Z", is_completed: true,
        game_length_in_ms: 2_000_000, cluster: "London", queue: { id: "", name: "Custom Game" } },
      players, rounds: [], teams: [{ team_id: "Blue", rounds: { won: 9 } }, { team_id: "Red", rounds: { won: 13 } }],
    };
    const { sessionTick } = await import("@/lib/discord/schedule");
    vi.setSystemTime(new Date("2026-10-17T18:50:00Z"));
    const tick = await sessionTick(new Date());
    expect(tick.errors).toEqual([]);
    expect(tick.steps.join()).toContain("game 1 result posted");
    expect(tick.steps.join()).not.toContain("Game 2 is up");
    const [played] = await sql`select status, match_id from weekly_games where id = ${g.id}`;
    expect(played).toEqual({ status: "played", match_id: "weekly-1" });
    const result = calls.find((c) => c.body.embeds?.[0]?.title?.startsWith("Game 1 result"))!;
    expect(result.body.embeds[0].title).toBe(`Game 1 result · ${firstMap} 9–13`);
    expect(result.body.embeds[0].description).toContain("Team B wins");
    expect(result.body.embeds[0].fields[0].value).toContain("#");
    expect(result.body.embeds[0].fields[0].value).toMatch(/\*\*-\d+\*\*/); // Team A lost rating
    expect(result.body.embeds[0].fields[1].value).toMatch(/\*\*\+\d+\*\*/);
    // The raw match was kept.
    expect(await sql`select 1 from val_match_raw where id = 'weekly-1'`).toHaveLength(1);
  });

  it("checks everyone in again for game 2: a leaver is swapped for whoever sat out, on the updated leaderboard", async () => {
    vi.setSystemTime(new Date("2026-10-17T19:00:00Z"));
    // The result opened game 2's check-in by itself, pinging tonight's roster.
    const [s0] = await sql`select checkin_for from weekly_sessions where id = ${sessionId}`;
    expect(s0.checkin_for).toBe(2);
    const checkinPost = calls.find((c) => c.method === "POST" && c.body.embeds?.[0]?.title === "Game 2 check-in")!;
    expect(checkinPost.body.allowed_mentions.users).toHaveLength(11);

    const [g1] = await sql`select * from weekly_games where number = 1`;
    const lineup1: string[] = [...g1.team_a, ...g1.team_b];
    const resting = ids.find((id) => !lineup1.includes(id))!;
    const leaver = lineup1[0];
    const presser = ids.indexOf(lineup1[1]);
    await run(press(presser, `next:${sessionId}`)); // already open: no second check-in
    expect(calls.at(-1)!.body.content).toContain("already open");

    await run(press(ids.indexOf(leaver), `out:${sessionId}`));
    const stayers = ids.filter((id) => id !== leaver);
    for (const id of stayers.slice(0, -1)) await run(press(ids.indexOf(id), `in:${sessionId}`));
    expect(await sql`select 1 from weekly_games where number = 2`).toHaveLength(0); // 9 in, one still to answer
    await run(press(ids.indexOf(stayers.at(-1)!), `teams:${sessionId}`)); // not in yet, can't make teams
    expect(calls.at(-1)!.body.content).toContain("Only players who are in");
    await run(press(ids.indexOf(stayers.at(-1)!), `in:${sessionId}`)); // ten in and everyone answered: teams are made
    const games = await sql`select * from weekly_games where session_id = ${sessionId} order by number`;
    expect(games).toHaveLength(2);
    const lineup2 = [...games[1].team_a, ...games[1].team_b];
    expect(lineup2).toContain(resting);
    expect(lineup2).not.toContain(leaver);
    expect(games[1].map_options).not.toContain(firstMap);
    const [s1] = await sql`select checkin_for from weekly_sessions where id = ${sessionId}`;
    expect(s1.checkin_for).toBeNull();
    // The game post shows each player's leaderboard rating and rank; game 1's winners are above 1000 now.
    const post = calls.find((c) => c.method === "POST" && c.body.embeds?.[0]?.title?.startsWith("Game 2 ·"))!;
    expect(post.body.embeds[0].fields.map((f: { value: string }) => f.value).join("\n")).toMatch(/· (10[1-9]\d|1[1-9]\d\d) · (Silver|Gold|Platinum|Diamond)/);

    await run(press(presser, `lock:${games[1].id}`)); // not an officer, and time isn't up
    expect(calls.at(-1)!.body.content).toContain("Officers can close it early");
    await run(press(presser, `lock:${games[1].id}`, "8")); // with Administrator permission
    const [locked] = await sql`select status from weekly_games where id = ${games[1].id}`;
    expect(locked.status).toBe("ready");

    await run(slash(presser, "weekly", [{ name: "end", type: 1, options: [] }])); // members can't end it
    expect(calls.at(-1)!.body.content).toBe("Only officers can do that.");
    await run(slash(presser, "weekly", [{ name: "end", type: 1, options: [] }], "8"));
    const [s] = await sql`select status from weekly_sessions where id = ${sessionId}`;
    expect(s.status).toBe("closed");
  });

  it("answers Discord's ping", async () => {
    expect(await run({ type: 1, id: "x", token: "t" })).toEqual({ type: 1 });
  });
});
