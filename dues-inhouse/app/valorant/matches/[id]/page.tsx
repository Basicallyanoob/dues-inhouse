import Link from "next/link";
import { notFound } from "next/navigation";
import { Delta, mmss, num, pct, PlayerLink, signed } from "@/components/ui";
import { CLASS_LABEL } from "@/lib/games";
import { getSite } from "@/lib/season";
import { clock, dayLabel } from "@/lib/time";
import { valMatchView } from "@/lib/views";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = (await getSite()).val.maps.find((x) => x.id === decodeURIComponent(id));
  return { title: m ? `${m.mapName}, ${dayLabel(m.playedAt)}` : "Game not found" };
}

export default async function ValorantMatch({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const site = await getSite();
  const m = site.val.maps.find((x) => x.id === decodeURIComponent(id));
  if (!m) notFound();
  const v = valMatchView(site, m);
  return (
    <>
      <section className="match-head">
        <p className="crumb"><Link href="/valorant/matches">Matches</Link> / {dayLabel(m.playedAt)}, {clock(m.playedAt)}</p>
        <h1>{m.mapName}</h1>
        <div className="scoreline" aria-label="Rounds won">
          <div className={`side t1${v.teams[0].won ? " won" : ""}`}><span className="team">Blue</span><span className="score">{m.score[0]}</span></div>
          <div className={`side t2${v.teams[1].won ? " won" : ""}`}><span className="score">{m.score[1]}</span><span className="team">Red</span></div>
        </div>
        <p className="lede">
          {m.rounds} rounds{m.lengthMs ? `, ${mmss(m.lengthMs / 1000)}` : ""}. {m.winner === 0 ? "A draw." : `${m.winner === 1 ? "Blue" : "Red"} won.`}{" "}
          {v.prediction !== null && <>Before the game the ratings gave Blue a {pct(v.prediction)} chance{v.upset ? ", so this was an upset" : ""}. </>}
          {m.source === "manual" && "Typed in from the scoreboard, so damage and headshots are not recorded."}
        </p>
      </section>
      {v.teams.map((t) => (
        <section key={t.no} className={`team-block t${t.no}`}>
          <h2>{t.name}{t.won ? ", winners" : ""}</h2>
          <div className="scroll">
            <table>
              <caption className="sr">{t.name} scoreboard</caption>
              <thead><tr><th scope="col">Player</th><th scope="col">Agent</th><th scope="col" className="num">ACS</th><th scope="col" className="num">K</th><th scope="col" className="num">D</th><th scope="col" className="num">A</th><th scope="col" className="num">+/–</th><th scope="col" className="num opt">ADR</th><th scope="col" className="num opt">HS%</th><th scope="col" className="num opt" title="First kill of a round">FB</th><th scope="col" className="num opt" title="Spike plants">Plants</th><th scope="col" className="num">Rating</th></tr></thead>
              <tbody>
                {t.rows.map((r) => {
                  const diff = r.line.kills - r.line.deaths;
                  return (
                    <tr key={r.line.puuid}>
                      <td className="name"><PlayerLink p={r.person} game="valorant" />{r.riot.split("#")[0] !== r.person.name && <span className="alias">as {r.riot}</span>}</td>
                      <td>{r.line.agent}{r.cls && <span className="alias">{CLASS_LABEL[r.cls]}</span>}</td>
                      <td className="num">{num(r.r.acs)}</td>
                      <td className="num">{r.line.kills}</td><td className="num">{r.line.deaths}</td><td className="num">{r.line.assists}</td>
                      <td className="num"><span className={`pm ${diff > 0 ? "up" : diff < 0 ? "down" : "flat"}`}>{signed(diff)}</span></td>
                      <td className="num opt">{num(r.r.adr)}</td><td className="num opt">{pct(r.r.hs)}</td>
                      <td className="num opt">{r.line.first_bloods ?? "–"}</td>
                      <td className="num opt">{r.line.plants ?? "–"}</td>
                      <td className="num"><Delta v={r.delta} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
