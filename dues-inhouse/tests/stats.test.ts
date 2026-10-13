import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "./db";
import { STATS_VERSION, trim } from "@/lib/val/match";

const AGENTS = ["Jett", "Omen", "Sova", "Killjoy", "Sage"];
const who = (i: number) => ({ puuid: `id-P${i}`, name: `P${i}`, tag: "EUW", team: i < 5 ? "Blue" : "Red" });

/** A HenrikDev v4 match with a kill feed and spike plants, the parts first bloods and plants come from. */
function apiMatch(id = "stats-game") {
  return {
    metadata: { match_id: id, map: { name: "Bind" }, started_at: "2026-10-17T19:10:00Z", is_completed: true,
      game_length_in_ms: 1_800_000, cluster: "London", queue: { id: "", name: "Custom Game" } },
    players: Array.from({ length: 10 }, (_, i) => ({ ...who(i), team_id: who(i).team, agent: { name: AGENTS[i % 5] },
      stats: { score: 4000, kills: 15, deaths: 12, assists: 4, headshots: 10, bodyshots: 30, legshots: 2, damage: { dealt: 3000 } } })),
    // Out of order on purpose: each round's first blood is its earliest kill.
    kills: [
      { round: 0, time_in_round_in_ms: 9000, killer: who(5) }, { round: 0, time_in_round_in_ms: 4000, killer: who(0) },
      { round: 1, time_in_round_in_ms: 3000, killer: who(5) }, { round: 1, time_in_round_in_ms: 6000, killer: who(0) },
      { round: 2, time_in_round_in_ms: 1500, killer: who(0) },
    ],
    rounds: [{ id: 0, plant: { site: "A", player: who(1) } }, { id: 1, plant: null }, { id: 2, plant: { site: "B", player: who(1) } }],
    teams: [{ team_id: "Blue", rounds: { won: 13 } }, { team_id: "Red", rounds: { won: 7 } }],
  };
}

const line = (m: ReturnType<typeof trim>, name: string) => m.players.find((p) => p.name === name)!;

describe("first bloods and plants", () => {
  it("counts first bloods from the kill feed and plants from the rounds", () => {
    const m = trim(apiMatch());
    expect([line(m, "P0").first_bloods, line(m, "P5").first_bloods, line(m, "P1").first_bloods]).toEqual([2, 1, 0]);
    expect([line(m, "P1").plants, line(m, "P0").plants]).toEqual([2, 0]);
  });

  it("says unknown, not zero, when the API sent no kill feed or rounds", () => {
    const m = trim({ ...apiMatch(), kills: [], rounds: [] });
    expect(line(m, "P0").first_bloods).toBeNull();
    expect(line(m, "P0").plants).toBeNull();
  });
});

describe("re-reading stored games from their saved API data", () => {
  let sql: ReturnType<typeof import("@/lib/db").db>;
  beforeAll(async () => {
    await resetDb();
    sql = (await import("@/lib/db")).db();
  });

  it("brings games imported with older stats up to date, once", async () => {
    const { restatFromRaw } = await import("@/lib/ingest");
    const raw = apiMatch("old-game");
    // As an older version stored it: no stats version, first bloods all wrongly 0, no plants.
    const old = trim(raw);
    const data = { server: old.server, players: old.players.map((p) => ({ ...p, first_bloods: 0, plants: undefined })) };
    await sql`insert into val_matches (id, played_at, map_name, score_blue, score_red, length_ms, source, data)
              values ('old-game', ${old.playedAt}, 'Bind', 13, 7, 0, 'henrikdev', ${sql.json(data as never)})`;
    await sql`insert into val_match_raw (id, raw) values ('old-game', ${sql.json(raw as never)})`;

    expect(await restatFromRaw()).toBe(1);
    const [row] = await sql`select data from val_matches where id = 'old-game'`;
    expect(row.data.stats).toBe(STATS_VERSION);
    const p0 = row.data.players.find((p: { name: string }) => p.name === "P0");
    const p1 = row.data.players.find((p: { name: string }) => p.name === "P1");
    expect([p0.first_bloods, p1.plants]).toEqual([2, 2]);
    expect(await restatFromRaw()).toBe(0);
  });

  it("updates an older stored game when the import sees it again", async () => {
    const { saveValMatch } = await import("@/lib/ingest");
    await sql`update val_matches set data = data - 'stats' where id = 'old-game'`;
    const raw = apiMatch("old-game");
    expect(await saveValMatch(trim(raw), null, undefined, raw)).toBe("duplicate");
    const [row] = await sql`select data->>'stats' as stats from val_matches where id = 'old-game'`;
    expect(Number(row.stats)).toBe(STATS_VERSION);
  });

  it("shows the new figures on the leaderboard", async () => {
    const { getSite } = await import("@/lib/season");
    const { valRates } = await import("@/lib/season");
    const site = await getSite();
    const p1 = [...site.val.players.values()].find((p) => p.person.name === "P1")!;
    const r = valRates(p1.totals);
    expect(r.plants).toBe(2);
    expect(r.kpr).toBeCloseTo(15 / 20);
    expect(r.fbpr).toBe(0);
  });
});
