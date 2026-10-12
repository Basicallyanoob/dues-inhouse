import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "./db";

const AGENTS = ["Jett", "Omen", "Sova", "Killjoy", "Sage"];

/** A match in the shape the HenrikDev v4 API returns (only the parts we read). */
function apiMatch(id: string, names: [string, string][], opts: { queue?: [string, string]; start?: string; puuids?: string[] } = {}) {
  const puuids = opts.puuids ?? names.map(([n, t]) => `id-${n}-${t}`);
  return {
    metadata: { match_id: id, map: { name: "Ascent" }, started_at: opts.start ?? "2026-10-17T18:52:00Z", is_completed: true,
      game_length_in_ms: 2_000_000, cluster: "London", queue: { id: opts.queue?.[0] ?? "", name: opts.queue?.[1] ?? "Custom Game" } },
    players: names.map(([n, t], i) => ({ puuid: puuids[i], name: n, tag: t, team_id: i < names.length / 2 ? "Blue" : "Red",
      agent: { name: AGENTS[i % 5] }, stats: { score: 4000, kills: 15, deaths: 12, assists: 4, headshots: 10, bodyshots: 30, legshots: 2, damage: { dealt: 3000 } } })),
    rounds: [{ first_blood: { puuid: puuids[0] } }],
    teams: [{ team_id: "Blue", rounds: { won: 13 } }, { team_id: "Red", rounds: { won: 9 } }],
  };
}

const lobby = (members: [string, string][], strangers: number) =>
  [...members, ...Array.from({ length: strangers }, (_, i) => [`Guest${i}`, "0000"] as [string, string])];

let sql: ReturnType<typeof import("@/lib/db").db>;

