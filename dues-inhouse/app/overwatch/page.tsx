import Link from "next/link";
import { Delta, Empty, Hero, Level, num, pct, PlayerLink, Tile } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/games";
import { getViewer } from "@/lib/auth";
import { getSite } from "@/lib/season";
import { MIN_MAPS, owBoard, owMatchView } from "@/lib/views";
import { owTile } from "./tiles";

export const metadata = { title: "Overwatch leaderboard" };

export default async function OverwatchLadder() {
  const site = await getSite();
  const { ow } = site;
  if (!ow.maps.length) {
    return (
      <section className="intro">
        <h1>No maps yet</h1>
        <p className="lede">This page fills in after the first Overwatch inhouse is uploaded.</p>
        <ol className="steps">
          <li><strong>Host with ScrimTime.</strong> Load the ScrimTime mode in the custom game and turn on its Log Generator and Player Stat Summary.</li>
          <li><strong>Turn on log files.</strong> The host enables <em>Options &gt; Gameplay &gt; Enable Workshop Inspector Log File</em>. Each map is saved to Documents/Overwatch/Workshop.</li>
          <li><strong>Upload the logs.</strong> An officer drops the night&apos;s files (or a zip of them) on <Link href="/admin/games">Admin &gt; Games</Link>.</li>
        </ol>
      </section>
    );
  }
  const boards = [owBoard(site, null), ...(["tank", "damage", "support"] as const).map((r) => owBoard(site, r))];
  const me = (await getViewer())?.id;
  const myRank = boards[0].rows.findIndex((r) => r.person.key === me);
  const myMaps = boards[0].unranked.find((r) => r.person.key === me)?.maps;
  const nights = new Set(ow.maps.map((m) => m.night)).size;
  const hours = ow.maps.reduce((s, m) => s + m.duration, 0) / 3600;
  const recent = [...ow.maps].reverse().slice(0, 6).map((m) => owTile(owMatchView(site, m)));
  return (
    <>
      <Hero
        kicker="Overwatch inhouses"
        title="Leaderboard"
        actions={myRank >= 0 ? <a className="pill secondary" href="#you">You&apos;re #{myRank + 1} overall. Find your row</a> : undefined}
        facts={[
          { label: "Maps", value: num(ow.maps.length) },
          { label: "Club nights", value: num(nights) },
          { label: "Players", value: num(ow.players.size) },
          { label: "Hours played", value: num(hours, 1) },
        ]}
      >
        {myMaps !== undefined && <small>You&apos;ve played {myMaps} of the {MIN_MAPS} maps you need for an overall rank.</small>}
      </Hero>
      {ow.unknownHeroes.size > 0 && <p className="notice">Heroes missing from config/heroes.yaml: {[...ow.unknownHeroes].sort().join(", ")}. Add them so their maps count towards role ratings.</p>}
      <section className="boards" aria-label="Leaderboards by role">
        {boards.map((b, i) => <input key={b.role ?? "overall"} type="radio" name="board" id={`board-${b.role ?? "overall"}`} className="board-toggle" defaultChecked={i === 0} />)}
        <div className="segmented" role="group" aria-label="Role">
          {boards.map((b) => <label key={b.role ?? "overall"} htmlFor={`board-${b.role ?? "overall"}`}>{b.role ? ROLE_LABEL[b.role] : "Overall"}</label>)}
        </div>
        {boards.map((b) => (
          <div key={b.role ?? "overall"} className={`board board-${b.role ?? "overall"}`}>
            {b.rows.length ? (
              <div className="scroll">
                <table className="ladder">
                  <caption className="sr">{b.role ? ROLE_LABEL[b.role] : "Overall"} leaderboard</caption>
                  <thead><tr>
                    <th scope="col" className="num">#</th><th scope="col">Player</th><th scope="col" className="num">Rating</th>
                    {!b.role && <th scope="col" className="num" title="Rating change over the most recent club night">Latest night</th>}
                    <th scope="col" className="num">Maps</th><th scope="col" className="num">W–L</th><th scope="col" className="num">Win rate</th>
                    <th scope="col" className="num opt">Elims /10</th><th scope="col" className="num opt">Deaths /10</th>
                    <th scope="col" className="num opt">Damage /10</th><th scope="col" className="num opt">Healing /10</th>
                    <th scope="col" className="opt">Most played</th>
                  </tr></thead>
                  <tbody>
                    {b.rows.map((r, i) => (
                      <tr key={r.person.key} {...(r.person.key === me ? { id: b.role ? undefined : "you", className: "me" } : {})}>
                        <td className="num rank">{i + 1}</td>
                        <td className="name"><span className="who-cell"><Level level={r.level} /> <PlayerLink p={r.person} game="overwatch" />{r.person.key === me && <span className="you-tag">You</span>}</span></td>
                        <td className="num rating">{num(r.rating)}</td>
                        {!b.role && <td className="num"><Delta v={r.change} /></td>}
                        <td className="num">{r.maps}</td><td className="num">{r.record}</td><td className="num">{pct(r.winrate)}</td>
                        <td className="num opt">{num(r.per10.eliminations, 1)}</td><td className="num opt">{num(r.per10.deaths, 1)}</td>
                        <td className="num opt">{num(r.per10.hero_damage)}</td><td className="num opt">{num(r.per10.healing)}</td>
                        <td className="opt heroes">{r.heroes.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>Nobody has played {MIN_MAPS} {b.role ? ROLE_LABEL[b.role].toLowerCase() : ""} maps yet.</Empty>}
            {b.unranked.length > 0 && (
              <p className="unranked">Not ranked yet, fewer than {MIN_MAPS} maps:{" "}
                {b.unranked.map((r, i) => <span key={r.person.key}><PlayerLink p={r.person} game="overwatch" /> ({r.maps}){i < b.unranked.length - 1 ? ", " : ""}</span>)}
              </p>
            )}
          </div>
        ))}
        <p className="footnote">Per-10 figures are per ten minutes of play. Everyone starts on 1,000, and each role has its own rating.</p>
      </section>
      <section>
        <h2>Latest maps</h2>
        <div className="tiles">{recent.map((t) => <Tile key={t.href} t={t} />)}</div>
        <p><Link href="/overwatch/matches">All {ow.maps.length} maps</Link></p>
      </section>
    </>
  );
}
