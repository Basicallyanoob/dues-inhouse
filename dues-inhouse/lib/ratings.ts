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
const fresh = (): Rating => ({ mu: MU, sigma: SIGMA, maps: 0 });

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

/** Rate games in order. winner: 1, 2, or 0 for a draw. */
export function rateGames(games: Iterable<{ id: string; winner: 0 | 1 | 2; team1: Lineup; team2: Lineup }>): RatingBook {
  const book = new RatingBook();
  const update = (table: Map<string, Rating>, key: (p: string, r: string | null) => string, t1: Lineup, t2: Lineup, w: 0 | 1 | 2) => {
    const teams = [t1, t2].map((t) => t.map(([p, r]) => table.get(key(p, r)) ?? fresh()));
    const rank = w === 0 ? [1, 1] : w === 1 ? [1, 2] : [2, 1];
    const rated = rate(teams.map((t) => t.map((x) => ({ mu: x.mu, sigma: x.sigma }))), { rank, tau: TAU, mu: MU, sigma: SIGMA, beta: BETA });
    [t1, t2].forEach((t, ti) => t.forEach(([p, r], i) => {
      table.set(key(p, r), { mu: rated[ti][i].mu, sigma: rated[ti][i].sigma, maps: teams[ti][i].maps + 1 });
    }));
  };
  for (const g of games) {
    const all = [...g.team1, ...g.team2];
    const before = new Map(all.map(([p]) => [p, display(book.get(p).mu)]));
    const pair = (p: string): [number, number] => [book.get(p).mu, book.get(p).sigma];
    book.predictions.set(g.id, winProbability(g.team1.map(([p]) => pair(p)), g.team2.map(([p]) => pair(p))));
    update(book.overall, (p) => p, g.team1, g.team2, g.winner);
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
