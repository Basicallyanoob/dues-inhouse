/**
 * Slash commands and button clicks. Discord wants an answer within 3 seconds,
 * and a cold start plus a database round trip can take longer, so every
 * interaction is acknowledged at once ("deferred") and the real work runs
 * straight after (`later`), editing the reply when it's done.
 */
import { getSite, valRates, valRecord } from "../season";
import { MemberError, linkFromDiscord, playerForDiscord } from "../members";
import { FetchError, lookupAccount } from "../val/fetch";
import { recordText } from "../views";
import { tierName } from "../weekly/strength";
import {
  WeeklyError, checkIn, checkinReady, checkinState, closeVote, currentSession, endSession, getGame, getSession, join, leave,
  openSession, refreshRank, sessionGames, setSignupMessage, signups, vote,
} from "../weekly/session";
import { EPHEMERAL, editOriginal, followUp, postMessage, type MessageBody } from "./api";
import { announceMap, makeTeams, postCheckin, refreshSignups, teamsIfReady } from "./flow";
import { checkinMessage, gameMessage, signupMessage } from "./render";

interface DUser { id: string; username: string; global_name?: string | null }
interface Option { name: string; type: number; value?: string | number; options?: Option[] }
export interface Interaction {
  type: number;
  id: string;
  token: string;
  channel_id?: string;
  member?: { user: DUser; nick?: string | null; permissions?: string };
  user?: DUser;
  data?: { name?: string; options?: Option[]; custom_id?: string; resolved?: { users?: Record<string, DUser> } };
}

export interface Handled { body: Record<string, unknown>; later?: () => Promise<void> }

const PONG = 1, DEFERRED_REPLY = 5, DEFERRED_UPDATE = 6;
const ADMINISTRATOR = 1n << 3n, MANAGE_GUILD = 1n << 5n;

const userOf = (i: Interaction) => {
  const u = (i.member?.user ?? i.user)!;
  return { id: u.id, name: i.member?.nick || u.global_name || u.username };
};

/** Officers: the site's officers and admins, ADMIN_DISCORD_IDS, and anyone who can manage the Discord server. */
async function isOfficer(i: Interaction): Promise<boolean> {
  const perms = BigInt(i.member?.permissions ?? "0");
  if (perms & (ADMINISTRATOR | MANAGE_GUILD)) return true;
  const u = userOf(i);
  if ((process.env.ADMIN_DISCORD_IDS ?? "").split(/[,\s]+/).includes(u.id)) return true;
  const p = await playerForDiscord(u, false);
  return p?.role === "officer" || p?.role === "admin";
}

/** Errors meant for the person go back to them; anything else is logged and reported briefly. */
async function guard(i: Interaction, work: () => Promise<void>, reply: (text: string) => Promise<unknown>) {
  try {
    await work();
  } catch (e) {
    const known = e instanceof WeeklyError || e instanceof MemberError || e instanceof FetchError;
    if (!known) console.error("discord interaction failed", i.data?.name ?? i.data?.custom_id, e);
    await reply(known ? (e as Error).message : "Something went wrong there. Try again, or ask an officer to check the site's logs.")
      .catch((err) => console.error("could not report the error to Discord", err));
  }
}

export async function handleInteraction(i: Interaction): Promise<Handled> {
  if (i.type === 1) return { body: { type: PONG } };
  if (i.type === 2) return command(i);
  if (i.type === 3) return component(i);
  return { body: { type: PONG } };
}

// ---------- slash commands ----------

function command(i: Interaction): Handled {
  const name = i.data?.name;
  const sub = i.data?.options?.find((o) => o.type === 1);
  const opt = (n: string) => (sub?.options ?? i.data?.options ?? []).find((o) => o.name === n)?.value;
  const done = (text: string) => editOriginal(i.token, { content: text });
  const ephemeral = name === "link" || name === "weekly";
  return {
    body: { type: DEFERRED_REPLY, data: ephemeral ? { flags: EPHEMERAL } : {} },
    later: () => guard(i, async () => {
      if (name === "link") return linkCommand(i, String(opt("riot_id") ?? ""));
      if (name === "rating") return ratingCommand(i, opt("player") ? String(opt("player")) : null);
      if (name !== "weekly") return void (await done("I don't know that command."));
      if (!(await isOfficer(i)) && sub?.name !== "next") return void (await done("Only officers can do that."));
      if (sub?.name === "open") return openCommand(i);
      if (sub?.name === "next") return void (await done(await nextGame(i)));
      if (sub?.name === "teams") return void (await done(await teamsNow()));
      if (sub?.name === "end") return endCommand(i);
      await done("Use `/weekly open`, `/weekly teams`, `/weekly next` or `/weekly end`.");
    }, done),
  };
}

