import { describe, expect, it } from "vitest";
import { adjustForPerformance, display, lobbyPerformance, marginFactor, rateGames } from "@/lib/ratings";

const team = (prefix: string) => Array.from({ length: 5 }, (_, i) => [`${prefix}${i}`, null] as [string, null]);

describe("performance-adjusted ratings", () => {
  it("never flips a change's direction and keeps each team's total", () => {
    for (let trial = 0; trial < 500; trial++) {
      const sign = trial % 2 ? 1 : -1;
      const changes = Array.from({ length: 5 }, () => sign * (0.2 + Math.random() * 3));
      const perf = Array.from({ length: 5 }, () => Math.random() * 2 - 1);
      const out = adjustForPerformance(changes, perf, 0.3);
      out.forEach((c, i) => {
        expect(Math.sign(c)).toBe(sign);
        expect(Math.abs(c / changes[i] - 1)).toBeLessThanOrEqual(0.3 + 1e-9);
      });
      expect(out.reduce((s, x) => s + x, 0)).toBeCloseTo(changes.reduce((s, x) => s + x, 0), 9);
    }
  });

  it("the best player on the losing team loses least; the best on the winning team gains most", () => {
    const lines = [
      // Team A lost 9-13; A0 top-fragged.
      { player: "A0", acs: 320, kd: 24 / 14, adr: 200 }, { player: "A1", acs: 210, kd: 15 / 16, adr: 140 },
      { player: "A2", acs: 200, kd: 14 / 16, adr: 135 }, { player: "A3", acs: 190, kd: 13 / 17, adr: 130 },
      { player: "A4", acs: 90, kd: 5 / 15, adr: 70 },
      { player: "B0", acs: 300, kd: 22 / 12, adr: 190 }, { player: "B1", acs: 230, kd: 17 / 14, adr: 150 },
      { player: "B2", acs: 220, kd: 16 / 14, adr: 145 }, { player: "B3", acs: 180, kd: 13 / 15, adr: 120 },
      { player: "B4", acs: 120, kd: 8 / 14, adr: 85 },
    ];
    const plain = rateGames([{ id: "g", winner: 2, team1: team("A"), team2: team("B") }], 0, 0);
    const book = rateGames([{ id: "g", winner: 2, team1: team("A"), team2: team("B"), perf: lines }], 0.3, 0);
    const d = book.deltas.get("g")!;
    expect(d.get("A0")!).toBeLessThan(0);
    expect(d.get("A0")!).toBeGreaterThan(d.get("A1")!);
    expect(d.get("A4")!).toBeLessThan(d.get("A3")!);
    expect(d.get("B0")!).toBeGreaterThan(d.get("B4")!);
    expect(d.get("B4")!).toBeGreaterThan(0);
    // Same team totals as the result alone (in mu, before rounding to display points).
    const sum = (b: typeof book, p: string) => [0, 1, 2, 3, 4].reduce((s, i) => s + b.get(`${p}${i}`).mu, 0);
    expect(sum(book, "A")).toBeCloseTo(sum(plain, "A"), 9);
    expect(sum(book, "B")).toBeCloseTo(sum(plain, "B"), 9);
    expect(book.perf.get("g")!.get("A0")!.rank).toBe(1);
  });

  it("ranks the lobby by ACS first, and copes without damage numbers", () => {
    const perf = lobbyPerformance([
      { player: "x", acs: 300, kd: 1, adr: null }, { player: "y", acs: 200, kd: 1.5, adr: null }, { player: "z", acs: 100, kd: 0.5, adr: null },
    ]);
    expect([...perf.entries()].sort((a, b) => a[1].rank - b[1].rank).map(([p]) => p)).toEqual(["x", "y", "z"]);
    for (const p of perf.values()) expect(Math.abs(p.p)).toBeLessThanOrEqual(1);
  });

  it("starts everyone at 1000, whatever their rank", () => {
    const book = rateGames([]);
    expect(display(book.get("anyone").mu)).toBe(1000);
    expect(book.value("anyone")).toBeNull(); // not on the ladder until they've played
  });

  it("moves ratings less after a close game than after a stomp", () => {
    expect(marginFactor([13, 7], 0.2)).toBeCloseTo(1, 9);
    expect(marginFactor([13, 11], 0.2)).toBeLessThan(0.9);
    expect(marginFactor([3, 13], 0.2)).toBeGreaterThan(1.2);
    expect(marginFactor([13, 0], 0.2)).toBeCloseTo(1.4, 9);
    expect(marginFactor([14, 12], 0.2)).toBeGreaterThanOrEqual(0.8);
    expect(marginFactor([13, 13], 0.2)).toBe(1);
    expect(marginFactor([13, 3], 0)).toBe(1);
    const game = (score: [number, number]) => rateGames([{ id: "g", winner: 1, team1: team("A"), team2: team("B"), score }], 0, 0.2);
    const close = game([13, 11]).deltas.get("g")!.get("A0")!;
    const stomp = game([13, 2]).deltas.get("g")!.get("A0")!;
    expect(close).toBeGreaterThan(0);
    expect(stomp).toBeGreaterThan(close);
  });
});