describe("members, links and the Valorant import", () => {
  let admin: string;
  beforeAll(async () => {
    await resetDb();
    sql = (await import("@/lib/db")).db();
    [{ id: admin }] = await sql`insert into players (display_name, slug, role, auth_id) values ('Admin', 'admin', 'admin', gen_random_uuid()) returning id`;
  });

  it("imports only custom games with enough members, from every linked Riot ID, once each", async () => {
    const { addRosterMember } = await import("@/lib/members");
    const { fetchBatch } = await import("@/lib/val/fetch");
    for (const n of ["Aoife", "Cian", "Saoirse"]) await addRosterMember(n, [], [`${n}#EUW`], admin);
    await addRosterMember("Niamh", [], ["Niamh#EUW"], admin);
    const club = (["Aoife", "Cian", "Saoirse"] as const).map((n) => [n, "EUW"] as [string, string]);
    const inhouse = apiMatch("inhouse", lobby(club, 7));
    const twoMembers = apiMatch("two-members", lobby(club.slice(0, 2), 8));
    const ranked = apiMatch("ranked", lobby(club, 7), { queue: ["competitive", "Competitive"] });
    const wednesday = apiMatch("wednesday", lobby(club, 7), { start: "2026-10-14T19:30:00Z" });
    const oddQueue = apiMatch("odd", lobby(club, 7), { queue: ["brandnew", "Brand New"] });
    const histories: Record<string, unknown[]> = {
      "Aoife/EUW": [inhouse, twoMembers, ranked, wednesday, oddQueue], "Cian/EUW": [inhouse], "Saoirse/EUW": [], "Niamh/EUW": [],
    };
    const urls: string[] = [];
    const fetcher = async (url: string, init: RequestInit) => {
      urls.push(url);
      expect((init.headers as Record<string, string>).Authorization).toBe("HDEV-test");
      const key = url.split("/pc/")[1].split("?")[0];
      return new Response(JSON.stringify({ status: 200, data: histories[key] ?? [] }), { status: 200 });
    };
    process.env.HENRIKDEV_API_KEY = "HDEV-test";
    process.env.VAL_REQUEST_GAP_MS = "0";
    const report = await fetchBatch({ fetcher, since: new Date(Date.now() + 1000) });
    expect(report.checked).toHaveLength(4);
    expect(report.added).toEqual(["Ascent 13–9"]);
    expect(report.duplicates).toBe(1); // the inhouse again, through Cian
    expect(report.skipped).toEqual({
      "a Competitive game": 1, "fewer than 3 members in the lobby": 1, "outside the session window": 1,
      'skipped unknown queue type "brandnew" (Brand New)': 1,
    });
    expect(urls.every((u) => !u.includes("HDEV") && u.includes("mode=custom"))).toBe(true);
    // The whole API response is kept for later stats.
    const [raw] = await sql`select raw->'metadata'->>'match_id' as id from val_match_raw`;
    expect(raw.id).toBe("inhouse");
    // The three members were paid, and their account ids learned.
    const paid = await sql`select p.display_name, l.amount from ledger l join players p on p.id = l.player_id where l.kind = 'game' order by 1`;
    expect(paid.map((r) => r.display_name)).toEqual(["Aoife", "Cian", "Saoirse"]);
    const [{ n }] = await sql`select count(*)::int as n from game_accounts where puuid is not null`;
    expect(n).toBe(3);
    // A second batch straight away has nobody left to check.
    expect((await fetchBatch({ fetcher, since: new Date(Date.now() - 60_000) })).checked).toEqual([]);
  });

  it("follows a member through a Riot name change by account id", async () => {
    const { saveValMatch } = await import("@/lib/ingest");
    const { trim } = await import("@/lib/val/match");
    const { getSite } = await import("@/lib/season");
    const renamed = apiMatch("renamed", [["NewAoife", "0001"], ["Cian", "EUW"], ["Saoirse", "EUW"], ...lobby([], 7)],
      { puuids: ["id-Aoife-EUW", "id-Cian-EUW", "id-Saoirse-EUW", ...Array.from({ length: 7 }, (_, i) => `id-Guest${i}-0000`)], start: "2026-10-24T19:00:00Z" });
    await saveValMatch(trim(renamed), null);
    const site = await getSite();
    const aoife = [...site.val.players.values()].find((p) => p.person.name === "Aoife")!;
    expect(aoife.apps).toHaveLength(2);
    expect([...aoife.person.riotIds].sort()).toEqual(["Aoife#EUW", "NewAoife#0001"]);
  });

  it("merges a roster entry into the member who signs in and claims the account", async () => {
    const { requestLink, approveLink } = await import("@/lib/members");
    const { balance } = await import("@/lib/shop");
    const [roster] = await sql`select id from players where display_name = 'Aoife'`;
    const before = await balance(roster.id);
    expect(before).toBeGreaterThan(0);
    const [me] = await sql`insert into players (display_name, slug, auth_id) values ('Aoife D', 'aoife-d', gen_random_uuid()) returning id`;
    await requestLink(me.id, "valorant", "aoife#euw");
    const [req] = await sql`select id from game_accounts where player_id = ${me.id}`;
    await approveLink(req.id, admin);
    expect(await sql`select 1 from players where id = ${roster.id}`).toHaveLength(0);
    expect(await balance(me.id)).toBe(before);
    const [acct] = await sql`select puuid from game_accounts where player_id = ${me.id} and status = 'approved'`;
    expect(acct.puuid).toBe("id-Aoife-EUW");
  });

  it("won't link an account another signed-in member already has", async () => {
    const { requestLink } = await import("@/lib/members");
    const [thief] = await sql`insert into players (display_name, slug, auth_id) values ('Thief', 'thief', gen_random_uuid()) returning id`;
    await expect(requestLink(thief.id, "valorant", "Aoife#EUW")).rejects.toThrow("already linked");
    await expect(requestLink(thief.id, "valorant", "no tag")).rejects.toThrow("Name#Tag");
  });

  it("links from Discord: approved at once, merging an unclaimed roster entry, never taking a Discord member's account", async () => {
    const { linkFromDiscord, playerForDiscord, addRosterMember } = await import("@/lib/members");
    const { balance } = await import("@/lib/shop");
    await addRosterMember("Ronan", [], ["Ronan#EUW"], admin);
    const [roster] = await sql`select id from players where display_name = 'Ronan'`;
    const ronan = (await playerForDiscord({ id: "111", name: "ronan" }, true))!;
    expect(await linkFromDiscord(ronan.id, { account: "Ronan#EUW", puuid: "id-Ronan", current: 18, peak: 20 })).toBe("linked");
    expect(await sql`select 1 from players where id = ${roster.id}`).toHaveLength(0);
    const [acct] = await sql`select puuid, current_tier, peak_tier, status from game_accounts where player_id = ${ronan.id}`;
    expect(acct).toEqual({ puuid: "id-Ronan", current_tier: 18, peak_tier: 20, status: "approved" });
    // Linking again (say after a rename) updates the same link.
    expect(await linkFromDiscord(ronan.id, { account: "Ronan2#EUW", puuid: "id-Ronan", current: 19, peak: 20 })).toBe("updated");
    // A bot-made member's account can't be claimed by someone else, from Discord or the site.
    const other = (await playerForDiscord({ id: "222", name: "other" }, true))!;
    await expect(linkFromDiscord(other.id, { account: "Ronan2#EUW", puuid: "id-Ronan", current: null, peak: null })).rejects.toThrow("already linked");
    const { requestLink } = await import("@/lib/members");
    const [webUser] = await sql`insert into players (display_name, slug, auth_id) values ('Web', 'web', gen_random_uuid()) returning id`;
    await expect(requestLink(webUser.id, "valorant", "Ronan2#EUW")).rejects.toThrow("already linked");
    expect(await balance(ronan.id)).toBeGreaterThanOrEqual(0);
  });

  it("takes the coins back when a game is removed", async () => {
    const { deleteGame } = await import("@/lib/ingest");
    const [{ n: before }] = await sql`select count(*)::int as n from ledger where ref = 'val:inhouse'`;
    expect(before).toBeGreaterThan(0);
    await deleteGame("valorant", "inhouse");
    const [{ n }] = await sql`select count(*)::int as n from ledger where ref = 'val:inhouse'`;
    expect(n).toBe(0);
  });
});
