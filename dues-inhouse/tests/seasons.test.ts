import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "./db";

const AGENTS = ["Jett", "Omen", "Sova", "Killjoy", "Sage"];

/** A Saturday-evening custom in the HenrikDev v4 shape: three members and seven guests. */
function apiMatch(id: string, start: string) {
  const names = [["Aoife", "EUW"], ["Cian", "EUW"], ["Saoirse", "EUW"], ...Array.from({ length: 7 }, (_, i) => [`Guest${i}`, "0000"])];
  return {
    metadata: { match_id: id, map: { name: "Bind" }, started_at: start, is_completed: true,
      game_length_in_ms: 2_000_000, cluster: "London", queue: { id: "", name: "Custom Game" } },
    players: names.map(([n, t], i) => ({ puuid: `id-${n}-${t}`, name: n, tag: t, team_id: i < 5 ? "Blue" : "Red",
      agent: { name: AGENTS[i % 5] }, stats: { score: 4000, kills: 15, deaths: 12, assists: 4, headshots: 10, bodyshots: 30, legshots: 2, damage: { dealt: 3000 } } })),
    teams: [{ team_id: "Blue", rounds: { won: 13 } }, { team_id: "Red", rounds: { won: 9 } }],
  };
}

// Saturdays, 19:00 Irish time (18:00 UTC in summer time).
const OLD = apiMatch("last-month", "2026-09-19T18:00:00Z");
const NEW = apiMatch("tonight", "2026-10-17T18:00:00Z");
const NEXT = apiMatch("next-week", "2026-10-24T18:00:00Z");
let history: unknown[] = [];
const fetcher = async () => new Response(JSON.stringify({ status: 200, data: history }), { status: 200 });

let sql: ReturnType<typeof import("@/lib/db").db>;

describe("seasons and removed games", () => {
  beforeAll(async () => {
    await resetDb();
    sql = (await import("@/lib/db")).db();
    process.env.HENRIKDEV_API_KEY = "HDEV-test";
    process.env.VAL_REQUEST_GAP_MS = "0";
    const [{ id: admin }] = await sql`insert into players (display_name, slug, role, auth_id) values ('Admin', 'admin', 'admin', gen_random_uuid()) returning id`;
    const { addRosterMember } = await import("@/lib/members");
    for (const n of ["Aoife", "Cian", "Saoirse"]) await addRosterMember(n, [], [`${n}#EUW`], admin);
  });

  const fetchAll = async () => {
    const { fetchBatch } = await import("@/lib/val/fetch");
    await sql`update game_accounts set last_checked_at = null`;
    return fetchBatch({ fetcher, since: new Date(Date.now() + 1000) });
  };
  const counted = async () => {
    const { getSite } = await import("@/lib/season");
    return (await getSite()).val.maps.map((m) => m.id).sort();
  };

  it("counts every game until a season starts", async () => {
    history = [OLD, NEW];
    await fetchAll();
    expect(await counted()).toEqual(["last-month", "tonight"]);
  });

  it("counts only this season's games once one starts, and starts everyone again from 1,000", async () => {
    const { setSeasonStart } = await import("@/lib/seasons");
    await setSeasonStart("2026-10-17");
    expect(await counted()).toEqual(["tonight"]);
    const { getSite } = await import("@/lib/season");
    const aoife = [...(await getSite()).people.values()].find((p) => p.name === "Aoife")!;
    const history = (await getSite()).val.book.history.get(aoife.key)!;
    expect(history).toHaveLength(1); // only tonight's game moved her rating
  });

  it("doesn't import games from before the season start", async () => {
    await sql`delete from val_matches; delete from val_match_raw`.simple();
    history = [OLD, NEW];
    const report = await fetchAll();
    expect(report.added).toHaveLength(1);
    expect(report.skipped["before the season started"]).toBeGreaterThan(0);
    const [{ n }] = await sql`select count(*)::int as n from val_matches where id = 'last-month'`;
    expect(n).toBe(0);
  });

  it("doesn't bring back a game an officer removed", async () => {
    const { deleteGame } = await import("@/lib/ingest");
    await deleteGame("valorant", "tonight");
    history = [NEW, NEXT];
    const report = await fetchAll();
    expect(report.skipped["removed by an officer"]).toBeGreaterThan(0);
    expect(await counted()).toEqual(["next-week"]);
  });

  it("counts every game again when the season start is cleared", async () => {
    const { setSeasonStart } = await import("@/lib/seasons");
    await setSeasonStart(null);
    history = [OLD];
    await fetchAll();
    expect(await counted()).toEqual(["last-month", "next-week"]);
  });
});
