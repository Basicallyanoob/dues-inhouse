import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "./db";

let sql: ReturnType<typeof import("@/lib/db").db>;
let shop: typeof import("@/lib/shop");
let player: string;

async function newPlayer(name: string) {
  const [r] = await sql`insert into players (display_name, slug) values (${name}, ${name.toLowerCase()}) returning id`;
  return r.id as string;
}
async function give(id: string, amount: number) {
  await sql`insert into ledger (player_id, kind, amount) values (${id}, 'admin', ${amount})`;
}

describe("the shop", () => {
  beforeAll(async () => {
    await resetDb();
    sql = (await import("@/lib/db")).db();
    shop = await import("@/lib/shop");
    player = await newPlayer("Aoife");
  });

  it("pays the daily reward once per Irish day", async () => {
    // 23:30 UTC on 14 Oct is 00:30 on 15 Oct in Dublin: a new day there.
    expect(await shop.claimDaily(player, new Date("2026-10-14T12:00:00Z"))).toBe(1000);
    await expect(shop.claimDaily(player, new Date("2026-10-14T22:00:00Z"))).rejects.toThrow("Already claimed");
    expect(await shop.claimDaily(player, new Date("2026-10-14T23:30:00Z"))).toBe(1000);
    expect(await shop.balance(player)).toBe(2000);
  });

  it("refuses a roll you can't afford, and charges nothing", async () => {
    const p = await newPlayer("Broke");
    await give(p, 999);
    await expect(shop.roll(p, 1)).rejects.toThrow("Not enough Crests");
    expect(await shop.balance(p)).toBe(999);
  });

  it("charges for a roll, adds the banner, and refunds part of a duplicate", async () => {
    const p = await newPlayer("Roller");
    await give(p, 2000);
    const always = () => 0; // first rarity (common), first banner
    const first = await shop.roll(p, 1, 1, always);
    expect(first.results[0]).toMatchObject({ rarity: "common", duplicate: false, refund: 0 });
    expect(first.balance).toBe(1000);
    const second = await shop.roll(p, 1, 1, always);
    expect(second.results[0]).toMatchObject({ duplicate: true, refund: 300 }); // 30% of 1,000 for a common
    expect(second.balance).toBe(300);
  });

  it("guarantees a legendary or better on the pity roll", async () => {
    const p = await newPlayer("Unlucky");
    await give(p, 60_000);
    const commons = () => 0;
    const { results } = await shop.roll(p, 1, 10, commons);
    expect(results.every((r) => r.rarity === "common")).toBe(true);
    let last;
    for (let i = 0; i < 5; i++) last = await shop.roll(p, 1, 10, commons);
    // Roll 60 is the pity roll (pity = 60 in the seed).
    const sixtieth = last!.results[9];
    expect(["legendary", "ultimate"]).toContain(sixtieth.rarity);
    expect(sixtieth.pity).toBe(true);
    expect(await shop.pityCount(p, 1)).toBe(0);
  });

  it("never lets two rolls at once spend the same coins", async () => {
    const p = await newPlayer("Racer");
    await give(p, 1500);
    const attempts = await Promise.allSettled([shop.roll(p, 1), shop.roll(p, 1), shop.roll(p, 1)]);
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect(await shop.balance(p)).toBeGreaterThanOrEqual(500);
  });

  it("only equips banners you own or that everyone has", async () => {
    const p = await newPlayer("Equipper");
    await shop.equip(p, 1); // a default
    await expect(shop.equip(p, 18)).rejects.toThrow("don't own");
  });

  it("sells buyable banners once", async () => {
    const p = await newPlayer("Buyer");
    await give(p, 5000);
    const [b] = await sql`select id, rarity from banners where buyable and rarity = 'rare' limit 1`;
    expect(await shop.buy(p, b.id)).toBe(5000 - 1400);
    await expect(shop.buy(p, b.id)).rejects.toThrow("already own");
    const [notForSale] = await sql`select id from banners where not buyable and set_id is not null limit 1`;
    await expect(shop.buy(p, notForSale.id)).rejects.toThrow("isn't for sale");
  });

  it("redeems promo codes once each, respecting limits", async () => {
    const p = await newPlayer("Promo");
    const q = await newPlayer("Promo2");
    await sql`insert into promo_codes (code, reward, amount, max_uses) values ('FRESHERS', 'coins', 2500, 1)`;
    expect(await shop.redeem(p, " freshers ")).toMatch("2,500");
    await expect(shop.redeem(p, "FRESHERS")).rejects.toThrow("already used");
    await expect(shop.redeem(q, "FRESHERS")).rejects.toThrow("used up");
    await sql`insert into promo_codes (code, reward, banner_id) values ('CREST', 'banner', 18)`;
    expect(await shop.redeem(q, "crest")).toMatch("The Crest");
    await shop.equip(q, 18);
  });
});
