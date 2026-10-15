import Link from "next/link";
import { Hero, num, PlayerLink, Tile } from "@/components/ui";
import { getViewer } from "@/lib/auth";
import { getSite, type Person } from "@/lib/season";
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
  const players = new Set([...site.ow.players.keys(), ...site.val.players.keys()]).size;
  const nights = new Set([...site.ow.maps.map((m) => m.night), ...site.val.maps.map((m) => m.night)]).size;
  const anyGames = site.val.maps.length + site.ow.maps.length > 0;
  const top = (rows: { person: Person; level: number; rating: number }[], game: "overwatch" | "valorant", empty: string) => rows.length ? (
    <ol className="top3">
      {rows.slice(0, 3).map((r, i) => (
        <li key={r.person.key}><span className="rank">{i + 1}</span><PlayerLink p={r.person} game={game} /><b>{num(r.rating)}</b></li>
      ))}
    </ol>
  ) : <p className="tile-empty">{empty}</p>;
  return (
    <>
      <Hero
        kicker="Dublin University Esports Society"
        title="DUES Inhouses"
        actions={<>
          <Link className="pill" href="/valorant">Valorant leaderboard</Link>
          <Link className="pill secondary" href="/overwatch">Overwatch leaderboard</Link>
        </>}
        facts={anyGames ? [
          { label: "Valorant games", value: num(site.val.maps.length) },
          { label: "Overwatch maps", value: num(site.ow.maps.length) },
          { label: "Players", value: num(players) },
          { label: "Club nights", value: num(nights) },
        ] : []}
      >
        <p>Ratings, records and profiles from every inhouse the society plays.</p>
      </Hero>

      <div className="showcase">
        <section className="promo" data-reveal>
          <p className="eyebrow">Valorant</p>
          <h2 className="promo-title">Saturday Weeklies</h2>
          <p className="promo-links"><Link className="more" href="/valorant">Leaderboard</Link><Link className="more" href="/valorant/matches">Every game</Link></p>
          {top(val, "valorant", "The first weekly fills this in.")}
        </section>
        <section className="promo" data-reveal>
          <p className="eyebrow">Overwatch</p>
          <h2 className="promo-title">Sunday Weeklies</h2>
          <p className="promo-links"><Link className="more" href="/overwatch">Leaderboard</Link><Link className="more" href="/overwatch/builder">Team builder</Link></p>
          {top(ow, "overwatch", "The first uploaded night fills this in.")}
        </section>
      </div>

      <section className="howto" data-reveal>
        <h2>How the weeklies work.</h2>
        <ol>
          <li><b>Link once.</b> Add your Riot ID or BattleTag on <Link href="/me">your account page</Link>, or type <code>/link Name#TAG</code> in the club Discord for Valorant.</li>
          <li><b>Join on Saturday or Sunday.</b> Valorant is on Saturday and Overwatch on Sunday. Sign up when the weekly opens in Discord, and teams are balanced by rating.</li>
          <li><b>Play.</b> Stats and rating changes land here: Valorant within minutes of each game, Overwatch once an officer uploads the night&apos;s logs.</li>
        </ol>
        {!viewer && <p className="howto-foot"><Link className="more" href="/login">Sign in with Discord to see your profile</Link></p>}
      </section>

      {latest.length > 0 && (
        <section className="latest">
          <div className="section-head">
            <h2>Latest games.</h2>
            <Link className="more" href="/valorant/matches">See all</Link>
          </div>
          <div className="tiles">{latest.map(({ t }) => <Tile key={t.href} t={t} />)}</div>
        </section>
      )}
    </>
  );
}
