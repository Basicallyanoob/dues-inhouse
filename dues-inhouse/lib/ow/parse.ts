/**
 * Parse Overwatch Workshop Inspector logs written by the ScrimTime mode.
 *
 * Each log file holds one map. Every line looks like
 *   [00:06:42] ,player_stat,243.02,1,Team 1,sun,Lúcio,5,2,1,1551.96,...
 * The bracketed wall-clock time is dropped; the rest is a comma-separated event.
 * player_stat rows are cumulative: each round repeats every player's totals on
 * every hero so far, so the latest row per (player, hero) is the map total.
 * A straight port of the Python parser this site grew out of.
 */
import { createHash } from "node:crypto";
import { zonedToUtc } from "../time";

const PLAYER_STAT_FIELDS = [
  "match_time", "round", "team", "player", "hero",
  "eliminations", "final_blows", "deaths", "all_damage", "barrier_damage",
  "hero_damage", "healing", "healing_received", "self_healing", "damage_taken",
  "damage_blocked", "defensive_assists", "offensive_assists", "ults_earned",
  "ults_used", "multikill_best", "multikills", "solo_kills", "objective_kills",
  "environmental_kills", "environmental_deaths", "critical_hits",
  "critical_hit_accuracy", "scoped_accuracy", "scoped_critical_hit_accuracy",
  "scoped_critical_hit_kills", "shots_fired", "shots_hit", "shots_missed",
  "scoped_shots_fired", "scoped_shots_hit", "weapon_accuracy", "time_played",
] as const;
const TEXT_FIELDS = new Set(["team", "player", "hero"]);

