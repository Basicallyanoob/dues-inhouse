/**
 * Skill ratings from inhouse results: Plackett-Luce (openskill), as in the
 * Python version. mu is the estimate, sigma the uncertainty; pages show mu on
 * a scale where an average player is 1,000.
 */
import { rate } from "openskill";

export const MU = 25;
export const SIGMA = 25 / 3;
export const BETA = MU / 6;
const TAU = MU / 300;

export const display = (mu: number) => Math.round(1000 + 40 * (mu - MU));

export interface Rating { mu: number; sigma: number; maps: number }
// Everyone starts level: competitive rank is only used to balance teams (lib/weekly/strength.ts).
const fresh = (): Rating => ({ mu: MU, sigma: SIGMA, maps: 0 });

const setting = (name: string, fallback: number, max: number) => {
  const w = Number(process.env[name] ?? fallback);
  return Number.isFinite(w) ? Math.min(max, Math.max(0, w)) : fallback;
};

/** How much performance can move a Valorant rating change, either way (0.3 = up to 30%). */
export const perfWeight = () => setting("VAL_PERF_WEIGHT", 0.3, 1);

/** How much the round margin can shrink a close game's changes, or grow a stomp's (0.2: 0.8x to 1.4x). */
export const marginWeight = () => setting("VAL_MARGIN_WEIGHT", 0.2, 0.5);

/**
 * A game's changes scaled by how one-sided it was. m is the round difference
 * over rounds played: 13-11 is 0.08, 13-7 is 0.3 (an ordinary game, left as
 * it is), 13-3 is 0.63, 13-0 is 1. With weight 0.2, 13-11 moves ratings 0.86x,
 * 13-3 1.22x, and the factor stays between 1 - weight and 1 + 2 x weight.
 */
export function marginFactor(score: [number, number] | undefined, weight: number): number {
  if (!score || !weight) return 1;
  const total = score[0] + score[1];
  if (!total || score[0] === score[1]) return 1;
  const m = Math.abs(score[0] - score[1]) / total;
  return Math.min(1 + 2 * weight, Math.max(1 - weight, 1 + (weight * (m - 0.3)) / 0.3));
}

export interface PerfLine { player: string; acs: number; kd: number; adr: number | null }
export interface Perf { score: number; p: number; rank: number; of: number }

/**
 * Each player's performance against the rest of the lobby: mostly ACS, plus
 * K/D and ADR, as z-scores within the game, so short and long games and strong
 * and weak lobbies compare fairly. p is the same score squeezed into -1..1.
 */
export function lobbyPerformance(lines: PerfLine[]): Map<string, Perf> {
  const z = (xs: number[]) => {
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    return xs.map((x) => (sd > 1e-9 ? (x - mean) / sd : 0));
  };
  const hasAdr = lines.length > 0 && lines.every((l) => l.adr !== null);
  const acs = z(lines.map((l) => l.acs));
  const kd = z(lines.map((l) => l.kd));
  const adr = hasAdr ? z(lines.map((l) => l.adr!)) : null;
  const scores = lines.map((_, i) => (adr ? 0.6 * acs[i] + 0.2 * kd[i] + 0.2 * adr[i] : 0.75 * acs[i] + 0.25 * kd[i]));
  const order = scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  const out = new Map<string, Perf>();
  order.forEach((i, rank) => out.set(lines[i].player, {
    score: scores[i], p: Math.max(-1, Math.min(1, scores[i] / 1.5)), rank: rank + 1, of: lines.length,
  }));
  return out;
}

/**
 * Winning or losing decides the direction; performance decides the amount.
 * Each player's change is scaled by up to ±weight: the best on a losing team
 * loses less, the best on a winning team gains more. Performance is centred
 * within the team (weighted by each player's change), so the team's total
 * change is exactly what the result alone gave: rating moves between
 * teammates, never inflates. A factor between 1 - weight and 1 + weight can't
 * flip a change's sign.
 */
export function adjustForPerformance(changes: number[], perf: number[], weight: number): number[] {
  const w = changes.map(Math.abs);
  const total = w.reduce((s, x) => s + x, 0);
  const sign = Math.sign(changes.reduce((s, x) => s + x, 0));
  if (!weight || !total || !sign || changes.some((c) => c && Math.sign(c) !== sign)) return changes;
  const centre = perf.reduce((s, p, i) => s + p * w[i], 0) / total;
  let q = perf.map((p) => p - centre);
  const widest = Math.max(...q.map(Math.abs));
  if (widest > 1) q = q.map((x) => x / widest);
  return changes.map((c, i) => c * (1 + weight * q[i] * sign));
}

