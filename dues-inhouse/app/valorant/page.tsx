import Link from "next/link";
import { Delta, Empty, Level, num, pct, PlayerLink, Tile } from "@/components/ui";
import { CLASS_LABEL } from "@/lib/games";
import { getSite } from "@/lib/season";
import { MIN_MAPS, valBoard, valMatchView } from "@/lib/views";
import { valTile } from "./tiles";

export const metadata = { title: "Valorant leaderboard" };

export default async function ValorantLadder() {
  const site = await getSite();
  const { val } = site;
  if (!val.maps.length) {
    return (
      <section className="intro">
        <h1>No games yet</h1>
        <p className="lede">This page fills in after the first Valorant inhouse is imported. Games are picked up automatically from the match history of members who have linked their Riot ID.</p>
        <ol className="steps">
          <li><strong>Link your Riot ID.</strong> Sign in, open <Link href="/me">your account</Link> and add it. An officer approves it.</li>
          <li><strong>Play.</strong> Any finished custom game with 10 players, at least 3 of them linked members, counts as an inhouse.</li>
          <li><strong>Wait, or ask an officer.</strong> The site checks every morning; officers can press <em>Fetch now</em> on Admin &gt; Games straight after a night.</li>
        </ol>
      </section>
    );
  }
  const board = valBoard(site);
  const nights = new Set(val.maps.map((m) => m.night)).size;
  const rounds = val.maps.reduce((s, m) => s + m.rounds, 0);
  const recent = [...val.maps].reverse().slice(0, 6).map((m) => valTile(valMatchView(site, m)));
  return (
    <>
      <section className="intro">
        <h1>Valorant leaderboard</h1>
        <p className="lede">{val.maps.length} game{val.maps.length === 1 ? "" : "s"} over {nights} club night{nights === 1 ? "" : "s"}, {val.players.size} players, {num(rounds)} rounds. Ratings update after every game; you need {MIN_MAPS} games to be ranked. ACS is average combat score per round, ADR average damage per round.</p>
        {val.unknownAgents.size > 0 && <p className="notice">Agents missing from config/agents.yaml: {[...val.unknownAgents].sort().join(", ")}.</p>}
      </section>
      <section aria-label="Leaderboard">
        {board.rows.length ? (
          <div className="scroll">
            <table className="ladder">
              <caption className="sr">Valorant leaderboard</caption>
              <thead><tr>
                <th scope="col" className="num">#</th><th scope="col">Player</th><th scope="col" className="num">Rating</th>
                <th scope="col" className="num" title="Rating change over the most recent club night">Latest night</th>
                <th scope="col" className="num">Games</th><th scope="col" className="num">W–L</th><th scope="col" className="num">Win rate</th>
                <th scope="col" className="num">ACS</th><th scope="col" className="num opt">K/D</th><th scope="col" className="num opt">ADR</th>
                <th scope="col" className="num opt">HS%</th><th scope="col" className="opt">Plays</th>
              </tr></thead>
              <tbody>
                {board.rows.map((r, i) => (
                  <tr key={r.person.key}>
                    <td className="num rank">{i + 1}</td>
                    <td className="name"><Level level={r.level} /> <PlayerLink p={r.person} game="valorant" /></td>
                    <td className="num rating">{num(r.rating)}</td>
                    <td className="num"><Delta v={r.change} /></td>
                    <td className="num">{r.maps}</td><td className="num">{r.record}</td><td className="num">{pct(r.winrate)}</td>
                    <td className="num">{num(r.r.acs)}</td><td className="num opt">{num(r.r.kd, 2)}</td>
                    <td className="num opt">{num(r.r.adr)}</td><td className="num opt">{pct(r.r.hs)}</td>
                    <td className="opt heroes">{r.cls && <span className="cls">{CLASS_LABEL[r.cls]}</span>} {r.agents.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>Nobody has played {MIN_MAPS} games yet.</Empty>}
        {board.unranked.length > 0 && (
          <p className="unranked">Not ranked yet, fewer than {MIN_MAPS} games:{" "}
            {board.unranked.map((r, i) => <span key={r.person.key}><PlayerLink p={r.person} game="valorant" /> ({r.maps}){i < board.unranked.length - 1 ? ", " : ""}</span>)}
          </p>
        )}
      </section>
      <section>
        <h2>Latest games</h2>
        <div className="tiles">{recent.map((t) => <Tile key={t.href} t={t} />)}</div>
        <p><Link href="/valorant/matches">All {val.maps.length} games</Link></p>
      </section>
    </>
  );
}
