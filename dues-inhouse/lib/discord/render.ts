/** What the bot's messages look like: sign-ups, each game's teams and map vote, and results. */
import { getSite } from "../season";
import { valRates } from "../season";
import { winnerOf } from "../val/match";
import { timeOnWindowDay } from "../val/window";
import { dayLabel } from "../time";
import { checkinState, getGame, getSession, people, standings, votes, signups, LOBBY_SIZE, type Game } from "../weekly/session";
import type { MessageBody } from "./api";

const RED = 0xd8323c, GOLD = 0xe8b04a, GREEN = 0x3ba55c, GREY = 0x72767d;
const BUTTON = 2, ROW = 1;
const PRIMARY = 1, SECONDARY = 2, SUCCESS = 3;

const unix = (d: Date) => Math.floor(d.getTime() / 1000);
const tag = (p: { name: string; discordId: string | null } | undefined) => (p?.discordId ? `<@${p.discordId}>` : p?.name ?? "?");
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const rows = (buttons: unknown[]) => {
  const out = [];
  for (let i = 0; i < buttons.length; i += 5) out.push({ type: ROW, components: buttons.slice(i, i + 5) });
  return out;
};

export const teamsAt = () => process.env.WEEKLY_TEAMS_AT || "18:45";

export async function signupMessage(sessionId: number): Promise<MessageBody> {
  const s = await getSession(sessionId);
  if (!s) throw new Error(`no session ${sessionId}`);
  const list = await signups(sessionId);
  const closed = s.status === "closed";
  const lines = list.map((p, i) => `${i + 1}. ${tag(p)}`);
  let when = "";
  try {
    if (s.status === "signup") when = `Teams are made at <t:${unix(timeOnWindowDay({ start: s.windowStart, end: s.windowEnd }, teamsAt()))}:t>. `;
  } catch { /* a bad WEEKLY_TEAMS_AT just leaves the time out */ }
  const description = closed
    ? "This session has finished. Thanks for playing!"
    : `${when}Press **Join** to play.${list.length > LOBBY_SIZE ? ` ${LOBBY_SIZE} play each game; whoever sat out goes in next.` : ""}\n` +
      "First time? Link your Riot ID once with `/link Name#TAG`.";
  return {
    embeds: [{
      title: `Valorant weeklies · ${dayLabel(s.windowStart)}`, color: closed ? GREY : RED, description,
      fields: [{ name: `Signed up (${list.length})`, value: lines.join("\n").slice(0, 1024) || "Nobody yet." }],
    }],
    components: closed ? [] : [{ type: ROW, components: [
      { type: BUTTON, style: SUCCESS, label: "Join", custom_id: `join:${s.id}` },
      { type: BUTTON, style: SECONDARY, label: "Leave", custom_id: `leave:${s.id}` },
    ] }],
  };
}

/** The check-in before a later game: who's in, who's out, who hasn't answered. */
export async function checkinMessage(sessionId: number): Promise<MessageBody> {
  const s = await getSession(sessionId);
  const c = await checkinState(sessionId);
  if (!s || !c) {
    return { embeds: [{ title: "Check-in closed", color: GREY, description: "Teams for the next game are up." }], components: [] };
  }
  const list = (xs: { name: string; discordId: string | null }[]) => xs.map(tag).join("\n").slice(0, 1024) || "—";
  const enough = c.playing.length >= LOBBY_SIZE;
  return {
    embeds: [{
      title: `Game ${c.gameNumber} check-in`, color: GOLD,
      description: `Playing the next game? Press **I'm in** or **I'm out**. New players can join here too.\n` +
        (enough
          ? c.waiting.length
            ? `Teams are made when everyone has answered, or at <t:${unix(c.closesAt)}:t>.`
            : "Everyone has answered: making teams."
          : `${LOBBY_SIZE - c.playing.length} more needed. An officer can press **Make teams** to go with fewer.`) +
        (c.playing.length > LOBBY_SIZE ? ` ${LOBBY_SIZE} play; whoever sat out most goes in first.` : ""),
      fields: [
        { name: `In (${c.playing.length})`, value: list(c.playing), inline: true },
        { name: `Not answered (${c.waiting.length})`, value: list(c.waiting), inline: true },
        { name: `Out (${c.out.length})`, value: list(c.out), inline: true },
      ],
    }],
    components: [{ type: ROW, components: [
      { type: BUTTON, style: SUCCESS, label: "I'm in", custom_id: `in:${s.id}` },
      { type: BUTTON, style: SECONDARY, label: "I'm out", custom_id: `out:${s.id}` },
      { type: BUTTON, style: PRIMARY, label: "Make teams", custom_id: `teams:${s.id}` },
    ] }],
  };
}

