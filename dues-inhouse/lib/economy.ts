/**
 * The club currency and what things cost. Change the numbers here; every page
 * reads them from this file.
 */
export const CURRENCY = "Crests";
export const CURRENCY_ONE = "Crest";

/** Paid once per finished game to every linked player in it. */
export const GAME_COINS = 600;
export const WIN_BONUS = 200;
export const DRAW_BONUS = 100;
/** Claimable once per day (Irish time). */
export const DAILY_COINS = 1000;

export const RARITIES = ["common", "rare", "epic", "legendary", "ultimate"] as const;
export type Rarity = (typeof RARITIES)[number];
export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary", ultimate: "Ultimate",
};
/** Default price to buy a banner outright, where an officer has made it buyable. */
export const RARITY_PRICE: Record<Rarity, number> = {
  common: 700, rare: 1400, epic: 2500, legendary: 5000, ultimate: 30000,
};
/** Share of the roll cost given back when a roll lands on a banner you already own. */
export const DUPLICATE_REFUND: Record<Rarity, number> = {
  common: 0.3, rare: 0.4, epic: 0.5, legendary: 0.8, ultimate: 1,
};
export const DEFAULT_RATES: Record<Rarity, number> = {
  common: 56, rare: 30, epic: 11, legendary: 2.5, ultimate: 0.5,
};

export function gameCoins(result: "win" | "loss" | "draw"): number {
  return GAME_COINS + (result === "win" ? WIN_BONUS : result === "draw" ? DRAW_BONUS : 0);
}

/** XP and levels: a game gives about 100 XP; level 10 takes roughly 40 games, level 20 about 160. */
export function gameXp(minutes: number, won: boolean): number {
  if (minutes < 4) return 0; // remakes and tests
  return 80 + Math.min(20, Math.floor(minutes / 3)) + (won ? 20 : 0);
}
export function levelFor(xp: number): number {
  return 1 + Math.floor(Math.sqrt(xp / 50));
}
/** Badge colour changes at these levels. */
export const LEVEL_TIERS = [1, 5, 10, 15, 25, 40];
export function levelTier(level: number): number {
  let t = 0;
  LEVEL_TIERS.forEach((min, i) => { if (level >= min) t = i; });
  return t;
}

export const formatCoins = (n: number) => n.toLocaleString("en-IE");