function erf(x: number): number {
  // Abramowitz and Stegun 7.1.26
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

/** P(team A beats team B) from [mu, sigma] pairs. */
export function winProbability(a: [number, number][], b: [number, number][]): number {
  const muA = a.reduce((s, r) => s + r[0], 0);
  const muB = b.reduce((s, r) => s + r[0], 0);
  const v = 2 * BETA ** 2 + a.reduce((s, r) => s + r[1] ** 2, 0) + b.reduce((s, r) => s + r[1] ** 2, 0);
  return 0.5 * (1 + erf((muA - muB) / Math.sqrt(2 * v)));
}

export class RatingBook {
  overall = new Map<string, Rating>();
  byRole = new Map<string, Rating>(); // `${player}\u0000${role}`
  history = new Map<string, [string, number][]>(); // player -> [game id, display rating after]
  deltas = new Map<string, Map<string, number>>(); // game id -> player -> change
  predictions = new Map<string, number>(); // game id -> P(team 1 wins), before the game
  perf = new Map<string, Map<string, Perf>>(); // game id -> player -> performance in that lobby

  get(player: string, role?: string): Rating {
    return (role ? this.byRole.get(`${player}\u0000${role}`) : this.overall.get(player)) ?? fresh();
  }
  has(player: string, role?: string): boolean {
    return role ? this.byRole.has(`${player}\u0000${role}`) : this.overall.has(player);
  }
  value(player: string): number | null {
    return this.overall.has(player) ? display(this.overall.get(player)!.mu) : null;
  }
}

export type Lineup = [string, string | null][]; // [player, role or null]

export interface RatedGame {
  id: string;
  winner: 0 | 1 | 2;
  team1: Lineup;
  team2: Lineup;
  /** Valorant: each player's stats, to scale their overall change by performance. */
  perf?: PerfLine[];
  /** Valorant: rounds won by team 1 and team 2, to scale the game's changes by how close it was. */
  score?: [number, number];
}

/**
 * Rate games in order. winner: 1, 2, or 0 for a draw. In Valorant, openskill
 * sets each change from the result and how strong the teams were; the round
 * margin then scales the whole game's changes, and performance shares each
 * team's change out between its players.
 */
export function rateGames(games: Iterable<RatedGame>, weight = perfWeight(), margin = marginWeight()): RatingBook {
  const book = new RatingBook();
  const update = (table: Map<string, Rating>, key: (p: string, r: string | null) => string, t1: Lineup, t2: Lineup, w: 0 | 1 | 2,
    perf?: Map<string, Perf>, score?: [number, number]) => {
    const teams = [t1, t2].map((t) => t.map(([p, r]) => table.get(key(p, r)) ?? fresh()));
    const rank = w === 0 ? [1, 1] : w === 1 ? [1, 2] : [2, 1];
    const rated = rate(teams.map((t) => t.map((x) => ({ mu: x.mu, sigma: x.sigma }))), { rank, tau: TAU, mu: MU, sigma: SIGMA, beta: BETA });
    const factor = w === 0 ? 1 : marginFactor(score, margin);
    [t1, t2].forEach((t, ti) => {
      let changes = rated[ti].map((x, i) => (x.mu - teams[ti][i].mu) * factor);
      if (perf && w !== 0) changes = adjustForPerformance(changes, t.map(([p]) => perf.get(p)?.p ?? 0), weight);
      const mus = changes.map((c, i) => teams[ti][i].mu + c);
      t.forEach(([p, r], i) => table.set(key(p, r), { mu: mus[i], sigma: rated[ti][i].sigma, maps: teams[ti][i].maps + 1 }));
    });
  };
  for (const g of games) {
    const all = [...g.team1, ...g.team2];
    const before = new Map(all.map(([p]) => [p, display(book.get(p).mu)]));
    const pair = (p: string): [number, number] => [book.get(p).mu, book.get(p).sigma];
    book.predictions.set(g.id, winProbability(g.team1.map(([p]) => pair(p)), g.team2.map(([p]) => pair(p))));
    const perf = g.perf?.length ? lobbyPerformance(g.perf) : undefined;
    if (perf) book.perf.set(g.id, perf);
    update(book.overall, (p) => p, g.team1, g.team2, g.winner, perf, g.score);
    if (all.every(([, r]) => r)) update(book.byRole, (p, r) => `${p}\u0000${r}`, g.team1, g.team2, g.winner);
    const d = new Map<string, number>();
    for (const [p] of all) {
      const after = display(book.get(p).mu);
      d.set(p, after - before.get(p)!);
      const h = book.history.get(p) ?? [];
      h.push([g.id, after]);
      book.history.set(p, h);
    }
    book.deltas.set(g.id, d);
  }
  return book;
}
