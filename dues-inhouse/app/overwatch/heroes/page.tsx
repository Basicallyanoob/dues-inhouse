import { pct, PlayerLink } from "@/components/ui";
import { ROLE_LABEL, type OwRole } from "@/lib/games";
import { getSite } from "@/lib/season";
import { heroView } from "@/lib/views";

export const metadata = { title: "Overwatch heroes" };

export default async function Heroes() {
  const groups = heroView(await getSite());
  return (
    <>
      <section className="intro"><h1>Heroes</h1>
        <p className="lede">Share of all time played, and how often a team won when the hero was a player&apos;s main pick for the map. Inhouse teams are random, so win rates on a handful of maps say more about who played the hero than about the hero.</p></section>
      {!groups.length && <p className="empty">Hero stats appear once the first map is uploaded.</p>}
      {groups.map((g) => (
        <section key={g.role}>
          <h2>{ROLE_LABEL[g.role as OwRole] ?? "Not in heroes.yaml"}</h2>
          <div className="scroll">
            <table className="hero-table">
              <thead><tr><th scope="col">Hero</th><th scope="col">Share of play time</th><th scope="col" className="num">Maps as main</th><th scope="col" className="num">Win rate</th><th scope="col" className="opt">Played most by</th></tr></thead>
              <tbody>
                {g.rows.map((h) => (
                  <tr key={h.hero}>
                    <td className="name">{h.hero}</td>
                    <td><div className="share"><span className="bar" style={{ ["--w" as string]: ((h.share / g.rows[0].share) * 100).toFixed(1) }} /><span>{(h.share * 100).toFixed(1)}%</span></div></td>
                    <td className="num">{h.maps}</td>
                    <td className="num">{h.rated >= 3 ? pct(h.winrate) : "–"}</td>
                    <td className="opt"><PlayerLink p={h.top} game="overwatch" /></td>
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
