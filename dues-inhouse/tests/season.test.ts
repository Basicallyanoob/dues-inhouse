import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "./db";

const FIX = path.join(__dirname, "fixtures");

describe("importing the demo season", () => {
  beforeAll(async () => {
    await resetDb();
  });

  it("reads every log and game in a zip, and skips them the second time", async () => {
    const { processUploads } = await import("@/lib/uploads");
    const bytes = new Uint8Array(fs.readFileSync(path.join(FIX, "demo.zip")));
    const first = await processUploads([{ name: "demo.zip", bytes }], null);
    expect(first.filter((r) => !r.ok)).toEqual([]);
    expect(first.filter((r) => r.message.startsWith("Overwatch"))).toHaveLength(37);
    expect(first.filter((r) => r.message.startsWith("Valorant"))).toHaveLength(21);
    const again = await processUploads([{ name: "demo.zip", bytes }], null);
    expect(again.every((r) => r.message === "already imported")).toBe(true);
  });

  it("rates Overwatch exactly as the Python site did", async () => {
    const { getSite } = await import("@/lib/season");
    const site = await getSite();
    const expected = JSON.parse(fs.readFileSync(path.join(FIX, "expected-ow.json"), "utf8"));
    expect(site.ow.maps).toHaveLength(expected.maps);
    const byName = new Map([...site.ow.players.values()].map((p) => [p.person.name, p.person.key]));
    for (const [name, [mu, sigma, maps]] of Object.entries(expected.overall) as [string, number[]][]) {
      const r = site.ow.book.get(byName.get(name)!);
      expect(r.mu).toBeCloseTo(mu, 9);
      expect(r.sigma).toBeCloseTo(sigma, 9);
      expect(r.maps).toBe(maps);
    }
    for (const [k, [mu]] of Object.entries(expected.by_role) as [string, number[]][]) {
      const [name, role] = k.split("|");
      expect(site.ow.book.get(byName.get(name)!, role).mu).toBeCloseTo(mu, 9);
    }
  });

  it("rates Valorant exactly as the Python site did, joining typed-in rows to API players", async () => {
    const { getSite } = await import("@/lib/season");
    const site = await getSite();
    const expected = JSON.parse(fs.readFileSync(path.join(FIX, "expected-val.json"), "utf8"));
    expect(site.val.maps).toHaveLength(expected.maps);
    expect(site.val.players.size).toBe(Object.keys(expected.overall).length);
    const byName = new Map([...site.val.players.values()].map((p) => [p.person.name, p.person.key]));
    for (const [name, [mu, sigma]] of Object.entries(expected.overall) as [string, number[]][]) {
      expect(site.val.book.get(byName.get(name)!).mu).toBeCloseTo(mu, 9);
      expect(site.val.book.get(byName.get(name)!).sigma).toBeCloseTo(sigma, 9);
    }
  });
});
