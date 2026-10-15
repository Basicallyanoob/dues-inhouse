import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, Delta, Hero, Level, num, pct, PlayerLink, RatingChart } from "@/components/ui";
import { db } from "@/lib/db";
import { CLASS_LABEL, ROLE_LABEL, type OwRole } from "@/lib/games";
import { getSite, level, type Person } from "@/lib/season";
import { shortDay } from "@/lib/time";
import { owPlayerView, valPlayerView } from "@/lib/views";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ game?: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const p = (await getSite()).bySlug.get(slug);
  return { title: p ? p.name : "Player not found" };
}

export default async function PlayerPage({ params, searchParams }: Props) {
  const [{ slug }, { game: asked }] = await Promise.all([params, searchParams]);
  const site = await getSite();
  const person = site.bySlug.get(slug);
  if (!person) notFound();
  const owP = site.ow.players.get(person.key);
  const valP = site.val.players.get(person.key);
  const game = asked === "valorant" && valP ? "valorant" : asked === "overwatch" && owP ? "overwatch"
    : (valP?.apps.length ?? 0) > (owP?.apps.length ?? 0) ? "valorant" : owP ? "overwatch" : valP ? "valorant" : null;
  // Note and picture change without games changing, so read them fresh rather than from the season cache.
  const [fresh] = person.memberId ? await db()`select note, avatar_url from players where id = ${person.memberId}` : [];
  const note = fresh ? fresh.note : person.note;
  const avatarUrl = fresh ? fresh.avatar_url : person.avatarUrl;
  const lv = level(site, person.key);
  const aliases = [...person.owNames].filter((n) => n !== person.name);
  const owV = game === "overwatch" && owP ? owPlayerView(site, owP) : null;
  const valV = game === "valorant" && valP ? valPlayerView(site, valP) : null;
  // The kicker says what they mostly play in the game shown.
  const mainOw = owV && [...owV.roles].sort((a, b) => b.maps - a.maps)[0];
  const mainVal = valV && [...valV.classes].sort((a, b) => b.share - a.share)[0];
  const kicker = mainOw ? `${ROLE_LABEL[mainOw.role]} main` : mainVal ? `${mainVal.cls} main` : person.memberId ? "DUES member" : "Guest player";
  const v = owV ?? valV;
  const accounts = [...person.linked.overwatch, ...person.linked.valorant];
  return (
    <>
      <Hero
        title={person.name}
        kicker={kicker}
        avatar={<Avatar name={person.name} url={avatarUrl} large />}
        facts={[
          ...(v ? [
            { label: `${owV ? "Overwatch" : "Valorant"} rating`, value: v.rating !== null ? num(v.rating) : "Unrated" },
            { label: "Record", value: v.record },
            { label: "Win rate", value: pct(v.winrate) },
          ] : []),
          { label: "Level", value: <Level level={lv} /> },
        ]}
      >
        {note && <p className="quote">“{note}”</p>}
        {accounts.length > 0 && <p>Plays as {accounts.join(", ")}.</p>}
        {aliases.length > 0 && <p>Also seen in Overwatch as {aliases.join(", ")}.</p>}
        {!person.memberId && <p>Not linked to a member yet. If this is you, sign in and link this account.</p>}
      </Hero>
      {(owP && valP) && (
        <nav className="tabs" aria-label="Game">
          <Link href={`/players/${slug}?game=overwatch`} aria-current={game === "overwatch" ? "page" : undefined}>Overwatch</Link>
          <Link href={`/players/${slug}?game=valorant`} aria-current={game === "valorant" ? "page" : undefined}>Valorant</Link>
        </nav>
      )}
      {!game && <p className="empty">No games yet. Games appear here once {person.name}&apos;s linked accounts play an inhouse.</p>}
      {owV && <OwTab v={owV} />}
      {valV && <ValTab v={valV} />}
    </>
  );
}

