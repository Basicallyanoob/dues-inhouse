import Link from "next/link";
import { notFound } from "next/navigation";
import { Delta, mmss, num, pct, PlayerLink } from "@/components/ui";
import { getSite } from "@/lib/season";
import { clock, dayLabel } from "@/lib/time";
import { owMatchView } from "@/lib/views";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = (await getSite()).ow.maps.find((x) => x.id === decodeURIComponent(id));
  return { title: m ? `${m.mapName}, ${dayLabel(m.playedAt)}` : "Map not found" };
}

export default async function OverwatchMatch({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const site = await getSite();
  const m = site.ow.maps.find((x) => x.id === decodeURIComponent(id));
  if (!m) notFound();
  const v = owMatchView(site, m);
  return (
    <>
      <section className="match-head">
        <p className="crumb"><Link href="/overwatch/matches">Matches</Link> / {dayLabel(m.playedAt)}, {clock(m.playedAt)}</p>
        <h1>{m.mapName}</h1>
        <div className="scoreline" aria-label="Final score">
          <div className={`side t1${v.teams[0].won ? " won" : ""}`}><span className="team">{m.teamNames[0]}</span><span className="score">{m.score[0]}</span></div>
          <div className={`side t2${v.teams[1].won ? " won" : ""}`}><span className="score">{m.score[1]}</span><span className="team">{m.teamNames[1]}</span></div>
        </div>
        <p className="lede">
          {m.mapType}, {mmss(m.duration)} of match time.{" "}
          {!m.complete ? "This log stops before the end of the match, so it is not rated." : m.winner === 0 ? "A draw." : `${m.teamNames[m.winner - 1]} won.`}{" "}
          {v.prediction !== null && <>Before the map the ratings gave {m.teamNames[0]} a {pct(v.prediction)} chance{v.upset ? ", so this was an upset" : ""}.</>}
        </p>
      </section>
      {v.teams.map((t) => (
        <section key={t.no} className={`team-block t${t.no}`}>
          <h2>{t.name}{t.won ? ", winners" : ""}</h2>
          <div className="scroll">
            <table>
              <caption className="sr">{t.name} scoreboard</caption>
              <thead><tr><th scope="col">Player</th><th scope="col">Heroes</th><th scope="col" className="num">Elims</th><th scope="col" className="num">Final blows</th><th scope="col" className="num">Deaths</th><th scope="col" className="num">Damage</th><th scope="col" className="num">Healing</th><th scope="col" className="num opt">Blocked</th><th scope="col" className="num">Rating</th></tr></thead>
              <tbody>
                {t.rows.map((r) => (
                  <tr key={r.ingame}>
                    <td className="name"><PlayerLink p={r.person} game="overwatch" />{r.ingame !== r.person.name && <span className="alias">as {r.ingame}</span>}</td>
                    <td>{r.heroes.join(", ")}</td>
                    <td className="num">{num(r.stats.eliminations)}</td><td className="num">{num(r.stats.final_blows)}</td><td className="num">{num(r.stats.deaths)}</td>
                    <td className="num">{num(r.stats.hero_damage)}</td><td className="num">{num(r.stats.healing)}</td><td className="num opt">{num(r.stats.damage_blocked)}</td>
                    <td className="num"><Delta v={r.delta} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
