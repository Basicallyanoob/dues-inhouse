/**
 * The steps of a weekly night that both buttons and the scheduled check take:
 * posting check-ins and teams, announcing maps and results, keeping messages
 * up to date. Every step is safe to repeat.
 */
import { db } from "../db";
import { fetchLobby, type FetchReport } from "../val/fetch";
import {
  WeeklyError, checkinReady, checkinState, getGame, getSession, openCheckin, setCheckinMessage, setGameMessage, startGame,
} from "../weekly/session";
import { editMessage, postMessage } from "./api";
import { checkinMessage, gameMessage, resultMessage, signupMessage } from "./render";

export async function refreshSignups(sessionId: number) {
  const s = await getSession(sessionId);
  if (s?.channelId && s.signupMessageId) await editMessage(s.channelId, s.signupMessageId, await signupMessage(sessionId));
}

export async function refreshCheckin(sessionId: number, messageId?: string | null) {
  const s = await getSession(sessionId);
  const id = messageId ?? s?.checkinMessageId;
  if (s?.channelId && id) await editMessage(s.channelId, id, await checkinMessage(sessionId));
}

export async function refreshGame(gameId: number) {
  const g = await getGame(gameId);
  const s = g && (await getSession(g.sessionId));
  if (!g?.messageId || !s?.channelId) return;
  const { ping: _ping, ...body } = await gameMessage(g);
  await editMessage(s.channelId, g.messageId, body);
}

/** Open the next game's check-in and post it, pinging tonight's roster. */
export async function postCheckin(sessionId: number): Promise<string> {
  const { session, fresh } = await openCheckin(sessionId);
  if (!fresh) return `The game ${session.checkinFor} check-in is already open.`;
  if (!session.channelId) throw new WeeklyError("This session has no channel to post in.");
  const roster = (await db()`select p.discord_id from weekly_signups s join players p on p.id = s.player_id
                             where s.session_id = ${sessionId} and p.discord_id is not null`).map((r) => r.discord_id as string);
  const msg = await postMessage(session.channelId, {
    ...(await checkinMessage(sessionId)), content: roster.map((id) => `<@${id}>`).join(" ") || undefined, allowed_mentions: { users: roster },
  });
  await setCheckinMessage(sessionId, msg.id);
  return `Check-in for game ${session.checkinFor} is open.`;
}

/**
 * Before new teams: if a game has been played but its result isn't in yet,
 * look for it now (one API call), so the updated leaderboard counts.
 */
async function pullPendingResults(sessionId: number) {
  const [pending] = await db()`select 1 from weekly_games where session_id = ${sessionId} and status = 'ready'`;
  if (!pending) return;
  try {
    const report = await fetchLobby(sessionId);
    if (report) await announceResults(report);
  } catch (e) {
    console.warn("could not look for the last game's result before making teams", (e as Error).message);
  }
}

/** Make and post the next game's teams and map vote, pinging its ten. */
export async function makeTeams(sessionId: number, opts: { minPlayers?: number } = {}): Promise<string> {
  await pullPendingResults(sessionId);
  const before = await getSession(sessionId);
  if (!before?.channelId) throw new WeeklyError("This session has no channel to post in.");
  const { game, fresh } = await startGame(sessionId, opts);
  if (!fresh) return `Game ${game.number} was just made.`;
  const { ping, ...body } = await gameMessage(game);
  const msg = await postMessage(before.channelId, {
    ...body, content: ping.map((id) => `<@${id}>`).join(" ") || undefined, allowed_mentions: { users: ping },
  });
  await setGameMessage(game.id, msg.id);
  if (before.checkinMessageId && game.number > 1) await refreshCheckin(sessionId, before.checkinMessageId).catch(() => {});
  if (before.status === "signup") await refreshSignups(sessionId).catch(() => {});
  return `Game ${game.number} is up.`;
}

/** Make teams if the open check-in is ready: ten in, and everyone answered or time up. */
export async function teamsIfReady(sessionId: number, now = new Date()): Promise<string | null> {
  const c = await checkinState(sessionId);
  if (!c || !checkinReady(c, now)) return null;
  return makeTeams(sessionId, { minPlayers: 10 });
}

/** Announce a vote that just closed: update its message and say which map won. */
export async function announceMap(gameId: number) {
  await refreshGame(gameId);
  const g = await getGame(gameId);
  const s = g && (await getSession(g.sessionId));
  if (g?.mapName && s?.channelId) await postMessage(s.channelId, { content: `Game ${g.number} is on **${g.mapName}**.` });
}

/** Post the result of every weekly game a fetch found, then open the next game's check-in. */
export async function announceResults(report: FetchReport): Promise<string[]> {
  const out: string[] = [];
  for (const { gameId } of report.weekly) {
    const [row] = await db()`
      select g.number, g.session_id, s.channel_id, s.status,
             g.number = (select max(number) from weekly_games x where x.session_id = g.session_id) as latest
      from weekly_games g join weekly_sessions s on s.id = g.session_id where g.id = ${gameId}`;
    if (!row?.channel_id) continue;
    await refreshGame(gameId).catch((e) => console.error("could not update the game message", e));
    await postMessage(row.channel_id, await resultMessage(gameId));
    out.push(`game ${row.number} result posted`);
    if (row.latest && row.status !== "closed") {
      await postCheckin(row.session_id).catch((e) => {
        if (!(e instanceof WeeklyError)) console.error("could not open the next check-in", e);
      });
    }
  }
  return out;
}
