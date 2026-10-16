/** Shapes the season into what each page shows. */
import { agentClasses, CLASS_LABEL, heroRoles, OW_ROLES, VAL_CLASSES, type OwRole, type ValClass } from "./games";
import { display } from "./ratings";
import {
  addLine, blankTotals, level, owPer10, owRecord, owRoleMaps, owTopHeroes, owTotal, resultOf, valClassMaps,
  valMainClass, valRates, valRecord, valTopAgents, type OwMapRow, type OwPlayerSeason, type Person, type Site,
  type ValMatchRow, type ValPlayerSeason, type ValRates,
} from "./season";
import { shortDay } from "./time";

export const UPSET = 0.35;
/** Games before someone gets a rank number. Fewer, and they show on the ladder as provisional. */
export const MIN_MAPS = Number(process.env.MIN_GAMES_RANKED ?? 3);

export const recordText = ([w, l, d]: [number, number, number]) => `${w}–${l}${d ? `–${d}` : ""}`;

function latestNightChange(history: [string, number][] | undefined, nightOf: (id: string) => string, last: string | undefined) {
  if (!history || !last) return null;
  const tonight = history.filter(([id]) => nightOf(id) === last).map(([, v]) => v);
  const earlier = history.filter(([id]) => nightOf(id) !== last).map(([, v]) => v);
  if (!tonight.length) return null;
  return tonight[tonight.length - 1] - (earlier.length ? earlier[earlier.length - 1] : 1000);
}

// ---------- Overwatch ----------

export interface OwBoardRow {
  person: Person;
  rating: number;
  change: number | null;
  maps: number;
  record: string;
  winrate: number;
  per10: { eliminations: number; deaths: number; hero_damage: number; healing: number };
  heroes: string[];
  level: number;
}

export function owBoard(site: Site, role: OwRole | null) {
  const { ow } = site;
  const nights = [...new Set(ow.maps.filter((m) => m.complete).map((m) => m.night))].sort();
  const nightOf = new Map(ow.maps.map((m) => [m.id, m.night]));
  const roles = heroRoles();
  const rows: OwBoardRow[] = [];
  const unranked: OwBoardRow[] = [];
  for (const p of ow.players.values()) {
    if (!ow.book.has(p.person.key, role ?? undefined)) continue;
    const rec = owRecord(p, role ?? undefined);
    const games = rec[0] + rec[1] + rec[2];
    const row: OwBoardRow = {
      person: p.person, rating: display(ow.book.get(p.person.key, role ?? undefined).mu),
      change: role ? null : latestNightChange(ow.book.history.get(p.person.key), (id) => nightOf.get(id)!, nights.at(-1)),
      maps: games, record: recordText(rec), winrate: games ? rec[0] / games : 0,
      per10: {
        eliminations: owPer10(p, "eliminations", role ?? undefined), deaths: owPer10(p, "deaths", role ?? undefined),
        hero_damage: owPer10(p, "hero_damage", role ?? undefined), healing: owPer10(p, "healing", role ?? undefined),
      },
      heroes: owTopHeroes(p, 6).filter((h) => !role || roles.get(h) === role).slice(0, 3),
      level: level(site, p.person.key),
    };
    (games >= MIN_MAPS ? rows : unranked).push(row);
  }
  rows.sort((a, b) => b.rating - a.rating || a.person.name.localeCompare(b.person.name));
  unranked.sort((a, b) => b.rating - a.rating || a.person.name.localeCompare(b.person.name));
  return { role, rows, unranked };
}

export function owMatchView(site: Site, m: OwMapRow) {
  const deltas = site.ow.book.deltas.get(m.id);
  const pred = site.ow.book.predictions.get(m.id) ?? null;
  const order: Record<string, number> = { tank: 0, damage: 1, support: 2 };
  const teams = ([1, 2] as const).map((t) => ({
    no: t, name: m.teamNames[t - 1], won: m.complete && m.winner === t,
    rows: m.players.filter((p) => p.team === t).map((p) => ({
      person: site.people.get(p.person)!, ingame: p.name, role: p.role,
      heroes: Object.entries(p.heroes).sort((a, b) => b[1].time_played - a[1].time_played).map(([h]) => h),
      stats: Object.fromEntries((["eliminations", "final_blows", "deaths", "hero_damage", "healing", "damage_blocked"] as const)
        .map((k) => [k, Object.values(p.heroes).reduce((s, h) => s + h[k], 0)])) as Record<string, number>,
      delta: deltas?.get(p.person) ?? null,
    })).sort((a, b) => (order[a.role ?? ""] ?? 9) - (order[b.role ?? ""] ?? 9) || b.stats.eliminations - a.stats.eliminations),
  }));
  const upset = pred !== null && m.winner !== 0 && (m.winner === 1 ? pred : 1 - pred) < UPSET;
  return { map: m, teams, prediction: pred, upset };
}

