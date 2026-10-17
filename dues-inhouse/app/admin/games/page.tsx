import { officerPage } from "@/lib/auth";
import Link from "next/link";
import { UploadBox, ValorantFetch } from "@/components/AdminTools";
import { ConfirmButton } from "@/components/Confirm";
import { Flash } from "@/components/ui";
import { removeGame, setSeason } from "../../actions";
import { seasonStartDay } from "@/lib/seasons";
import { db } from "@/lib/db";
import { getSite } from "@/lib/season";
import { clock, shortDay } from "@/lib/time";
import { valSettings } from "@/lib/val/fetch";

export default async function Games({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await officerPage();
  const flash = await searchParams;
  const site = await getSite();
  const s = valSettings();
  const season = await seasonStartDay();
  const [{ n: anchors }] = await db()`select count(*)::int as n from game_accounts where game = 'valorant' and status = 'approved'`;
  const recent = [
    ...site.ow.maps.map((m) => ({ game: "overwatch" as const, id: m.id, at: m.playedAt, label: `${m.mapName} ${m.score[0]}–${m.score[1]}${m.complete ? "" : " (unfinished)"}` })),
    ...site.val.maps.map((m) => ({ game: "valorant" as const, id: m.id, at: m.playedAt, label: `${m.mapName} ${m.score[0]}–${m.score[1]}${m.source === "manual" ? " (typed in)" : ""}` })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 40);
  return (
    <>
      <Flash ok={flash.ok} error={flash.error} />
      <section className="card season-card">
        <h2>Season</h2>
        <p className="muted">
          {season ? <>This season started on <b>{season}</b>. Only games from that day on count for ratings, leaderboards, records and profiles; older games stay saved but are left out, and imports don&apos;t bring them back.</>
            : <>Every game ever imported counts. Pick a start date to reset everyone to 1,000: only games from that day on will count, and imports won&apos;t bring older ones back.</>}
        </p>
        <form className="row" action={setSeason}>
          <div className="field"><label htmlFor="season-day">Season starts on</label><input id="season-day" name="day" type="date" defaultValue={season ?? ""} /></div>
          <ConfirmButton message="Change the season start? Ratings are recalculated from that day on.">Save</ConfirmButton>
        </form>
        {season && <form action={setSeason}><input type="hidden" name="day" value="" /><button className="link-btn">Count every game again</button></form>}
      </section>
      <section>
        <h2>Upload games</h2>
        <UploadBox />
      </section>
      <section>
        <h2>Valorant: fetch from match history</h2>
        <p className="lede">Checks the last 10 games of every linked Riot ID and saves finished custom games with at least {s.minPlayers} players, {s.minMembers} or more of them linked members, that started in the Saturday session window. It also runs by itself during the weeklies and on Sunday.</p>
        <ValorantFetch anchors={anchors} configured={Boolean(s.key)} />
      </section>
      <section>
        <h2>Recent games</h2>
        <p className="lede">Remove a game that shouldn&apos;t count (a warm-up, a test). Ratings are recalculated without it.</p>
        <div className="scroll"><table>
          <thead><tr><th scope="col">When</th><th scope="col">Game</th><th scope="col">Map and score</th><th scope="col">Remove</th></tr></thead>
          <tbody>{recent.map((g) => (
            <tr key={`${g.game}-${g.id}`}>
              <td>{shortDay(g.at)}, {clock(g.at)}</td>
              <td>{g.game === "overwatch" ? "Overwatch" : "Valorant"}</td>
              <td><Link href={`/${g.game}/matches/${encodeURIComponent(g.id)}`}>{g.label}</Link></td>
              <td><form className="inline-form" action={removeGame}><input type="hidden" name="game" value={g.game} /><input type="hidden" name="id" value={g.id} /><ConfirmButton message={`Remove ${g.label}? Ratings are recalculated without it.`}>Remove</ConfirmButton></form></td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
    </>
  );
}
