/**
 * XP and levels, earned by playing in either game. Change the numbers here;
 * every page reads them from this file.
 */

/** A game gives about 100 XP; level 10 takes roughly 40 games, level 20 about 160. */
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