export function owPlayerView(site: Site, p: OwPlayerSeason) {
  const { ow } = site;
  const mapById = new Map(ow.maps.map((m) => [m.id, m]));
  const hist = ow.book.history.get(p.person.key) ?? [];
  const roles = OW_ROLES.filter((r) => ow.book.has(p.person.key, r)).map((r) => {
    const rec = owRecord(p, r);
    return { role: r, rating: display(ow.book.get(p.person.key, r).mu), record: recordText(rec), maps: rec[0] + rec[1] + rec[2] };
  });
  const heroRoleMap = heroRoles();
  const heroes = [...p.heroes.entries()].sort((a, b) => b[1].time_played - a[1].time_played).map(([hero, h]) => {
    const mins = h.time_played / 60;
    return {
      hero, role: heroRoleMap.get(hero) ?? null, time: h.time_played, maps: h.maps,
      winrate: h.rated ? h.wins / h.rated : null,
      per10: Object.fromEntries((["eliminations", "deaths", "hero_damage", "healing"] as const).map((k) => [k, mins ? (h[k] / mins) * 10 : 0])),
    };
  });
  const rec = owRecord(p);
  const games = rec[0] + rec[1] + rec[2];
  return {
    rating: ow.book.value(p.person.key), record: recordText(rec), maps: games, winrate: games ? rec[0] / games : 0,
    chart: hist.map(([id, v]) => ({ id, v, label: shortDay(mapById.get(id)!.playedAt) })),
    roles, heroes, mates: mates(site, p.mates),
    recent: [...p.apps].reverse().map((a) => ({ a, result: resultOf(a.map.winner, a.team, a.map.complete), delta: ow.book.deltas.get(a.map.id)?.get(p.person.key) ?? null })),
    per10: { eliminations: owPer10(p, "eliminations"), deaths: owPer10(p, "deaths"), hero_damage: owPer10(p, "hero_damage"), healing: owPer10(p, "healing") },
    roleMaps: owRoleMaps(p), timePlayed: owTotal(p, "time_played"),
  };
}

export function heroView(site: Site) {
  const roles = heroRoles();
  const totalTime = [...site.ow.heroes.values()].reduce((s, h) => s + h.time, 0) || 1;
  const groups = new Map<string, { hero: string; share: number; maps: number; winrate: number | null; rated: number; top: Person }[]>();
  for (const [hero, h] of site.ow.heroes) {
    const top = [...site.ow.players.values()].reduce((best, p) =>
      (p.heroes.get(hero)?.time_played ?? 0) > (best.heroes.get(hero)?.time_played ?? 0) ? p : best);
    const key = roles.get(hero) ?? "unknown";
    groups.set(key, [...(groups.get(key) ?? []), { hero, share: h.time / totalTime, maps: h.maps, winrate: h.rated ? h.wins / h.rated : null, rated: h.rated, top: top.person }]);
  }
  for (const rows of groups.values()) rows.sort((a, b) => b.share - a.share);
  return [...OW_ROLES, "unknown"].filter((r) => groups.has(r)).map((r) => ({ role: r, rows: groups.get(r)! }));
}