export async function gameMessage(gameOrId: Game | number): Promise<MessageBody & { ping: string[] }> {
  const g = typeof gameOrId === "number" ? await getGame(gameOrId) : gameOrId;
  if (!g) throw new Error("no such game");
  const lineup = [...g.teamA, ...g.teamB];
  const [who, standing, cast] = await Promise.all([people(lineup), standings(lineup), votes(g.id)]);
  // Team averages are the balancing numbers: rank and leaderboard rating blended (see lib/weekly/strength.ts).
  const avg = (t: string[]) => Math.round(t.reduce((s, p) => s + (standing.get(p)?.strength ?? 1000), 0) / t.length);
  const team = (t: string[]) => t.map((p) => {
    const st = standing.get(p);
    return `${tag(who.get(p))} · ${st?.rating ?? 1000}${st?.rank ? ` · ${st.rank}` : ""}`;
  }).join("\n");
  const fields = [
    { name: `Team A · ${avg(g.teamA)}`, value: team(g.teamA), inline: true },
    { name: `Team B · ${avg(g.teamB)}`, value: team(g.teamB), inline: true },
  ];
  if (g.status === "voting") {
    const all = await signups(g.sessionId);
    const resting = all.filter((p) => !lineup.includes(p.playerId) && p.at <= g.createdAt);
    if (resting.length && g.number === 1) fields.push({ name: "Sitting this one out", value: resting.map(tag).join(", ").slice(0, 1024), inline: false });
  }
  let description: string, components: unknown[] = [], color = GOLD;
  if (g.status === "voting") {
    const counts = new Map(g.mapOptions.map((m) => [m, 0]));
    for (const m of cast.values()) counts.set(m, (counts.get(m) ?? 0) + 1);
    description = "Each player: leaderboard rating · competitive rank. Teams are balanced on both.\n" +
      `**Map vote**: the ten players pick. Closes <t:${unix(g.voteClosesAt)}:R> or when everyone has voted (${cast.size}/${lineup.length}).`;
    components = [
      ...rows(g.mapOptions.map((m, i) => ({ type: BUTTON, style: counts.get(m) ? PRIMARY : SECONDARY,
        label: `${m}${counts.get(m) ? ` · ${counts.get(m)}` : ""}`, custom_id: `vote:${g.id}:${i}` }))),
      { type: ROW, components: [{ type: BUTTON, style: SECONDARY, label: "Lock in map", custom_id: `lock:${g.id}` }] },
    ];
  } else if (g.status === "cancelled") {
    description = "Cancelled.";
    color = GREY;
  } else {
    description = g.status === "played"
      ? `**${g.mapName}** · played. Results are below.`
      : `**Map: ${g.mapName}**. Host, make the custom lobby with these teams. The result shows up here after the game.`;
    color = g.status === "played" ? GREY : GREEN;
    components = [{ type: ROW, components: [{ type: BUTTON, style: PRIMARY, label: "Next game", custom_id: `next:${g.sessionId}` }] }];
  }
  return {
    embeds: [{ title: `Game ${g.number} · Team A ${avg(g.teamA)} vs Team B ${avg(g.teamB)}`, color, description, fields }],
    components,
    ping: lineup.map((p) => who.get(p)?.discordId).filter((x): x is string => Boolean(x)),
  };
}

/** A weekly game's result: score, and each player's rating change with their place in the lobby. */
export async function resultMessage(gameId: number): Promise<MessageBody> {
  const g = await getGame(gameId);
  if (!g?.matchId) throw new Error("game has no result");
  const site = await getSite();
  const m = site.val.maps.find((x) => x.id === g.matchId);
  if (!m) throw new Error("match not found");
  const deltas = site.val.book.deltas.get(m.id);
  const perf = site.val.book.perf.get(m.id);
  const who = await people([...g.teamA, ...g.teamB]);
  // Blue/Red to Team A/B: whichever colour most of team A played on.
  const aSet = new Set(g.teamA);
  const blueIsA = m.players.filter((p) => p.teamNo === 1 && aSet.has(p.person)).length >= m.players.filter((p) => p.teamNo === 2 && aSet.has(p.person)).length;
  const scoreA = blueIsA ? m.score[0] : m.score[1], scoreB = blueIsA ? m.score[1] : m.score[0];
  const w = winnerOf([scoreA, scoreB]);
  const line = (p: (typeof m.players)[number]) => {
    const d = deltas?.get(p.person) ?? 0;
    const pf = perf?.get(p.person);
    const r = valRates({ rounds: m.rounds, score: p.score, kills: p.kills, deaths: p.deaths, assists: p.assists, damage: p.damage ?? 0,
      damage_rounds: p.damage === null ? 0 : m.rounds, headshots: 0, shots: 0, first_bloods: 0, fb_rounds: 0, plants: 0, plant_games: 0 });
    const person = who.get(p.person) ?? { name: `${p.name}`, discordId: null };
    return `${tag(person)} **${signed(d)}** → ${site.val.book.value(p.person) ?? "—"} · ${p.agent}, ${p.kills}/${p.deaths}/${p.assists}, ${Math.round(r.acs ?? 0)} ACS` +
      (pf ? ` · #${pf.rank} in lobby` : "");
  };
  const side = (blue: boolean) => m.players.filter((p) => (p.teamNo === 1) === blue)
    .sort((a, b) => (perf?.get(a.person)?.rank ?? 99) - (perf?.get(b.person)?.rank ?? 99)).map(line).join("\n");
  return {
    embeds: [{
      title: `Game ${g.number} result · ${m.mapName} ${scoreA}–${scoreB}`,
      color: GREEN,
      description: w === 0 ? "**Draw.**" : `**Team ${w === 1 ? "A" : "B"} wins.** The result sets the direction; the round margin and each player's performance set the size.`,
      fields: [
        { name: `Team A · ${scoreA}`, value: side(blueIsA).slice(0, 1024) },
        { name: `Team B · ${scoreB}`, value: side(!blueIsA).slice(0, 1024) },
      ],
    }],
    components: [{ type: ROW, components: [{ type: BUTTON, style: PRIMARY, label: "Next game", custom_id: `next:${g.sessionId}` }] }],
  };
}
