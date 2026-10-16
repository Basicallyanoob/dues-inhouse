import Link from "next/link";
import { Delta, Empty, Hero, Level, num, pct, PlayerLink, Tile } from "@/components/ui";
import { CLASS_LABEL } from "@/lib/games";
import { WhoFilter } from "@/components/WhoFilter";
import { getViewer } from "@/lib/auth";
import { getSite } from "@/lib/season";
import { MIN_MAPS, valBoard, valMatchView, whoFrom } from "@/lib/views";
import { valTile } from "./tiles";

export const metadata = { title: "Valorant leaderboard" };

export default async function ValorantLadder({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const who = whoFrom((await searchParams).who);
  const site = await getSite();
  const { val } = site;
  if (!val.maps.length) {
    return (
      <section className="intro">
        <h1>No games yet</h1>
        <p className="lede">This page fills in after the first Valorant weekly is imported. Games are picked up automatically from the match history of members who have linked their Riot ID.</p>
        <ol className="steps">
          <li><strong>Link your Riot ID.</strong> In the club Discord, type <code>/link Name#TAG</code>. You only need to do it once.</li>
          <li><strong>Join on Saturday.</strong> Sign-ups open in the weeklies channel at 17:00; press <strong>Join</strong>. The bot makes balanced teams and a map vote.</li>
          <li><strong>Play.</strong> Results appear in Discord and here within about 10 minutes of each game. Customs on Saturday evening with at least 3 linked members count too.</li>
        </ol>
      </section>
    );
  }
  const all = valBoard(site);
  const keep = (r: { person: { dues: boolean } }) => who === "everyone" || r.person.dues;
  const board = { rows: all.rows.filter(keep), unranked: all.unranked.filter(keep) };
  const me = (await getViewer())?.id;
  const myRank = board.rows.findIndex((r) => r.person.key === me);
  const myGames = board.unranked.find((r) => r.person.key === me)?.maps;
  const nights = new Set(val.maps.map((m) => m.night)).size;
  const rounds = val.maps.reduce((s, m) => s + m.rounds, 0);
  const recent = [...val.maps].reverse().slice(0, 6).map((m) => valTile(valMatchView(site, m)));
  return (
    <>
      <Hero
        kicker="Valorant weeklies"
        title="Leaderboard"
        actions={myRank >= 0 ? <a className="pill secondary" href="#you">You&apos;re #{myRank + 1}. Find your row</a>
          : myGames !== undefined ? <a className="pill secondary" href="#you">You&apos;re provisional. Find your row</a> : undefined}
        facts={[
          { label: "Games", value: num(val.maps.length) },
          { label: "Club nights", value: num(nights) },
          { label: "Players", value: num(val.players.size) },
          { label: "Rounds", value: num(rounds) },
        ]}
      >
        {myGames !== undefined && <small>You&apos;ve played {myGames} of the {MIN_MAPS} games you need for a rank.</small>}
      </Hero>
      {val.unknownAgents.size > 0 && <p className="notice">Agents missing from config/agents.yaml: {[...val.unknownAgents].sort().join(", ")}.</p>}
      <section aria-label="Leaderboard">
        <WhoFilter base="/valorant" who={who} />
        {board.rows.length + board.unranked.length ? (
          <div className="scroll">
            <table className="ladder">
              <caption className="sr">Valorant leaderboard</caption>
              <thead><tr>
                <th scope="col" className="num">#</th><th scope="col">Player</th><th scope="col" className="num">Rating</th>
                <th scope="col" className="num" title="Rating change over the most recent club night">Latest night</th>
                <th scope="col" className="num">Games</th><th scope="col" className="num">W–L</th><th scope="col" className="num">Win rate</th>
                <th scope="col" className="num" title="Average combat score per round">ACS</th>
                <th scope="col" className="num opt" title="Kills per round">KPR</th>
                <th scope="col" className="num opt" title="Average damage per round">ADR</th>
                <th scope="col" className="num opt" title="First bloods per round: how often they got the round's first kill">FBPR</th>
                <th scope="col" className="num opt" title="Share of shots that hit the head">HS%</th>
                <th scope="col" className="num opt" title="Spike plants, in total">Plants</th>
                <th scope="col" className="opt">Plays</th>
              </tr></thead>
              <tbody>
                {[...board.rows, ...board.unranked].map((r, i) => (
                  <tr key={r.person.key} id={r.person.key === me ? "you" : undefined}
                    className={[r.person.key === me && "me", i >= board.rows.length && "provisional", i === board.rows.length && i > 0 && "first-provisional"].filter(Boolean).join(" ") || undefined}>
                    <td className="num rank">{i < board.rows.length ? i + 1 : "–"}</td>
                    <td className="name"><span className="who-cell"><Level level={r.level} /> <PlayerLink p={r.person} game="valorant" />
                      {r.person.key === me && <span className="you-tag">You</span>}
                      {i >= board.rows.length && <span className="prov-tag" title={`Fewer than ${MIN_MAPS} games: not ranked yet`}>Provisional</span>}</span></td>
                    <td className="num rating">{num(r.rating)}</td>
                    <td className="num"><Delta v={r.change} /></td>
                    <td className="num">{r.maps}</td><td className="num">{r.record}</td><td className="num">{pct(r.winrate)}</td>
                    <td className="num">{num(r.r.acs)}</td><td className="num opt">{num(r.r.kpr, 2)}</td>
                    <td className="num opt">{num(r.r.adr)}</td><td className="num opt">{num(r.r.fbpr, 2)}</td>
                    <td className="num opt">{pct(r.r.hs)}</td><td className="num opt">{num(r.r.plants)}</td>
                    <td className="opt heroes">{r.cls && <span className="cls">{CLASS_LABEL[r.cls]}</span>} {r.agents.slice(0, 2).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{who === "members" ? "No DUES members have played yet." : "Nobody has played yet."}</Empty>}
        <p className="footnote">Provisional players have played fewer than {MIN_MAPS} games and get a rank once they reach {MIN_MAPS}. ACS is average combat score per round, KPR kills per round, ADR average damage per round, FBPR first bloods (a round&apos;s first kill) per round, and HS% the share of shots that hit the head. Plants is spike plants in total. Everyone starts on 1,000.</p>
      </section>
      <section>
        <h2>Latest games</h2>
        <div className="tiles">{recent.map((t) => <Tile key={t.href} t={t} />)}</div>
        <p><Link href="/valorant/matches">All {val.maps.length} games</Link></p>
      </section>
    </>
  );
}
