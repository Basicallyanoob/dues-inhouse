/**
 * Everything the stats pages show, computed from the stored games: who each
 * player is, their records, heroes or agents, teammates and ratings. Cheap
 * enough to rebuild whenever games change; cached per server instance until
 * the data version moves.
 */
import { db, dataVersion } from "./db";
import { accountIndex, approvedAccounts } from "./accounts";
import { agentClasses, heroRoles, OW_ROLES, VAL_CLASSES, type OwRole, type ValClass } from "./games";
import { gameXp, levelFor } from "./levels";
import { mainHero, STAT_KEYS, total, type HeroStats, type OwPlayer, type StatKey } from "./ow/parse";
import { normaliseRiot, type ValLine } from "./val/match";
import { rateGames, type RatingBook } from "./ratings";
import { nightKey } from "./time";
import { slugify } from "./slug";

export { slugify };

// ---------- people ----------

export interface Person {
  key: string; // member uuid, or ow:<name> / val:<puuid> for someone not linked
  slug: string;
  name: string;
  memberId: string | null;
  avatarUrl: string | null;
  note: string | null;
  owNames: Set<string>;
  riotIds: Set<string>;
  linked: { overwatch: string[]; valorant: string[] }; // approved accounts, members only
  dues: boolean; // a DUES member: has the member role in Discord, or an officer said so
}

// ---------- Overwatch ----------

export interface OwMapRow {
  id: string;
  playedAt: Date;
  night: string;
  mapName: string;
  mapType: string;
  teamNames: [string, string];
  score: [number, number];
  complete: boolean;
  duration: number;
  players: (OwPlayer & { person: string; role: OwRole | null; main: string })[];
  firstKills: { 1: number; 2: number };
  winner: 0 | 1 | 2;
}

export interface OwAppearance { map: OwMapRow; team: 1 | 2; role: OwRole | null; hero: string; totals: HeroStats; ingame: string }

export interface OwPlayerSeason {
  person: Person;
  apps: OwAppearance[];
  heroes: Map<string, HeroStats & { maps: number; wins: number; rated: number }>;
  mates: Map<string, [number, number]>;
}

export interface OwSeason {
  maps: OwMapRow[];
  players: Map<string, OwPlayerSeason>;
  heroes: Map<string, { time: number; maps: number; wins: number; rated: number }>;
  book: RatingBook;
  unknownHeroes: Set<string>;
}

export function resultOf(winner: 0 | 1 | 2, team: 1 | 2, complete = true): "win" | "loss" | "draw" | "unfinished" {
  if (!complete) return "unfinished";
  return winner === 0 ? "draw" : winner === team ? "win" : "loss";
}

export function owRecord(p: OwPlayerSeason, role?: OwRole): [number, number, number] {
  const apps = p.apps.filter((a) => a.map.complete && (!role || a.role === role));
  const r = apps.map((a) => resultOf(a.map.winner, a.team));
  return [r.filter((x) => x === "win").length, r.filter((x) => x === "loss").length, r.filter((x) => x === "draw").length];
}

export function owTotal(p: OwPlayerSeason, key: StatKey, role?: OwRole): number {
  return p.apps.filter((a) => !role || a.role === role).reduce((s, a) => s + a.totals[key], 0);
}

export function owPer10(p: OwPlayerSeason, key: StatKey, role?: OwRole): number {
  const minutes = owTotal(p, "time_played", role) / 60;
  return minutes ? (owTotal(p, key, role) / minutes) * 10 : 0;
}

export function owRoleMaps(p: OwPlayerSeason): Record<OwRole, number> {
  const out = { tank: 0, damage: 0, support: 0 };
  for (const a of p.apps) if (a.role) out[a.role]++;
  return out;
}

export function owTopHeroes(p: OwPlayerSeason, n = 3): string[] {
  return [...p.heroes.entries()].sort((a, b) => b[1].time_played - a[1].time_played).slice(0, n).map(([h]) => h);
}

// ---------- Valorant ----------

export interface ValMatchRow {
  id: string;
  playedAt: Date;
  night: string;
  mapName: string;
  score: [number, number];
  rounds: number;
  lengthMs: number;
  source: string;
  players: (ValLine & { person: string; teamNo: 1 | 2 })[];
  winner: 0 | 1 | 2;
}

export const VAL_TOTAL_KEYS = ["rounds", "score", "kills", "deaths", "assists", "damage", "damage_rounds", "headshots", "shots", "first_bloods", "fb_rounds", "plants", "plant_games"] as const;
export type ValTotals = Record<(typeof VAL_TOTAL_KEYS)[number], number>;
export const blankTotals = (): ValTotals => Object.fromEntries(VAL_TOTAL_KEYS.map((k) => [k, 0])) as ValTotals;