async function linkCommand(i: Interaction, riotId: string) {
  if (!/^[^#]{2,16}#[^#]{2,5}$/.test(riotId.trim())) throw new MemberError("A Riot ID looks like Name#TAG, with the tag after #.");
  const player = (await playerForDiscord(userOf(i), true))!;
  const acc = await lookupAccount(riotId.trim());
  const account = acc.name && acc.tag ? `${acc.name}#${acc.tag}` : riotId.trim();
  const how = await linkFromDiscord(player.id, { account, puuid: acc.puuid, current: acc.current, peak: acc.peak });
  const site = await getSite();
  const rank = [tierName(acc.current), acc.peak ? `peak ${tierName(acc.peak)}` : null].filter(Boolean).join(", ");
  const rating = site.val.book.has(player.id)
    ? `Your weeklies rating is ${site.val.book.value(player.id)}.`
    : "Everyone starts the weeklies leaderboard on 1000; only results move it.";
  await editOriginal(i.token, {
    content: `${how === "linked" ? "Linked" : "Updated"} **${account}**. ${rating} ` +
      `${rank ? `Your rank (${rank}) is only used to balance teams. ` : "No competitive rank found, so teams are balanced on your results. "}` +
      "From now on, joining a weekly is one click on **Join**.",
  });
}

async function ratingCommand(i: Interaction, targetId: string | null) {
  const target = targetId ? i.data?.resolved?.users?.[targetId] : null;
  const u = target ? { id: target.id, name: target.global_name || target.username } : userOf(i);
  const p = await playerForDiscord(u, false);
  const site = await getSite();
  const ps = p ? site.val.players.get(p.id) : undefined;
  if (!p || !ps) {
    await editOriginal(i.token, { content: `${target ? `<@${u.id}> hasn't` : "You haven't"} played a recorded weekly yet.` });
    return;
  }
  const r = valRates(ps.totals);
  const rec = valRecord(ps);
  const ladder = [...site.val.players.keys()].map((k) => [k, site.val.book.value(k) ?? 0] as const).sort((a, b) => b[1] - a[1]);
  const place = ladder.findIndex(([k]) => k === p.id) + 1;
  const fmt = (x: number | null, d = 0, pct = false) => (x === null ? "—" : pct ? `${(x * 100).toFixed(d)}%` : x.toFixed(d));
  await editOriginal(i.token, {
    embeds: [{
      title: `${ps.person.name} · ${site.val.book.value(p.id)}`, color: 0xd8323c,
      description: `#${place} of ${ladder.length} · ${rec[0] + rec[1] + rec[2]} games · ${recordText(rec)}`,
      fields: [
        { name: "ACS", value: fmt(r.acs), inline: true }, { name: "K/D", value: fmt(r.kd, 2), inline: true },
        { name: "ADR", value: fmt(r.adr), inline: true }, { name: "HS%", value: fmt(r.hs, 0, true), inline: true },
        { name: "First bloods / 24 rounds", value: fmt(r.fb, 1), inline: true },
      ],
    }],
  });
}

async function openCommand(i: Interaction) {
  if (!i.channel_id) throw new WeeklyError("Run this in the channel the sign-ups should go in.");
  const by = await playerForDiscord(userOf(i), true);
  const s = await openSession({ channelId: i.channel_id, by: by?.id ?? null });
  const msg = await postMessage(i.channel_id, await signupMessage(s.id));
  await setSignupMessage(s.id, i.channel_id, msg.id);
  await editOriginal(i.token, { content: "Sign-ups are open." });
}

async function endCommand(i: Interaction) {
  const s = await currentSession();
  if (!s) throw new WeeklyError("There's no session running.");
  await endSession(s.id);
  await refreshSignups(s.id);
  await editOriginal(i.token, { content: "Session closed. Results still come in from the Sunday check." });
}

/** Officers: make teams now from the sign-ups (first game) or the open check-in, even with fewer than ten. */
async function teamsNow(): Promise<string> {
  const s = await currentSession();
  if (!s) throw new WeeklyError("There's no session running. Start one with `/weekly open`.");
  const [anyGame] = await sessionGames(s.id);
  if (anyGame && !s.checkinFor) return `${await postCheckin(s.id)} Press **Make teams** on it when everyone's in.`;
  return makeTeams(s.id);
}

/** Next game: open a check-in, so everyone says again whether they're playing. */
async function nextGame(i: Interaction): Promise<string> {
  const s = await currentSession();
  if (!s) throw new WeeklyError("There's no session running. An officer can start one with `/weekly open`.");
  if (!(await isOfficer(i))) {
    const me = await playerForDiscord(userOf(i), false);
    if (!me || !(await signups(s.id)).some((p) => p.playerId === me.id)) throw new WeeklyError("Only players signed up tonight, or officers, can do that.");
  }
  return postCheckin(s.id);
}

// ---------- buttons ----------

function component(i: Interaction): Handled {
  const [kind, a, b] = (i.data?.custom_id ?? "").split(":");
  const tell = (text: string) => followUp(i.token, { content: text, flags: EPHEMERAL });
  const update = (body: MessageBody) => editOriginal(i.token, body);
  return {
    body: { type: DEFERRED_UPDATE },
    later: () => guard(i, async () => {
      const id = Number(a);
      if (kind === "join" || kind === "leave") {
        const player = await playerForDiscord(userOf(i), kind === "join");
        if (kind === "join") {
          if ((await join(id, player!.id)) === "already") await tell("You're already signed up.");
        } else if (!player || (await leave(id, player.id)) === "not signed up") {
          return void (await tell("You weren't signed up."));
        }
        await update(await signupMessage(id));
        if (kind === "join") await refreshRank(player!.id);
        return;
      }
      if (kind === "in" || kind === "out") {
        const player = await playerForDiscord(userOf(i), kind === "in");
        if (!player) return void (await tell("You weren't on tonight's list."));
        await checkIn(id, player.id, kind === "in");
        await update(await checkinMessage(id));
        if (await teamsIfReady(id)) return;
        if (kind === "in") await refreshRank(player.id);
        return;
      }
      if (kind === "teams") {
        const c = await checkinState(id);
        if (!c) return void (await tell("Teams for this game are already made."));
        if (await isOfficer(i)) return void (await makeTeams(id));
        const me = await playerForDiscord(userOf(i), false);
        if (!me || !c.playing.some((p) => p.playerId === me.id)) return void (await tell("Only players who are in, or officers, can make teams."));
        if (!checkinReady(c)) {
          return void (await tell(c.playing.length < 10
            ? `Ten need to be in first (${c.playing.length} so far). An officer can make teams with fewer.`
            : `Waiting for ${c.waiting.length} to answer, until <t:${Math.floor(c.closesAt.getTime() / 1000)}:t>.`));
        }
        return void (await makeTeams(id, { minPlayers: 10 }));
      }
      if (kind === "vote") {
        const g = await getGame(id);
        const map = g?.mapOptions[Number(b)];
        const player = await playerForDiscord(userOf(i), false);
        if (!g || !map || !player) throw new WeeklyError("Only the ten players in this game can vote.");
        const { closed } = await vote(id, player.id, map);
        const { ping: _ping, ...body } = await gameMessage(id);
        await update(body);
        if (closed) await announceMap(id);
        return;
      }
      if (kind === "lock") {
        const g = await getGame(id);
        if (!g || g.status !== "voting") return void (await tell("Voting on this game has finished."));
        const player = await playerForDiscord(userOf(i), false);
        const inLobby = player && [...g.teamA, ...g.teamB].includes(player.id);
        const officer = await isOfficer(i);
        if (!officer && !(inLobby && new Date() >= g.voteClosesAt)) {
          return void (await tell(`Voting closes <t:${Math.floor(g.voteClosesAt.getTime() / 1000)}:R>. Officers can close it early.`));
        }
        if (await closeVote(id, { force: true })) await announceMap(id);
        return;
      }
      if (kind === "next") {
        const s = await getSession(id);
        if (!s || s.status === "closed") return void (await tell("This session is closed."));
        return void (await tell(await nextGame(i)));
      }
      await tell("That button has expired.");
    }, tell),
  };
}
