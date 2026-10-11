/** Coins, the daily reward, promo codes, and the banner shop. All spending is locked per player. */
import { randomInt } from "node:crypto";
import { db, type Tx } from "./db";
import {
  CURRENCY, DAILY_COINS, DEFAULT_RATES, DUPLICATE_REFUND, RARITIES, RARITY_PRICE, type Rarity,
} from "./economy";
import { local } from "./time";

export class ShopError extends Error {}

type Sql = ReturnType<typeof db> | Tx;

export async function balance(playerId: string, sql: Sql = db()): Promise<number> {
  const [row] = await sql`select coalesce(sum(amount), 0)::int as total from ledger where player_id = ${playerId}`;
  return row.total;
}

/** Locks the player's row for the rest of the transaction, so two tabs can't spend the same coins. */
async function lock(tx: Tx, playerId: string) {
  const [row] = await tx`select id, last_daily from players where id = ${playerId} for update`;
  if (!row) throw new ShopError("No such player.");
  return row;
}

export function todayInIreland(now = new Date()): string {
  const p = local(now);
  return `${p.year}-${p.month}-${p.day}`;
}

export async function claimDaily(playerId: string, now = new Date()): Promise<number> {
  return db().begin(async (tx) => {
    const row = await lock(tx, playerId);
    const today = todayInIreland(now);
    const last = row.last_daily ? new Date(row.last_daily).toISOString().slice(0, 10) : null;
    if (last === today) throw new ShopError("Already claimed today. Come back tomorrow.");
    await tx`update players set last_daily = ${today} where id = ${playerId}`;
    await tx`insert into ledger (player_id, kind, amount, note) values (${playerId}, 'daily', ${DAILY_COINS}, 'Daily reward')`;
    return DAILY_COINS;
  });
}

export async function canClaimDaily(playerId: string, now = new Date()): Promise<boolean> {
  const [row] = await db()`select last_daily from players where id = ${playerId}`;
  return !row?.last_daily || new Date(row.last_daily).toISOString().slice(0, 10) !== todayInIreland(now);
}

export interface BannerSet {
  id: number;
  slug: string;
  name: string;
  description: string;
  kind: "standard" | "limited";
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  rollCost: number;
  rates: Record<Rarity, number>;
  pity: number;
  featuredBannerId: number | null;
}

export const toSet = (r: Record<string, unknown>): BannerSet => ({
  id: r.id as number, slug: r.slug as string, name: r.name as string, description: r.description as string,
  kind: r.kind as BannerSet["kind"], active: r.active as boolean,
  startsAt: (r.starts_at as Date) ?? null, endsAt: (r.ends_at as Date) ?? null, rollCost: r.roll_cost as number,
  rates: { ...DEFAULT_RATES, ...(r.rates as object) }, pity: r.pity as number, featuredBannerId: (r.featured_banner_id as number) ?? null,
});

export function setOpen(s: BannerSet, now = new Date()): boolean {
  return s.active && (!s.startsAt || s.startsAt <= now) && (!s.endsAt || s.endsAt > now);
}

export interface RollResult {
  bannerId: number;
  name: string;
  rarity: Rarity;
  duplicate: boolean;
  refund: number;
  pity: boolean;
}

/** Weighted pick among rarities that have banners in the pool. */
export function pickRarity(rates: Record<Rarity, number>, available: Set<Rarity>, rnd: (n: number) => number, only?: Rarity[]): Rarity {
  const choices = RARITIES.filter((r) => available.has(r) && (!only || only.includes(r)) && rates[r] > 0);
  if (!choices.length) throw new ShopError("This set has no banners to roll yet.");
  const scale = 1_000_000;
  const weights = choices.map((r) => Math.round(rates[r] * scale));
  let x = rnd(weights.reduce((a, b) => a + b, 0));
  for (let i = 0; i < choices.length; i++) {
    if (x < weights[i]) return choices[i];
    x -= weights[i];
  }
  return choices[choices.length - 1];
}

