/**
 * How strong a player is, for balancing teams only. Ratings on the leaderboard
 * all start level and move only with results; this also uses competitive rank,
 * so a new player's first teams are fair too.
 *
 * Each player's rank (mostly current, partly peak) and leaderboard rating are
 * both taken relative to the rest of the lobby, then blended: rank counts for
 * everything on someone's first night and less with every game they play, as
 * their leaderboard rating starts to say more (half each after WEEKLY_RANK_GAMES,
 * default 8).
 */

export const TIER_NAMES = ["", "", "", "Iron 1", "Iron 2", "Iron 3", "Bronze 1", "Bronze 2", "Bronze 3", "Silver 1", "Silver 2",
  "Silver 3", "Gold 1", "Gold 2", "Gold 3", "Platinum 1", "Platinum 2", "Platinum 3", "Diamond 1", "Diamond 2", "Diamond 3",
  "Ascendant 1", "Ascendant 2", "Ascendant 3", "Immortal 1", "Immortal 2", "Immortal 3", "Radiant"];

export const tierName = (t: number | null | undefined) => (t && TIER_NAMES[t]) || null;

/** One number from current and peak rank. Unranked this act: peak, a tier lower. Neither: null. */
export function rankTier(current: number | null | undefined, peak: number | null | undefined): number | null {
  const c = current && current >= 3 ? Math.min(27, current) : null;
  const p = peak && peak >= 3 ? Math.min(27, peak) : null;
  if (c && p) return 0.7 * c + 0.3 * Math.max(c, p);
  if (c) return c;
  if (p) return Math.max(3, p - 1);
  return null;
}

/** Rank on the rating scale: 24 points a tier, Gold 3 at 1,000. */
export const tierPoints = (t: number) => 1000 + (t - 14) * 24;

export const rankGames = () => {
  const k = Number(process.env.WEEKLY_RANK_GAMES ?? 8);
  return Number.isFinite(k) && k >= 0 ? k : 8;
};

export interface StrengthInput { player: string; rating: number; games: number; current: number | null; peak: number | null }
export interface Strength { strength: number; rank: string | null }

export function lobbyStrengths(lobby: StrengthInput[], k = rankGames()): Map<string, Strength> {
  const tiers = lobby.map((p) => rankTier(p.current, p.peak));
  const known = tiers.filter((t): t is number => t !== null).map(tierPoints);
  const meanRank = known.length ? known.reduce((s, x) => s + x, 0) / known.length : 1000;
  const meanRating = lobby.length ? lobby.reduce((s, p) => s + p.rating, 0) / lobby.length : 1000;
  return new Map(lobby.map((p, i) => {
    const rankRel = 1000 + (tiers[i] === null ? 0 : tierPoints(tiers[i]!) - meanRank);
    const ratingRel = 1000 + (p.rating - meanRating);
    const w = k === 0 ? 1 : p.games / (p.games + k);
    const label = tierName(p.current) ?? (tierName(p.peak) ? `peak ${tierName(p.peak)}` : null);
    return [p.player, { strength: Math.round((1 - w) * rankRel + w * ratingRel), rank: label }];
  }));
}
