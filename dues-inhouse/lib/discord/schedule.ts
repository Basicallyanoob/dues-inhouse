/**
 * What the scheduled check does on a Saturday (every 10 minutes or so, from the
 * GitHub Actions workflow): open sign-ups, make the first game's teams, close
 * map votes and check-ins whose time is up, look for finished games, and close
 * the night. Each step is safe to repeat, so late or doubled runs do no harm.
 */
import { db } from "../db";
import { nightKey } from "../time";
import { fetchLobby, type FetchReport } from "../val/fetch";
import { UNKNOWN_QUEUE } from "../val/match";
import { parseWindow, timeOnWindowDay, weeklyWindow } from "../val/window";
import { closeVote, dueVotes, endSession, openSession, setSignupMessage, signups, LOBBY_SIZE } from "../weekly/session";
import { discordConfig, postMessage } from "./api";
import { announceMap, announceResults, makeTeams, refreshSignups, teamsIfReady } from "./flow";
import { signupMessage, teamsAt } from "./render";

export { announceResults };

const auto = () => process.env.WEEKLY_AUTO !== "0";
const signupsOpen = () => process.env.WEEKLY_SIGNUPS_OPEN || "17:00";

export interface TickReport { steps: string[]; errors: string[] }

export async function sessionTick(now = new Date()): Promise<TickReport> {
  const out: TickReport = { steps: [], errors: [] };
  const step = async (name: string, fn: () => Promise<string | null | void>) => {
    try {
      const r = await fn();
      if (r) out.steps.push(`${name}: ${r}`);
    } catch (e) {
      console.error(`weekly ${name} failed`, e);
      out.errors.push(`${name}: ${(e as Error).message}`);
    }
  };
  const { channelId } = discordConfig();
  const spec = parseWindow();
  const sql = db();

  if (auto() && channelId && spec) await step("open sign-ups", async () => {
    const w = weeklyWindow(now, spec);
    if (now < timeOnWindowDay(w, signupsOpen()) || now >= w.end) return null;
    const [existing] = await sql`select 1 from weekly_sessions where night = ${nightKey(w.start)}`;
    if (existing) return null;
    const s = await openSession({ now, channelId, by: null });
    const msg = await postMessage(channelId, await signupMessage(s.id));
    await setSignupMessage(s.id, channelId, msg.id);
    return `opened for ${s.night}`;
  });

  if (auto()) await step("make teams", async () => {
    const due = await sql`select * from weekly_sessions where status = 'signup' and window_end > ${now}`;
    const done: string[] = [];
    for (const s of due) {
      const at = timeOnWindowDay({ start: new Date(s.window_start), end: new Date(s.window_end) }, teamsAt());
      if (now < at) continue;
      const count = (await signups(s.id)).length;
      if (count >= LOBBY_SIZE) {
        done.push(await makeTeams(s.id, { minPlayers: LOBBY_SIZE }));
      } else {
        // Not enough for a full lobby: leave it to an officer, and stop checking.
        await sql`update weekly_sessions set status = 'playing' where id = ${s.id}`;
        if (s.channel_id) await postMessage(s.channel_id, {
          content: `Only ${count} signed up, so no teams yet. More can still press **Join**; an officer can start with \`/weekly teams\`.`,
        });
        done.push(`only ${count} signed up`);
      }
    }
    return done.join("; ") || null;
  });

  await step("close votes", async () => {
    const closed: number[] = [];
    for (const id of await dueVotes(now)) if (await closeVote(id, { now })) { closed.push(id); await announceMap(id); }
    return closed.length ? `closed ${closed.length}` : null;
  });

  await step("close check-ins", async () => {
    const due = await sql`select id from weekly_sessions where status <> 'closed' and checkin_for is not null and checkin_closes_at <= ${now}`;
    const done: string[] = [];
    for (const s of due) {
      const r = await teamsIfReady(s.id, now);
      if (r) done.push(r);
    }
    return done.join("; ") || null;
  });

  await step("look for results", async () => {
    // One API call per session with unfinished games, until two hours after its window.
    const live = await sql`
      select distinct s.id from weekly_sessions s join weekly_games g on g.session_id = s.id
      where g.status in ('voting', 'ready') and s.window_start <= ${now} and ${now} < s.window_end + interval '2 hours'`;
    const found: string[] = [];
    for (const s of live) {
      const report = await fetchLobby(s.id);
      if (report) {
        found.push(...(await announceResults(report)));
        out.errors.push(...report.errors);
      }
    }
    return found.join("; ") || null;
  });

  await step("close nights", async () => {
    const old = await sql`select id from weekly_sessions where status <> 'closed' and window_end + interval '6 hours' < ${now}`;
    for (const s of old) {
      await endSession(s.id);
      await refreshSignups(s.id).catch(() => {});
    }
    return old.length ? `closed ${old.length}` : null;
  });
  return out;
}

/** After the Sunday import: a short summary, and a warning if Riot's data changed shape. */
export async function postImportSummary(report: FetchReport): Promise<void> {
  const { logChannelId, botToken } = discordConfig();
  if (!logChannelId || !botToken) return;
  const unknown = Object.entries(report.skipped).filter(([why]) => why.startsWith(UNKNOWN_QUEUE));
  if (!report.added.length && !unknown.length && !report.errors.length) return;
  const lines = [];
  if (report.added.length) lines.push(`Imported ${report.added.length} game${report.added.length === 1 ? "" : "s"}: ${report.added.join(", ")}.`);
  for (const [why, n] of unknown) lines.push(`⚠️ ${n} × ${why}. Riot may have changed the match format; check lib/val/match.ts.`);
  if (report.errors.length) lines.push(`Problems: ${report.errors.slice(0, 5).join("; ")}`);
  await postMessage(logChannelId, { content: lines.join("\n").slice(0, 1900) });
}