export function owBuilderData(site: Site) {
  const { ow } = site;
  const out = [...ow.players.values()].map((p) => {
    const key = p.person.key;
    const counts = owRoleMaps(p);
    const usual = OW_ROLES.filter((r) => counts[r]).sort((a, b) => counts[b] - counts[a]);
    const o = ow.book.get(key);
    return {
      name: p.person.name, rating: ow.book.value(key), overall: [o.mu, o.sigma],
      roles: Object.fromEntries(OW_ROLES.filter((r) => ow.book.has(key, r)).map((r) => [r, [ow.book.get(key, r).mu, ow.book.get(key, r).sigma]])),
      usual: usual.length ? usual : [...OW_ROLES],
    };
  });
  // Members with a linked BattleTag who haven't played yet can still be picked.
  for (const person of site.people.values()) {
    if (person.linked.overwatch.length && !ow.players.has(person.key)) {
      out.push({ name: person.name, rating: null, overall: [25, 25 / 3], roles: {}, usual: [...OW_ROLES] });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Valorant ----------

export interface ValBoardRow {
  person: Person;
  rating: number;
  change: number | null;
  maps: number;
  record: string;
  winrate: number;
  r: ValRates;
  agents: string[];
  cls: ValClass | null;
  level: number;
}

export function valBoard(site: Site) {
  const { val } = site;
  const nights = [...new Set(val.maps.map((m) => m.night))].sort();
  const nightOf = new Map(val.maps.map((m) => [m.id, m.night]));
  const rows: ValBoardRow[] = [];
  const unranked: ValBoardRow[] = [];
  for (const p of val.players.values()) {
    const rec = valRecord(p);
    const games = rec[0] + rec[1] + rec[2];
    const row: ValBoardRow = {
      person: p.person, rating: val.book.value(p.person.key) ?? 1000,
      change: latestNightChange(val.book.history.get(p.person.key), (id) => nightOf.get(id)!, nights.at(-1)),
      maps: games, record: recordText(rec), winrate: games ? rec[0] / games : 0, r: valRates(p.totals),
      agents: valTopAgents(p), cls: valMainClass(p), level: level(site, p.person.key),
    };
    (games >= MIN_MAPS ? rows : unranked).push(row);
  }
  rows.sort((a, b) => b.rating - a.rating || a.person.name.localeCompare(b.person.name));
  unranked.sort((a, b) => b.rating - a.rating || a.person.name.localeCompare(b.person.name));
  return { rows, unranked };
}

export function valMatchView(site: Site, m: ValMatchRow) {
  const deltas = site.val.book.deltas.get(m.id);
  const pred = site.val.book.predictions.get(m.id) ?? null;
  const classes = agentClasses();
  const teams = ([1, 2] as const).map((t) => ({
    no: t, name: t === 1 ? "Blue" : "Red", won: m.winner === t,
    rows: m.players.filter((p) => p.teamNo === t).map((p) => {
      const tot = blankTotals();
      addLine(tot, p, m.rounds);
      return { person: site.people.get(p.person)!, line: p, r: valRates(tot), cls: classes.get(p.agent) ?? null,
        delta: deltas?.get(p.person) ?? null, riot: p.tag ? `${p.name}#${p.tag}` : p.name };
    }).sort((a, b) => (b.r.acs ?? 0) - (a.r.acs ?? 0)),
  }));
  const upset = pred !== null && m.winner !== 0 && (m.winner === 1 ? pred : 1 - pred) < UPSET;
  return { map: m, teams, prediction: pred, upset };
}

export function valPlayerView(site: Site, p: ValPlayerSeason) {
  const { val } = site;
  const mapById = new Map(val.maps.map((m) => [m.id, m]));
  const classes = agentClasses();
  const agents = [...p.agents.entries()].sort((a, b) => b[1].maps - a[1].maps || b[1].rounds - a[1].rounds).map(([agent, a]) => ({
    agent, cls: classes.get(agent) ?? null, maps: a.maps, winrate: a.maps ? a.wins / a.maps : null, r: valRates(a),
  }));
  const counts = valClassMaps(p);
  const totalClass = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const rec = valRecord(p);
  const games = rec[0] + rec[1] + rec[2];
  return {
    rating: val.book.value(p.person.key), record: recordText(rec), maps: games, winrate: games ? rec[0] / games : 0,
    r: valRates(p.totals),
    chart: (val.book.history.get(p.person.key) ?? []).map(([id, v]) => ({ id, v, label: shortDay(mapById.get(id)!.playedAt) })),
    agents, classes: VAL_CLASSES.filter((c) => counts[c]).map((c) => ({ cls: CLASS_LABEL[c], share: counts[c] / totalClass })),
    mates: mates(site, p.mates),
    recent: [...p.apps].reverse().map((a) => ({ a, result: resultOf(a.map.winner, a.line.teamNo), acs: a.map.rounds ? a.line.score / a.map.rounds : 0,
      delta: val.book.deltas.get(a.map.id)?.get(p.person.key) ?? null })),
  };
}

export function agentView(site: Site) {
  const classes = agentClasses();
  const total = [...site.val.agents.values()].reduce((s, a) => s + a.rounds, 0) || 1;
  const groups = new Map<string, { agent: string; share: number; maps: number; winrate: number | null; r: ValRates; top: Person }[]>();
  for (const [agent, a] of site.val.agents) {
    const top = [...site.val.players.values()].reduce((best, p) =>
      (p.agents.get(agent)?.rounds ?? 0) > (best.agents.get(agent)?.rounds ?? 0) ? p : best);
    const key = classes.get(agent) ?? "unknown";
    groups.set(key, [...(groups.get(key) ?? []), { agent, share: a.rounds / total, maps: a.maps, winrate: a.maps ? a.wins / a.maps : null, r: valRates(a), top: top.person }]);
  }
  for (const rows of groups.values()) rows.sort((a, b) => b.share - a.share);
  return [...VAL_CLASSES, "unknown"].filter((c) => groups.has(c)).map((c) => ({ cls: c, rows: groups.get(c)! }));
}

export function valBuilderData(site: Site) {
  const out: { name: string; rating: number | null; overall: number[]; cls: ValClass | null; agents: string[] }[] =
    [...site.val.players.values()].map((p) => {
      const o = site.val.book.get(p.person.key);
      return { name: p.person.name, rating: site.val.book.value(p.person.key), overall: [o.mu, o.sigma], cls: valMainClass(p), agents: valTopAgents(p, 2) };
    });
  for (const person of site.people.values()) {
    if (person.linked.valorant.length && !site.val.players.has(person.key)) {
      out.push({ name: person.name, rating: null, overall: [25, 25 / 3], cls: null, agents: [] });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- shared ----------

function mates(site: Site, table: Map<string, [number, number]>) {
  return [...table.entries()].filter(([, [g]]) => g >= 3)
    .map(([key, [games, wins]]) => ({ person: site.people.get(key)!, games, wins, winrate: wins / games }))
    .sort((a, b) => b.winrate - a.winrate || b.games - a.games).slice(0, 3);
}

/** Single-game bests, like Blueward's stat leaderboards. */
export interface RecordBoard { key: string; label: string; unit: string; rows: { person: Person; value: number; mapId: string; mapName: string; when: Date; detail: string }[] }

export function owRecords(site: Site): RecordBoard[] {
  const stats: [string, string, string][] = [
    ["eliminations", "Most eliminations", "elims"], ["final_blows", "Most final blows", "final blows"],
    ["hero_damage", "Most hero damage", "damage"], ["healing", "Most healing", "healing"],
    ["damage_blocked", "Most damage blocked", "blocked"], ["solo_kills", "Most solo kills", "solo kills"],
    ["ults_used", "Most ultimates used", "ults"], ["deaths", "Most deaths", "deaths"],
  ];
  return stats.map(([key, label, unit]) => {
    const rows = site.ow.maps.flatMap((m) => m.players.map((p) => ({
      person: site.people.get(p.person)!, value: Object.values(p.heroes).reduce((s, h) => s + h[key as keyof typeof h], 0),
      mapId: m.id, mapName: m.mapName, when: m.playedAt, detail: p.main,
    }))).filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 10);
    return { key, label, unit, rows };
  });
}

export function valRecords(site: Site): RecordBoard[] {
  const lines = site.val.maps.flatMap((m) => m.players.map((p) => ({ m, p })));
  const board = (key: string, label: string, unit: string, value: (x: (typeof lines)[number]) => number | null, minRounds = 0) => ({
    key, label, unit,
    rows: lines.filter(({ m }) => m.rounds >= minRounds).map((x) => ({ person: site.people.get(x.p.person)!, value: value(x) ?? -1,
      mapId: x.m.id, mapName: x.m.mapName, when: x.m.playedAt, detail: x.p.agent }))
      .filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 10),
  });
  return [
    board("kills", "Most kills", "kills", ({ p }) => p.kills),
    board("acs", "Highest ACS", "ACS", ({ m, p }) => (m.rounds ? Math.round(p.score / m.rounds) : null), 13),
    board("damage", "Most damage", "damage", ({ p }) => p.damage),
    board("first_bloods", "Most first bloods", "first bloods", ({ p }) => p.first_bloods),
    board("assists", "Most assists", "assists", ({ p }) => p.assists),
    board("kd", "Best K/D", "K/D", ({ p }) => (p.kills >= 10 ? Math.round((p.kills / Math.max(1, p.deaths)) * 100) / 100 : null)),
    board("hs", "Best headshot rate", "%", ({ p }) => {
      const shots = (p.headshots ?? 0) + (p.bodyshots ?? 0) + (p.legshots ?? 0);
      return p.headshots !== null && shots >= 40 ? Math.round((p.headshots / shots) * 1000) / 10 : null;
    }),
    board("deaths", "Most deaths", "deaths", ({ p }) => p.deaths),
  ];
}

/** Leaderboards: everyone, or DUES members only (?who=members). */
export type Who = "everyone" | "members";
export const whoFrom = (v: string | string[] | undefined): Who => (v === "members" ? "members" : "everyone");