export function addLine(t: ValTotals, p: ValLine, rounds: number) {
  t.rounds += rounds;
  t.score += p.score;
  t.kills += p.kills;
  t.deaths += p.deaths;
  t.assists += p.assists;
  if (p.damage !== null) { t.damage += p.damage; t.damage_rounds += rounds; }
  if (p.headshots !== null) { t.headshots += p.headshots; t.shots += p.headshots + (p.bodyshots ?? 0) + (p.legshots ?? 0); }
  if (p.first_bloods !== null) { t.first_bloods += p.first_bloods; t.fb_rounds += rounds; }
  if (p.plants != null) { t.plants += p.plants; t.plant_games += 1; }
}

export interface ValRates {
  acs: number | null;
  kd: number | null;
  kpr: number | null; // kills per round
  adr: number | null;
  hs: number | null;
  fbpr: number | null; // first bloods per round
  plants: number | null; // spike plants in total
}

export function valRates(t: ValTotals): ValRates {
  const r = t.rounds;
  return {
    acs: r ? t.score / r : null,
    kd: t.deaths ? t.kills / t.deaths : r ? t.kills : null,
    kpr: r ? t.kills / r : null,
    adr: t.damage_rounds ? t.damage / t.damage_rounds : null,
    hs: t.shots ? t.headshots / t.shots : null,
    fbpr: t.fb_rounds ? t.first_bloods / t.fb_rounds : null,
    plants: t.plant_games ? t.plants : null,
  };
}

export interface ValAppearance { map: ValMatchRow; line: ValMatchRow["players"][number] }

export interface ValPlayerSeason {
  person: Person;
  apps: ValAppearance[];
  totals: ValTotals;
  agents: Map<string, ValTotals & { maps: number; wins: number }>;
  mates: Map<string, [number, number]>;
}

export interface ValSeason {
  maps: ValMatchRow[];
  players: Map<string, ValPlayerSeason>;
  agents: Map<string, ValTotals & { maps: number; wins: number }>;
  book: RatingBook;
  unknownAgents: Set<string>;
}

export function valRecord(p: ValPlayerSeason): [number, number, number] {
  const r = p.apps.map((a) => resultOf(a.map.winner, a.line.teamNo));
  return [r.filter((x) => x === "win").length, r.filter((x) => x === "loss").length, r.filter((x) => x === "draw").length];
}

export function valTopAgents(p: ValPlayerSeason, n = 3): string[] {
  return [...p.agents.entries()].sort((a, b) => b[1].maps - a[1].maps || b[1].rounds - a[1].rounds).slice(0, n).map(([a]) => a);
}

export function valClassMaps(p: ValPlayerSeason): Record<ValClass, number> {
  const out = { duelist: 0, initiator: 0, controller: 0, sentinel: 0 };
  const classes = agentClasses();
  for (const a of p.apps) {
    const c = classes.get(a.line.agent);
    if (c) out[c]++;
  }
  return out;
}

export function valMainClass(p: ValPlayerSeason): ValClass | null {
  const counts = valClassMaps(p);
  const best = VAL_CLASSES.reduce((a, b) => (counts[b] > counts[a] ? b : a));
  return counts[best] ? best : null;
}

// ---------- the whole site ----------

export interface Site {
  version: string;
  people: Map<string, Person>; // key -> person
  bySlug: Map<string, Person>;
  ow: OwSeason;
  val: ValSeason;
  xp: Map<string, number>; // person key -> XP from games in both
}

export const level = (site: Site, key: string) => levelFor(site.xp.get(key) ?? 0);

let cache: { version: string; site: Promise<Site> } | null = null;

export async function getSite(): Promise<Site> {
  const version = await dataVersion();
  if (!cache || cache.version !== version) cache = { version, site: build(version) };
  try {
    return await cache.site;
  } catch (e) {
    cache = null;
    throw e;
  }
}

