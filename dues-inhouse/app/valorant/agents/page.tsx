import { num, pct, PlayerLink } from "@/components/ui";
import { CLASS_LABEL, type ValClass } from "@/lib/games";
import { getSite } from "@/lib/season";
import { agentView } from "@/lib/views";

export const metadata = { title: "Valorant agents" };

export default async function Agents() {
  const groups = agentView(await getSite());
  return (
    <>
      <section className="intro"><h1>Agents</h1>
        <p className="lede">Share of all rounds played, and how often a team won with the agent in it. Inhouse teams are random, so win rates on a handful of games say more about who played the agent than about the agent.</p></section>
      {!groups.length && <p className="empty">Agent stats appear once the first game is imported.</p>}
      {groups.map((g) => (
        <section key={g.cls}>
          <h2>{CLASS_LABEL[g.cls as ValClass] ? `${CLASS_LABEL[g.cls as ValClass]}s` : "Not in agents.yaml"}</h2>
          <div className="scroll">
            <table className="hero-table">
              <thead><tr><th scope="col">Agent</th><th scope="col">Share of rounds</th><th scope="col" className="num">Games</th><th scope="col" className="num">Win rate</th><th scope="col" className="num">ACS</th><th scope="col" className="num opt">K/D</th><th scope="col" className="opt">Played most by</th></tr></thead>
              <tbody>
                {g.rows.map((a) => (
                  <tr key={a.agent}>
                    <td className="name">{a.agent}</td>
                    <td><div className="share"><span className="bar" style={{ ["--w" as string]: ((a.share / g.rows[0].share) * 100).toFixed(1) }} /><span>{(a.share * 100).toFixed(1)}%</span></div></td>
                    <td className="num">{a.maps}</td>
                    <td className="num">{a.maps >= 3 ? pct(a.winrate) : "–"}</td>
                    <td className="num">{num(a.r.acs)}</td>
                    <td className="num opt">{num(a.r.kd, 2)}</td>
                    <td className="opt"><PlayerLink p={a.top} game="valorant" /></td>
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
