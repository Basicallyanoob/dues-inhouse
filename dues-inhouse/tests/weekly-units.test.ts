import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inWeeklyWindow, parseWindow, timeOnWindowDay, weeklyWindow } from "@/lib/val/window";
import { balanceTeams, chooseLineup, similarity } from "@/lib/weekly/balance";
import { tally } from "@/lib/weekly/session";
import { lobbyStrengths, rankTier, tierName } from "@/lib/weekly/strength";
import { verifySignature } from "@/lib/discord/api";
import { isCustomGame } from "@/lib/val/match";

const spec = parseWindow("sat 18:30-03:30")!;
const at = (iso: string) => new Date(iso);

describe("the Saturday window", () => {
  it("is 18:30 to 03:30 Irish time, in summer and in winter", () => {
    // 17 Oct 2026: Irish Summer Time (UTC+1).
    expect(inWeeklyWindow(at("2026-10-17T17:29:00Z"), spec)).toBe(false); // 18:29
    expect(inWeeklyWindow(at("2026-10-17T17:30:00Z"), spec)).toBe(true); // 18:30
    expect(inWeeklyWindow(at("2026-10-18T02:29:00Z"), spec)).toBe(true); // Sunday 03:29
    expect(inWeeklyWindow(at("2026-10-18T02:30:00Z"), spec)).toBe(false); // Sunday 03:30
    // 7 Nov 2026: winter (UTC+0).
    expect(inWeeklyWindow(at("2026-11-07T18:30:00Z"), spec)).toBe(true);
    expect(inWeeklyWindow(at("2026-11-07T18:29:00Z"), spec)).toBe(false);
    // A Wednesday never counts.
    expect(inWeeklyWindow(at("2026-10-14T19:30:00Z"), spec)).toBe(false);
  });

  it("handles the clocks going back during the night of 24-25 October", () => {
    const w = weeklyWindow(at("2026-10-24T20:00:00Z"), spec);
    expect(w.start.toISOString()).toBe("2026-10-24T17:30:00.000Z"); // 18:30 IST
    expect(w.end.toISOString()).toBe("2026-10-25T03:30:00.000Z"); // 03:30 GMT, after the change
    expect(inWeeklyWindow(at("2026-10-25T03:00:00Z"), spec)).toBe(true);
  });

  it("finds the next window, and times on its day", () => {
    const w = weeklyWindow(at("2026-10-14T12:00:00Z"), spec);
    expect(w.start.toISOString()).toBe("2026-10-17T17:30:00.000Z");
    expect(timeOnWindowDay(w, "18:45").toISOString()).toBe("2026-10-17T17:45:00.000Z");
    expect(parseWindow("off")).toBeNull();
    expect(() => parseWindow("saturday evening")).toThrow();
  });
});

describe("the queue check", () => {
  const match = (id: string, name: string) => ({
    metadata: { queue: { id, name }, is_completed: true },
    teams: [{ team_id: "Blue" }, { team_id: "Red" }], players: Array.from({ length: 10 }, () => ({})),
  });
  it("takes customs by name or by either id Riot has used, and flags new queue types", () => {
    expect(isCustomGame(match("custom", "Custom Game"), 10)[0]).toBe(true);
    expect(isCustomGame(match("", "Custom Game"), 10)[0]).toBe(true);
    expect(isCustomGame(match("", ""), 10)[0]).toBe(true);
    expect(isCustomGame(match("competitive", "Competitive"), 10)).toEqual([false, "a Competitive game"]);
    expect(isCustomGame(match("xyz", "Mystery"), 10)[1]).toMatch(/^skipped unknown queue type/);
  });
});

describe("team balancing", () => {
  const players = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const rating = (p: string) => 900 + Number(p.slice(1)) * 25;

  it("makes the most even 5v5", () => {
    const s = balanceTeams(players, rating, [], () => 0);
    expect(s.a).toHaveLength(5);
    expect(s.b).toHaveLength(5);
    expect(new Set([...s.a, ...s.b]).size).toBe(10);
    expect(s.gap).toBe(5); // ratings 900..1125 in 25s sum to an odd number of 25s, so 5 average points is the best possible
  });

  it("suggests a different split for the next game", () => {
    const first = balanceTeams(players, rating, [], () => 0);
    const second = balanceTeams(players, rating, [[first.a, first.b]], () => 0);
    expect(similarity(second.a, second.b, first.a, first.b)).toBeLessThan(1);
    expect(second.gap).toBeLessThan(20);
  });

  it("rotates whoever sat out into the next game", () => {
    const signups = Array.from({ length: 12 }, (_, i) => ({ player: `p${i}`, sat: i >= 10 ? 1 : 0, order: i }));
    const { playing, resting } = chooseLineup(signups);
    expect(playing).toContain("p10");
    expect(playing).toContain("p11");
    expect(resting).toEqual(["p8", "p9"]);
  });
});

describe("balancing strength", () => {
  it("uses rank for new players, and leaderboard rating more as they play", () => {
    const s = lobbyStrengths([
      { player: "newDiamond", rating: 1000, games: 0, current: 18, peak: 20 },
      { player: "newSilver", rating: 1000, games: 0, current: 10, peak: 11 },
      { player: "unranked", rating: 1000, games: 0, current: null, peak: null },
      { player: "veteran", rating: 1150, games: 40, current: 12, peak: 12 },
    ], 8);
    expect(s.get("newDiamond")!.strength).toBeGreaterThan(s.get("newSilver")!.strength);
    expect(s.get("unranked")!.strength).toBe(1000); // the lobby average
    // A Gold with a strong weeklies record is rated mostly on that record.
    expect(s.get("veteran")!.strength).toBeGreaterThan(1050);
    expect(s.get("newDiamond")!.rank).toBe("Diamond 1");
  });

  it("blends current and peak rank, and falls back to peak when unranked this act", () => {
    expect(rankTier(18, 20)).toBeCloseTo(18.6, 9);
    expect(rankTier(null, 20)).toBe(19);
    expect(rankTier(null, null)).toBeNull();
    expect(tierName(27)).toBe("Radiant");
  });
});

describe("the map vote", () => {
  it("picks the most voted map, breaking ties at random", () => {
    expect(tally(["Ascent", "Bind", "Haven"], ["Bind", "Bind", "Ascent"]).winner).toBe("Bind");
    expect(tally(["Ascent", "Bind"], ["Bind", "Ascent"], () => 0).winner).toBe("Ascent");
    expect(tally(["Ascent", "Bind"], ["Bind", "Ascent"], () => 0.99).winner).toBe("Bind");
    expect(tally(["Ascent", "Bind"], [], () => 0.6).winner).toBe("Bind");
  });
});

describe("Discord request signatures", () => {
  it("accepts Discord's signature and refuses anything else", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
    const body = JSON.stringify({ type: 1 });
    const ts = "1760000000";
    const sig = sign(null, Buffer.from(ts + body), privateKey).toString("hex");
    expect(verifySignature(raw, sig, ts, body)).toBe(true);
    expect(verifySignature(raw, sig, ts, body + " ")).toBe(false);
    expect(verifySignature(raw, sig, "1760000001", body)).toBe(false);
    expect(verifySignature(raw, null, ts, body)).toBe(false);
    expect(verifySignature("", sig, ts, body)).toBe(false);
  });
});