const HIGH: Rarity[] = ["legendary", "ultimate"];

export async function roll(playerId: string, setId: number, count: 1 | 10 = 1, rnd: (n: number) => number = randomInt): Promise<{ results: RollResult[]; balance: number }> {
  return db().begin(async (tx) => {
    await lock(tx, playerId);
    const [setRow] = await tx`select * from banner_sets where id = ${setId}`;
    if (!setRow) throw new ShopError("No such banner set.");
    const set = toSet(setRow);
    if (!setOpen(set)) throw new ShopError("This set isn't in the shop right now.");
    const pool = await tx`select id, name, rarity from banners where set_id = ${setId} and active and not is_default`;
    const byRarity = new Map<Rarity, { id: number; name: string }[]>();
    for (const b of pool) byRarity.set(b.rarity, [...(byRarity.get(b.rarity) ?? []), { id: b.id, name: b.name }]);
    const cost = set.rollCost * count;
    if ((await balance(playerId, tx)) < cost) throw new ShopError(`Not enough ${CURRENCY}: ${count === 1 ? "a roll" : "10 rolls"} costs ${cost.toLocaleString("en-IE")}.`);
    const owned = new Set((await tx`select banner_id from owned_banners where player_id = ${playerId}`).map((r) => r.banner_id as number));
    const [since] = await tx`
      select count(*)::int as n from rolls where player_id = ${playerId} and set_id = ${setId}
        and id > coalesce((select max(id) from rolls where player_id = ${playerId} and set_id = ${setId}
                           and rarity in ('legendary', 'ultimate')), 0)`;
    let sinceHigh: number = since.n;
    const available = new Set(byRarity.keys());
    const results: RollResult[] = [];
    await tx`insert into ledger (player_id, kind, amount, ref, note)
             values (${playerId}, 'roll', ${-cost}, ${`set:${setId}`}, ${`${count === 1 ? "Roll" : "10 rolls"}: ${set.name}`})`;
    for (let i = 0; i < count; i++) {
      const pityHit = set.pity > 0 && sinceHigh + 1 >= set.pity && HIGH.some((r) => available.has(r));
      const rarity = pickRarity(set.rates, available, rnd, pityHit ? HIGH : undefined);
      const choices = byRarity.get(rarity)!;
      const banner = choices[rnd(choices.length)];
      const duplicate = owned.has(banner.id);
      const refund = duplicate ? Math.round(set.rollCost * DUPLICATE_REFUND[rarity]) : 0;
      if (duplicate) {
        if (refund) await tx`insert into ledger (player_id, kind, amount, ref, note)
                             values (${playerId}, 'refund', ${refund}, ${`banner:${banner.id}`}, ${`Duplicate: ${banner.name}`})`;
      } else {
        await tx`insert into owned_banners (player_id, banner_id, how) values (${playerId}, ${banner.id}, 'roll')`;
        owned.add(banner.id);
      }
      await tx`insert into rolls (player_id, set_id, banner_id, rarity, duplicate, refund, pity)
               values (${playerId}, ${setId}, ${banner.id}, ${rarity}, ${duplicate}, ${refund}, ${pityHit})`;
      sinceHigh = HIGH.includes(rarity) ? 0 : sinceHigh + 1;
      results.push({ bannerId: banner.id, name: banner.name, rarity, duplicate, refund, pity: pityHit });
    }
    return { results, balance: await balance(playerId, tx) };
  });
}

export async function pityCount(playerId: string, setId: number): Promise<number> {
  const [r] = await db()`
    select count(*)::int as n from rolls where player_id = ${playerId} and set_id = ${setId}
      and id > coalesce((select max(id) from rolls where player_id = ${playerId} and set_id = ${setId}
                         and rarity in ('legendary', 'ultimate')), 0)`;
  return r.n;
}

