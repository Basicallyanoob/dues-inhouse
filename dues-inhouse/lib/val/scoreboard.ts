/**
 * One Valorant game typed in from the end-of-game scoreboard, as CSV: a row
 * per player with date, map, team, rounds (won by that team), player (Riot
 * ID), agent, acs, kills, deaths, assists and optionally first_bloods.
 */
import { zonedToUtc } from "../time";
import { normaliseRiot, type StoredValMatch, type ValLine } from "./match";

export class ScoreboardError extends Error {}

const COLUMNS: Record<string, string[]> = {
  date: ["date", "time", "date and time", "played", "played at"],
  map: ["map"],
  team: ["team", "side"],
  rounds: ["rounds", "rounds won", "score", "team score"],
  player: ["player", "name", "riot id", "riot_id"],
  agent: ["agent"],
  acs: ["acs", "combat score", "average combat score"],
  kills: ["k", "kills"],
  deaths: ["d", "deaths"],
  assists: ["a", "assists"],
  first_bloods: ["fb", "first bloods", "first_bloods", "first kills"],
};
const TEAM_WORDS: Record<string, "Blue" | "Red"> = {
  blue: "Blue", a: "Blue", "1": "Blue", "team a": "Blue", defenders: "Blue",
  red: "Red", b: "Red", "2": "Red", "team b": "Red", attackers: "Red",
};

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()) && !r[0].trimStart().startsWith("#"));
}

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "map";

export function parseScoreboard(fileName: string, text: string): StoredValMatch {
  const rows = parseCsvRows(text);
  if (!rows.length) throw new ScoreboardError(`${fileName}: empty`);
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col: Record<string, number> = {};
  for (const [ours, names] of Object.entries(COLUMNS)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) col[ours] = i;
  }
  const missing = ["date", "map", "team", "rounds", "player", "agent", "acs", "kills", "deaths", "assists"].filter((c) => !(c in col));
  if (missing.length) throw new ScoreboardError(`${fileName}: missing column${missing.length > 1 ? "s" : ""} ${missing.join(", ")}`);
  const get = (r: string[], c: string) => (c in col && col[c] < r.length ? r[col[c]].trim() : "");
  const body = rows.slice(1);
  if (body.length < 2) throw new ScoreboardError(`${fileName}: needs a row for each player`);
  const num = (r: string[], c: string, line: number) => {
    const v = get(r, c);
    const n = Number(v);
    if (v === "" || !Number.isFinite(n)) throw new ScoreboardError(`${fileName} line ${line}: ${c} '${v}' is not a number`);
    return n;
  };
  const when = get(body[0], "date").replace(/\//g, "-");
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(when);
  if (!m) throw new ScoreboardError(`${fileName}: date '${when}' should look like 2026-10-14 19:30`);
  const playedAt = zonedToUtc(+m[1], +m[2], +m[3], +(m[4] ?? 20), +(m[5] ?? 0), 0);
  const score: Record<"Blue" | "Red", number | null> = { Blue: null, Red: null };
  const pending: [string[], "Blue" | "Red", number][] = [];
  body.forEach((r, i) => {
    const line = i + 2;
    const team = TEAM_WORDS[get(r, "team").toLowerCase()];
    if (!team) throw new ScoreboardError(`${fileName} line ${line}: team '${get(r, "team")}' should be Blue or Red`);
    const won = num(r, "rounds", line);
    if (score[team] !== null && score[team] !== won) throw new ScoreboardError(`${fileName} line ${line}: ${team} has two different round scores`);
    score[team] = won;
    pending.push([r, team, line]);
  });
  if (score.Blue === null || score.Red === null) throw new ScoreboardError(`${fileName}: needs players on both Blue and Red`);
  const rounds = score.Blue + score.Red;
  const players: ValLine[] = pending.map(([r, team, line]) => {
    const rid = get(r, "player");
    const [name, ...tag] = rid.split("#");
    const fb = get(r, "first_bloods");
    return {
      puuid: `manual:${normaliseRiot(rid)}`, name: name.trim(), tag: tag.join("#").trim(), team,
      agent: get(r, "agent") || "Unknown", score: num(r, "acs", line) * rounds, kills: num(r, "kills", line),
      deaths: num(r, "deaths", line), assists: num(r, "assists", line), headshots: null, bodyshots: null,
      legshots: null, damage: null, first_bloods: /^\d+$/.test(fb) ? Number(fb) : null,
    };
  });
  const stem = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  return {
    id: `manual-${slug(`${m[1]}-${m[2]}-${m[3]}-${stem}`)}`, playedAt, mapName: get(body[0], "map") || "Unknown map",
    score: [score.Blue, score.Red], lengthMs: 0, source: "manual", server: "", players,
  };
}
