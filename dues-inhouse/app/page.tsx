import Link from "next/link";
import { Level, num, PlayerLink, Tile } from "@/components/ui";
import { getViewer } from "@/lib/auth";
import { getSite } from "@/lib/season";
import { owBoard, owMatchView, valBoard, valMatchView } from "@/lib/views";
import { owTile } from "./overwatch/tiles";
import { valTile } from "./valorant/tiles";

export default async function Home() {
  const [site, viewer] = await Promise.all([getSite(), getViewer()]);
  const ow = owBoard(site, null).rows.slice(0, 5);
  const val = valBoard(site).rows.slice(0, 5);
  const latest = [
    ...site.ow.maps.slice(-3).map((m) => ({ at: m.playedAt, t: owTile(owMatchView(site, m)), game: "Overwatch" })),
    ...site.val.maps.slice(-3).map((m) => ({ at: m.playedAt, t: valTile(valMatchView(site, m)), game: "Valorant" })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 4);
  return (
    <>
      <section className="intro">
        <h1>DUES inhouses</h1>
        <p className="lede">Ratings, records and profiles from the society&apos;s Overwatch and Valorant inhouses. Valorant weeklies run in the club Discord: <code>/link Name#TAG</code> once, then press <strong>Join</strong> on Saturday.{" "}
          {!viewer && <>Sign in with Discord to see your profile and link your BattleTag.</>}</p>
      </section>
      <div className="grid2">
        {([["Overwatch", "/overwatch", ow], ["Valorant", "/valorant", val]] as const).map(([label, href, rows]) => (
          <section key={label} className="card">
            <h2><Link href={href}>{label}</Link></h2>
            {rows.length ? (
              <ol className="mini-ladder">
                {rows.map((r, i) => (
                  <li key={r.person.key}><span className="muted">{i + 1}</span> <Level level={r.level} /> <PlayerLink p={r.person} game={href.slice(1) as "overwatch" | "valorant"} /> <strong>{num(r.rating)}</strong></li>
                ))}
              </ol>
            ) : <p className="empty">No one ranked yet.</p>}
            <p><Link href={href}>Full leaderboard</Link></p>
          </section>
        ))}
      </div>
      {latest.length > 0 && (
        <section>
          <h2>Latest games</h2>
          <div className="tiles">{latest.map(({ t }) => <Tile key={t.href} t={t} />)}</div>
        </section>
      )}
    </>
  );
}