export function bannerPrice(b: { price: number | null; rarity: Rarity }): number {
  return b.price ?? RARITY_PRICE[b.rarity];
}

export async function buy(playerId: string, bannerId: number): Promise<number> {
  return db().begin(async (tx) => {
    await lock(tx, playerId);
    const [b] = await tx`
      select b.*, s.active as set_active, s.starts_at, s.ends_at from banners b
      left join banner_sets s on s.id = b.set_id where b.id = ${bannerId}`;
    if (!b || !b.active || !b.buyable) throw new ShopError("That banner isn't for sale.");
    if (b.set_id && !setOpen({ active: b.set_active, startsAt: b.starts_at, endsAt: b.ends_at } as BannerSet)) {
      throw new ShopError("That banner's set isn't in the shop right now.");
    }
    if ((await tx`select 1 from owned_banners where player_id = ${playerId} and banner_id = ${bannerId}`).length) {
      throw new ShopError("You already own it.");
    }
    const price = bannerPrice(b as unknown as { price: number | null; rarity: Rarity });
    if ((await balance(playerId, tx)) < price) throw new ShopError(`Not enough ${CURRENCY}: it costs ${price.toLocaleString("en-IE")}.`);
    await tx`insert into ledger (player_id, kind, amount, ref, note) values (${playerId}, 'purchase', ${-price}, ${`banner:${bannerId}`}, ${`Bought: ${b.name}`})`;
    await tx`insert into owned_banners (player_id, banner_id, how) values (${playerId}, ${bannerId}, 'buy')`;
    return balance(playerId, tx);
  });
}

export async function equip(playerId: string, bannerId: number | null): Promise<void> {
  if (bannerId !== null) {
    const [ok] = await db()`
      select 1 from banners b where b.id = ${bannerId} and (b.is_default
        or exists (select 1 from owned_banners o where o.player_id = ${playerId} and o.banner_id = b.id))`;
    if (!ok) throw new ShopError("You don't own that banner.");
  }
  await db()`update players set banner_id = ${bannerId} where id = ${playerId}`;
}

export async function redeem(playerId: string, raw: string, now = new Date()): Promise<string> {
  const code = raw.trim().toUpperCase();
  if (!code) throw new ShopError("Enter a code.");
  return db().begin(async (tx) => {
    await lock(tx, playerId);
    const [p] = await tx`select * from promo_codes where code = ${code} for update`;
    if (!p) throw new ShopError("That code doesn't exist.");
    if (p.expires_at && new Date(p.expires_at) <= now) throw new ShopError("That code has expired.");
    if ((await tx`select 1 from promo_redemptions where code = ${code} and player_id = ${playerId}`).length) {
      throw new ShopError("You've already used that code.");
    }
    if (p.max_uses) {
      const [{ n }] = await tx`select count(*)::int as n from promo_redemptions where code = ${code}`;
      if (n >= p.max_uses) throw new ShopError("That code has been used up.");
    }
    let message: string;
    if (p.reward === "coins") {
      await tx`insert into ledger (player_id, kind, amount, ref, note) values (${playerId}, 'promo', ${p.amount}, ${code}, ${`Code ${code}`})`;
      message = `${p.amount.toLocaleString("en-IE")} ${CURRENCY} added.`;
    } else {
      const [b] = await tx`select name from banners where id = ${p.banner_id}`;
      if ((await tx`select 1 from owned_banners where player_id = ${playerId} and banner_id = ${p.banner_id}`).length) {
        throw new ShopError(`You already own ${b?.name ?? "that banner"}, so the code is still unused.`);
      }
      await tx`insert into owned_banners (player_id, banner_id, how) values (${playerId}, ${p.banner_id}, 'promo')`;
      message = `${b?.name ?? "A banner"} added to your collection.`;
    }
    await tx`insert into promo_redemptions (code, player_id) values (${code}, ${playerId})`;
    return message;
  });
}