function OwTab({ v }: { v: ReturnType<typeof owPlayerView> }) {
  return (
    <>
      {v.roles.length > 0 && (
        <dl className="figures">
          {v.roles.map((r) => <div key={r.role}><dt>{ROLE_LABEL[r.role]} rating</dt><dd>{num(r.rating)}<span className="sub">{r.maps} maps</span></dd></div>)}
        </dl>
      )}
      {v.chart.length > 0 && <section><h2>Rating after each map</h2><RatingChart points={v.chart} unit="finished map" hrefFor={(id) => `/overwatch/matches/${encodeURIComponent(id)}`} /></section>}
      <section>
        <h2>Heroes</h2>
        <div className="scroll"><table>
          <thead><tr><th scope="col">Hero</th><th scope="col">Role</th><th scope="col" className="num">Time</th><th scope="col" className="num">Maps</th><th scope="col" className="num">Win rate</th><th scope="col" className="num">Elims /10</th><th scope="col" className="num">Deaths /10</th><th scope="col" className="num opt">Damage /10</th><th scope="col" className="num opt">Healing /10</th></tr></thead>
          <tbody>{v.heroes.map((h) => (
            <tr key={h.hero}><td className="name">{h.hero}</td><td>{h.role ? ROLE_LABEL[h.role as OwRole] : "Unknown"}</td><td className="num">{num(h.time / 60)} min</td><td className="num">{h.maps}</td>
              <td className="num">{pct(h.winrate)}</td><td className="num">{num(h.per10.eliminations, 1)}</td><td className="num">{num(h.per10.deaths, 1)}</td>
              <td className="num opt">{num(h.per10.hero_damage)}</td><td className="num opt">{num(h.per10.healing)}</td></tr>
          ))}</tbody>
        </table></div>
      </section>
      <Mates mates={v.mates} game="overwatch" />
      <section>
        <h2>Maps played</h2>
        <div className="scroll"><table>
          <thead><tr><th scope="col">Date</th><th scope="col">Map</th><th scope="col">Result</th><th scope="col">Hero</th><th scope="col" className="num">Elims</th><th scope="col" className="num">Deaths</th><th scope="col" className="num">Rating</th></tr></thead>
          <tbody>{v.recent.map((r) => (
            <tr key={r.a.map.id}>
              <td>{shortDay(r.a.map.playedAt)}</td>
              <td><Link href={`/overwatch/matches/${encodeURIComponent(r.a.map.id)}`}>{r.a.map.mapName}</Link></td>
              <td><span className={`result ${r.result}`}>{r.result[0].toUpperCase() + r.result.slice(1)}</span></td>
              <td>{r.a.hero}</td><td className="num">{num(r.a.totals.eliminations)}</td><td className="num">{num(r.a.totals.deaths)}</td>
              <td className="num"><Delta v={r.delta} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
    </>
  );
}

function ValTab({ v }: { v: ReturnType<typeof valPlayerView> }) {
  return (
    <>
      <dl className="figures">
        <div><dt>ACS</dt><dd>{num(v.r.acs)}</dd></div>
        <div><dt>KPR</dt><dd>{num(v.r.kpr, 2)}</dd></div>
        {v.r.adr !== null && <div><dt>ADR</dt><dd>{num(v.r.adr)}</dd></div>}
        {v.r.fbpr !== null && <div><dt>First bloods / round</dt><dd>{num(v.r.fbpr, 2)}</dd></div>}
        {v.r.hs !== null && <div><dt>Headshots</dt><dd>{pct(v.r.hs)}</dd></div>}
        {v.r.plants !== null && <div><dt>Plants</dt><dd>{num(v.r.plants)}</dd></div>}
        <div><dt>K/D</dt><dd>{num(v.r.kd, 2)}</dd></div>
      </dl>
      {v.chart.length > 0 && <section><h2>Rating after each game</h2><RatingChart points={v.chart} unit="game" hrefFor={(id) => `/valorant/matches/${encodeURIComponent(id)}`} /></section>}
      <section>
        <h2>Agents</h2>
        {v.classes.length > 0 && <p className="lede">{v.classes.map((c) => `${c.cls} ${pct(c.share)}`).join(", ")} of games.</p>}
        <div className="scroll"><table>
          <thead><tr><th scope="col">Agent</th><th scope="col">Class</th><th scope="col" className="num">Games</th><th scope="col" className="num">Win rate</th><th scope="col" className="num">ACS</th><th scope="col" className="num">K/D</th><th scope="col" className="num opt">ADR</th><th scope="col" className="num opt">HS%</th></tr></thead>
          <tbody>{v.agents.map((a) => (
            <tr key={a.agent}><td className="name">{a.agent}</td><td>{a.cls ? CLASS_LABEL[a.cls] : "Unknown"}</td><td className="num">{a.maps}</td>
              <td className="num">{pct(a.winrate)}</td><td className="num">{num(a.r.acs)}</td><td className="num">{num(a.r.kd, 2)}</td>
              <td className="num opt">{num(a.r.adr)}</td><td className="num opt">{pct(a.r.hs)}</td></tr>
          ))}</tbody>
        </table></div>
      </section>
      <Mates mates={v.mates} game="valorant" />
      <section>
        <h2>Games played</h2>
        <div className="scroll"><table>
          <thead><tr><th scope="col">Date</th><th scope="col">Map</th><th scope="col">Result</th><th scope="col" className="num">Score</th><th scope="col">Agent</th><th scope="col" className="num">ACS</th><th scope="col" className="num">K / D / A</th><th scope="col" className="num">Rating</th></tr></thead>
          <tbody>{v.recent.map((r) => {
            const m = r.a.map;
            const mine = r.a.line.teamNo === 1 ? m.score : [m.score[1], m.score[0]];
            return (
              <tr key={m.id}>
                <td>{shortDay(m.playedAt)}</td>
                <td><Link href={`/valorant/matches/${encodeURIComponent(m.id)}`}>{m.mapName}</Link></td>
                <td><span className={`result ${r.result}`}>{r.result[0].toUpperCase() + r.result.slice(1)}</span></td>
                <td className="num">{mine[0]}–{mine[1]}</td><td>{r.a.line.agent}</td><td className="num">{num(r.acs)}</td>
                <td className="num">{r.a.line.kills} / {r.a.line.deaths} / {r.a.line.assists}</td>
                <td className="num"><Delta v={r.delta} /></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </section>
    </>
  );
}

function Mates({ mates, game }: { mates: { person: Person; games: number; wins: number; winrate: number }[]; game: "overwatch" | "valorant" }) {
  if (!mates.length) return null;
  return (
    <section>
      <h2>Best teammates</h2>
      <p className="lede">Win rate on the same team, from players teamed with at least three times.</p>
      <ul className="mates">
        {mates.map((m) => <li key={m.person.key}><PlayerLink p={m.person} game={game} /> <span>{m.wins} of {m.games} won, {pct(m.winrate)}</span></li>)}
      </ul>
    </section>
  );
}