export const STAT_KEYS = [
  "eliminations", "final_blows", "deaths", "hero_damage", "healing",
  "damage_blocked", "damage_taken", "offensive_assists", "defensive_assists",
  "ults_used", "solo_kills", "shots_fired", "shots_hit", "time_played",
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type HeroStats = Record<StatKey, number>;

export interface OwPlayer {
  name: string;
  team: 1 | 2;
  heroes: Record<string, HeroStats>;
}

export interface OwMap {
  id: string;
  playedAt: Date;
  mapName: string;
  mapType: string;
  teamNames: [string, string];
  score: [number, number];
  complete: boolean;
  duration: number;
  players: OwPlayer[];
  firstKills: { 1: number; 2: number };
}

export class LogError extends Error {}

export function splitFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of line) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function toNumber(value: string | undefined): number {
  const v = (value ?? "").trim();
  if (!v || v.includes("*")) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function readEvents(text: string): string[][] {
  const events: string[][] = [];
  for (let raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    raw = raw.trim();
    if (!raw) continue;
    let fields = splitFields(raw);
    if (raw.startsWith("[")) fields = fields.slice(1);
    if (!fields.length) continue;
    if (fields[0].trim() === "****") fields[0] = "kill"; // chat filter censors 'kill'
    events.push(fields.map((f) => f.trim()));
  }
  return events;
}

const FILENAME_TIME = /Log-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/;

/** Logs are named after the host's clock, which for DUES is Irish time. */
export function playedAtFromName(name: string, fallback = new Date()): Date {
  const m = FILENAME_TIME.exec(name);
  if (!m) return fallback;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  return zonedToUtc(y, mo, d, h, mi, s);
}

export function parseText(text: string, mapId: string, playedAt: Date): OwMap {
  let events = readEvents(text);
  const starts = events.filter((e) => e[0] === "match_start");
  if (!starts.length) throw new LogError("no match_start event; is this a ScrimTime log?");
  const start = starts[starts.length - 1]; // a restarted lobby logs a fresh match_start
  if (start.length < 6) throw new LogError("match_start row is too short");
  const [mapName, mapType, t1, t2] = [start[2], start[3], start[4], start[5]];
  const teamNo: Record<string, 1 | 2> = { [t1]: 1, [t2]: 2 };
  events = events.slice(events.lastIndexOf(start));

  const latest = new Map<string, Record<string, number | string>>();
  const teamOf = new Map<string, 1 | 2>();
  let lastTime = 0;
  let score: [number, number] = [0, 0];
  let complete = false;
  const firstKillRound = new Map<number, 1 | 2>();
  let currentRound = 0;

  for (const e of events) {
    const kind = e[0];
    if (e.length > 1) lastTime = Math.max(lastTime, toNumber(e[1]));
    if (kind === "round_start" && e.length > 2) currentRound = Math.trunc(toNumber(e[2]));
    else if (kind === "kill" && e.length > 5 && !firstKillRound.has(currentRound)) {
      if (e[2] in teamNo) firstKillRound.set(currentRound, teamNo[e[2]]);
      else if (e[5] in teamNo) firstKillRound.set(currentRound, (3 - teamNo[e[5]]) as 1 | 2);
    } else if (kind === "round_end" && e.length > 5) {
      score = [Math.trunc(toNumber(e[4])), Math.trunc(toNumber(e[5]))];
    } else if (kind === "match_end" && e.length > 4) {
      score = [Math.trunc(toNumber(e[3])), Math.trunc(toNumber(e[4]))];
      complete = true;
    } else if (kind === "player_stat" && e.length > PLAYER_STAT_FIELDS.length) {
      const row: Record<string, number | string> = {};
      PLAYER_STAT_FIELDS.forEach((name, i) => {
        row[name] = TEXT_FIELDS.has(name) ? e[i + 1] : toNumber(e[i + 1]);
      });
      const team = String(row.team);
      const player = String(row.player);
      if (!(team in teamNo) || !player) continue;
      const key = `${player}\u0000${row.hero}`;
      const prev = latest.get(key);
      if (!prev || (row.round as number) >= (prev.round as number)) {
        latest.set(key, row);
        teamOf.set(player, teamNo[team]);
      }
    }
  }
  if (!latest.size) throw new LogError("no player_stat rows; enable the Player Stat Summary in ScrimTime");

  const players = new Map<string, OwPlayer>();
  for (const [key, row] of latest) {
    const [name, hero] = key.split("\u0000");
    let p = players.get(name);
    if (!p) players.set(name, (p = { name, team: teamOf.get(name)!, heroes: {} }));
    p.heroes[hero] = Object.fromEntries(STAT_KEYS.map((k) => [k, row[k] as number])) as HeroStats;
  }
  for (const p of players.values()) {
    const played = Object.fromEntries(Object.entries(p.heroes).filter(([, s]) => s.time_played > 0));
    if (Object.keys(played).length) p.heroes = played;
  }
  const firstKills = { 1: 0, 2: 0 } as { 1: number; 2: number };
  for (const t of firstKillRound.values()) firstKills[t]++;

  return {
    id: mapId, playedAt, mapName, mapType, teamNames: [t1, t2], score, complete, duration: lastTime,
    players: [...players.values()].sort((a, b) => a.team - b.team || a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
    firstKills,
  };
}

export function parseLog(fileName: string, text: string): OwMap {
  const stem = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  return parseText(text, stem, playedAtFromName(stem));
}

/** Two copies of the same map share this, whatever the file is called. */
export function fingerprint(m: OwMap): string {
  const key = JSON.stringify([m.mapName, Math.round(m.duration * 100) / 100, m.players.map((p) => p.name).sort()]);
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

export function total(p: OwPlayer, key: StatKey): number {
  return Object.values(p.heroes).reduce((s, h) => s + h[key], 0);
}

export function mainHero(p: OwPlayer): string {
  return Object.entries(p.heroes).sort((a, b) => b[1].time_played - a[1].time_played)[0][0];
}

export function winner(score: [number, number]): 0 | 1 | 2 {
  return score[0] === score[1] ? 0 : score[0] > score[1] ? 1 : 2;
}