async function build(version: string): Promise<Site> {
  const sql = db();
  const [members, accounts, owRows, valRows] = await Promise.all([
    sql`select id, display_name, slug, avatar_url, note, coalesce(dues_override, dues_role) as dues from players`,
    approvedAccounts(sql),
    sql`select * from ow_maps order by played_at, id`,
    sql`select * from val_matches order by played_at, id`,
  ]);
  const index = accountIndex(accounts);
  const people = new Map<string, Person>();
  const taken = new Set<string>();
  for (const m of members) {
    people.set(m.id, { key: m.id, slug: m.slug, name: m.display_name, memberId: m.id, avatarUrl: m.avatar_url,
      note: m.note, owNames: new Set(), riotIds: new Set(), linked: { overwatch: [], valorant: [] }, dues: Boolean(m.dues) });
    taken.add(m.slug);
  }
  for (const a of accounts) people.get(a.playerId)?.linked[a.game].push(a.account);
  const takenNames = new Set(members.map((m) => (m.display_name as string).toLowerCase()));
  const guest = (key: string, name: string): Person => {
    let p = people.get(key);
    if (p) return p;
    let slug = slugify(name);
    while (taken.has(slug)) slug += "-x";
    taken.add(slug);
    p = { key, slug, name, memberId: null, avatarUrl: null, note: null, owNames: new Set(), riotIds: new Set(),
      linked: { overwatch: [], valorant: [] }, dues: false };
    people.set(key, p);
    return p;
  };

  // Overwatch
  const roles = heroRoles();
  const unknownHeroes = new Set<string>();
  const owMaps: OwMapRow[] = owRows.map((r) => {
    const playedAt = new Date(r.played_at);
    const night = nightKey(playedAt);
    const score: [number, number] = [r.score1, r.score2];
    const players = (r.data.players as OwPlayer[]).map((p) => {
      const member = index.ow(p.name);
      const person = member && people.has(member) ? people.get(member)! : guest(`ow:${p.name.toLowerCase()}`, p.name);
      person.owNames.add(p.name);
      const main = mainHero(p);
      for (const h of Object.keys(p.heroes)) if (!roles.get(h)) unknownHeroes.add(h);
      return { ...p, person: person.key, role: roles.on(main, night) ?? null, main };
    });
    return { id: r.id, playedAt, night, mapName: r.map_name, mapType: r.map_type, teamNames: [r.team1, r.team2],
      score, complete: r.complete, duration: r.duration, players, firstKills: r.data.firstKills ?? { 1: 0, 2: 0 },
      winner: score[0] === score[1] ? 0 : score[0] > score[1] ? 1 : 2 } as OwMapRow;
  });
  const owPlayers = new Map<string, OwPlayerSeason>();
  const owHeroes = new Map<string, { time: number; maps: number; wins: number; rated: number }>();
  for (const m of owMaps) {
    for (const p of m.players) {
      let ps = owPlayers.get(p.person);
      if (!ps) owPlayers.set(p.person, (ps = { person: people.get(p.person)!, apps: [], heroes: new Map(), mates: new Map() }));
      const totals = Object.fromEntries(STAT_KEYS.map((k) => [k, total(p, k)])) as HeroStats;
      const app: OwAppearance = { map: m, team: p.team, role: p.role, hero: p.main, totals, ingame: p.name };
      ps.apps.push(app);
      const result = resultOf(m.winner, p.team, m.complete);
      for (const [hero, s] of Object.entries(p.heroes)) {
        let h = ps.heroes.get(hero);
        if (!h) ps.heroes.set(hero, (h = { ...(Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as HeroStats), maps: 0, wins: 0, rated: 0 }));
        for (const k of STAT_KEYS) h[k] += s[k];
        h.maps++;
        if (m.complete) { h.rated++; if (result === "win") h.wins++; }
        let g = owHeroes.get(hero);
        if (!g) owHeroes.set(hero, (g = { time: 0, maps: 0, wins: 0, rated: 0 }));
        g.time += s.time_played;
        if (hero === p.main) {
          g.maps++;
          if (m.complete) { g.rated++; if (result === "win") g.wins++; }
        }
      }
    }
    if (m.complete) for (const team of [1, 2] as const) {
      const ids = m.players.filter((p) => p.team === team).map((p) => p.person);
      for (const a of ids) for (const b of ids) if (a !== b) {
        const rec = owPlayers.get(a)!.mates.get(b) ?? [0, 0];
        rec[0]++;
        if (m.winner === team) rec[1]++;
        owPlayers.get(a)!.mates.set(b, rec);
      }
    }
  }
  const owBook = rateGames(owMaps.filter((m) => m.complete).map((m) => ({
    id: m.id, winner: m.winner,
    team1: m.players.filter((p) => p.team === 1).map((p) => [p.person, p.role] as [string, string | null]),
    team2: m.players.filter((p) => p.team === 2).map((p) => [p.person, p.role] as [string, string | null]),
  })));

  // Valorant: members by account; others by account id, shown under their latest Riot name.
  const classes = agentClasses();
  const latestName = new Map<string, ValLine>();
  for (const r of valRows) for (const p of r.data.players as ValLine[]) latestName.set(p.puuid, p);
  // Typed-in scoreboards have no account id: join them to an API player with the same Riot ID.
  const riotToId = new Map<string, string>();
  for (const [id, p] of latestName) if (!id.startsWith("manual:")) {
    riotToId.set(normaliseRiot(`${p.name}#${p.tag}`), id);
    if (!riotToId.has(normaliseRiot(p.name))) riotToId.set(normaliseRiot(p.name), id);
  }
  const canonical = (p: ValLine) => p.puuid.startsWith("manual:")
    ? riotToId.get(normaliseRiot(`${p.name}#${p.tag}`)) ?? riotToId.get(normaliseRiot(p.name)) ?? p.puuid
    : p.puuid;
  const shownName = new Map<string, string>();
  const valPerson = (p: ValLine): Person => {
    const cid = canonical(p);
    const latest = latestName.get(cid) ?? p;
    const member = index.val(cid, latest.name, latest.tag) ?? index.val(p.puuid, p.name, p.tag);
    if (member && people.has(member)) return people.get(member)!;
    if (!shownName.has(cid)) {
      let name = latest.name;
      const clash = [...shownName.entries()].some(([other, n]) => other !== cid && n.toLowerCase() === name.toLowerCase());
      if (clash || takenNames.has(name.toLowerCase())) name = latest.tag ? `${latest.name}#${latest.tag}` : latest.name;
      shownName.set(cid, name);
    }
    return guest(`val:${cid}`, shownName.get(cid)!);
  };
  const unknownAgents = new Set<string>();
  const valMaps: ValMatchRow[] = valRows.map((r) => {
    const playedAt = new Date(r.played_at);
    const score: [number, number] = [r.score_blue, r.score_red];
    const players = (r.data.players as ValLine[]).map((p) => {
      const person = valPerson(p);
      person.riotIds.add(p.tag ? `${p.name}#${p.tag}` : p.name);
      if (!classes.has(p.agent)) unknownAgents.add(p.agent);
      return { ...p, person: person.key, teamNo: (p.team === "Blue" ? 1 : 2) as 1 | 2 };
    });
    return { id: r.id, playedAt, night: nightKey(playedAt), mapName: r.map_name, score, rounds: score[0] + score[1],
      lengthMs: r.length_ms, source: r.source, players, winner: score[0] === score[1] ? 0 : score[0] > score[1] ? 1 : 2 } as ValMatchRow;
  });
  const valPlayers = new Map<string, ValPlayerSeason>();
  const valAgents = new Map<string, ValTotals & { maps: number; wins: number }>();
  for (const m of valMaps) {
    for (const p of m.players) {
      let ps = valPlayers.get(p.person);
      if (!ps) valPlayers.set(p.person, (ps = { person: people.get(p.person)!, apps: [], totals: blankTotals(), agents: new Map(), mates: new Map() }));
      ps.apps.push({ map: m, line: p });
      addLine(ps.totals, p, m.rounds);
      const won = m.winner === p.teamNo;
      for (const table of [ps.agents, valAgents]) {
        let a = table.get(p.agent);
        if (!a) table.set(p.agent, (a = { ...blankTotals(), maps: 0, wins: 0 }));
        addLine(a, p, m.rounds);
        a.maps++;
        if (won) a.wins++;
      }
    }
    for (const team of [1, 2] as const) {
      const ids = m.players.filter((p) => p.teamNo === team).map((p) => p.person);
      for (const a of ids) for (const b of ids) if (a !== b) {
        const rec = valPlayers.get(a)!.mates.get(b) ?? [0, 0];
        rec[0]++;
        if (m.winner === team) rec[1]++;
        valPlayers.get(a)!.mates.set(b, rec);
      }
    }
  }
  const valBook = rateGames(valMaps.map((m) => ({
    id: m.id, winner: m.winner, score: m.score,
    team1: m.players.filter((p) => p.teamNo === 1).map((p) => [p.person, null] as [string, null]),
    team2: m.players.filter((p) => p.teamNo === 2).map((p) => [p.person, null] as [string, null]),
    perf: m.rounds ? m.players.map((p) => ({
      player: p.person, acs: p.score / m.rounds, kd: p.kills / Math.max(1, p.deaths),
      adr: p.damage === null ? null : p.damage / m.rounds,
    })) : undefined,
  })));

  // XP from both games
  const xp = new Map<string, number>();
  for (const m of owMaps) if (m.complete) for (const p of m.players) {
    xp.set(p.person, (xp.get(p.person) ?? 0) + gameXp(m.duration / 60, m.winner === p.team));
  }
  for (const m of valMaps) for (const p of m.players) {
    xp.set(p.person, (xp.get(p.person) ?? 0) + gameXp(m.lengthMs / 60000 || m.rounds * 1.7, m.winner === p.teamNo));
  }

  const bySlug = new Map([...people.values()].map((p) => [p.slug, p]));
  return {
    version, people, bySlug, xp,
    ow: { maps: owMaps, players: owPlayers, heroes: owHeroes, book: owBook, unknownHeroes },
    val: { maps: valMaps, players: valPlayers, agents: valAgents, book: valBook, unknownAgents },
  };
}

export { OW_ROLES };
