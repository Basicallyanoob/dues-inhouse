import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Load a page script the way Node would load a CommonJS file, so it exports instead of touching the page. */
function load(file: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = { exports: {} as Record<string, (...a: unknown[]) => any> };
  new Function("module", fs.readFileSync(path.join(import.meta.dirname, "..", "public", file), "utf8"))(mod);
  return mod.exports;
}

describe("team builders", () => {
  it("Overwatch: finds legal 1-2-2 splits", () => {
    const { balance } = load("builder.js");
    const roles = ["tank", "tank", "damage", "damage", "damage", "damage", "support", "support", "support", "support"];
    const signups = roles.map((r, i) => ({ player: `p${i}`, roles: [r] }));
    const ratings = Object.fromEntries(signups.map((s, i) => [s.player, { overall: [20 + i, 5], roles: {} }]));
    const out = balance(signups, ratings);
    expect(out).toHaveLength(3);
    expect(out[0].team1.tank).toHaveLength(1);
    expect(out[0].team1.damage).toHaveLength(2);
  });

  it("Valorant: splits controller mains when it can", () => {
    const { balance } = load("valbuilder.js");
    const names = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const ratings = Object.fromEntries(names.map((n) => [n, { overall: [25, 5], cls: "duelist" }]));
    ratings.p0.cls = ratings.p1.cls = "controller";
    const [best] = balance(names, ratings);
    expect(best.team1).toContain("p0");
    expect(best.team2).toContain("p1");
  });
});
