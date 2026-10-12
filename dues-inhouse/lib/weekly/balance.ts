/**
 * Splits a lobby into the most even two teams by rating. Later games in a night
 * avoid repeating an earlier split: a split costs its rating gap plus a penalty
 * for how much it looks like a game already played, so the bot suggests a
 * different, still even, 5v5 each time.
 */

export interface Split { a: string[]; b: string[]; avgA: number; avgB: number; gap: number; repeat: number }

/** Display points a fully repeated split costs; partial repeats cost less. */
export const REPEAT_COST = 30;

const avg = (xs: string[], r: (p: string) => number) => (xs.length ? xs.reduce((s, p) => s + r(p), 0) / xs.length : 0);

/** How alike two splits are, 0 (as different as possible) to 1 (the same teams). */
export function similarity(a: string[], b: string[], prevA: string[], prevB: string[]): number {
  const A = new Set(a), B = new Set(b), pA = new Set(prevA), pB = new Set(prevB);
  const both = [...A, ...B].filter((p) => pA.has(p) || pB.has(p));
  if (both.length < 2) return 0;
  const same = both.filter((p) => (A.has(p) && pA.has(p)) || (B.has(p) && pB.has(p))).length;
  const together = Math.max(same, both.length - same) / both.length; // 0.5 .. 1, either side naming
  return (together - 0.5) * 2;
}

export function balanceTeams(players: string[], rating: (p: string) => number, previous: [string[], string[]][] = [],
  random: () => number = Math.random): Split {
  const n = players.length;
  if (n < 2) throw new Error("need at least two players");
  const size = Math.floor(n / 2);
  const splits: Split[] = [];
  // Even lobbies: fix the first player on team A, so mirror images aren't counted twice.
  const pool = n % 2 === 0 ? players.slice(1) : players;
  const need = n % 2 === 0 ? size - 1 : size;
  const pick = (start: number, chosen: string[]) => {
    if (chosen.length === need) {
      const a = n % 2 === 0 ? [players[0], ...chosen] : chosen;
      const b = players.filter((p) => !a.includes(p));
      const avgA = avg(a, rating), avgB = avg(b, rating);
      const repeat = Math.max(0, ...previous.map(([pa, pb]) => similarity(a, b, pa, pb)));
      splits.push({ a, b, avgA, avgB, gap: Math.abs(avgA - avgB), repeat });
      return;
    }
    for (let i = start; i <= pool.length - (need - chosen.length); i++) pick(i + 1, [...chosen, pool[i]]);
  };
  pick(0, []);
  const cost = (s: Split) => s.gap + REPEAT_COST * s.repeat ** 2;
  const best = Math.min(...splits.map(cost));
  const ties = splits.filter((s) => cost(s) - best < 1e-9);
  const out = ties[Math.floor(random() * ties.length)];
  // Team A is the side with the higher average, for a stable "A vs B" line.
  return out.avgA >= out.avgB ? out : { a: out.b, b: out.a, avgA: out.avgB, avgB: out.avgA, gap: out.gap, repeat: out.repeat };
}

/** Who plays the next game when more than `size` signed up: those who sat out most, then earliest sign-up. */
export function chooseLineup(signups: { player: string; sat: number; order: number }[], size = 10): { playing: string[]; resting: string[] } {
  const sorted = [...signups].sort((x, y) => y.sat - x.sat || x.order - y.order);
  return { playing: sorted.slice(0, size).map((s) => s.player), resting: sorted.slice(size).map((s) => s.player) };
}
