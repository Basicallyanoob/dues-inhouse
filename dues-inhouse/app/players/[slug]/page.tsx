import Link from "next/link";
import { notFound } from "next/navigation";
import { BannerArt, toBanner } from "@/components/Banner";
import { Avatar, Delta, Level, num, pct, PlayerLink, RatingChart } from "@/components/ui";
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
  // Banner, note and picture change without games changing, so read them fresh rather than from the season cache.
  const [fresh] = person.memberId ? await db()`select banner_id, note, avatar_url from players where id = ${person.memberId}` : [];
  const bannerId = fresh?.banner_id ?? null;
  const note = fresh ? fresh.note : person.note;
  const avatarUrl = fresh ? fresh.avatar_url : person.avatarUrl;
  const [bannerRow] = bannerId ? await db()`select * from banners where id = ${bannerId}` : [];
  const lv = level(site, person.key);
  const aliases = [...person.owNames].filter((n) => n !== person.name);
  return (
    <>
      <section className="profile-banner" aria-label={`${person.name}'s banner`}>
        <BannerArt b={bannerRow ? toBanner(bannerRow) : null} />
        <div className="who">
          <Avatar name={person.name} url={avatarUrl} large />
          <div>
            <h1>{person.name}</h1>
          </div>
        </div>
      </section>
      {note && <p className="note">“{note}”</p>}
      <p className="aka">
        <Level level={lv} /> Level {lv}
        {person.linked.overwatch.length + person.linked.valorant.length > 0 && <> · {[...person.linked.overwatch, ...person.linked.valorant].join(", ")}</>}
        {aliases.length > 0 && <> · also plays as {aliases.join(", ")}</>}
        {!person.memberId && <> · not linked to a member yet</>}
      </p>
      {(owP && valP) && (
        <nav className="tabs" aria-label="Game">
          <Link href={`/players/${slug}?game=overwatch`} aria-current={game === "overwatch" ? "page" : undefined}>Overwatch</Link>
          <Link href={`/players/${slug}?game=valorant`} aria-current={game === "valorant" ? "page" : undefined}>Valorant</Link>
        </nav>
      )}
      {!game && <p className="empty">No games yet. Games appear here once {person.name}&apos;s linked accounts play an inhouse.</p>}
      {game === "overwatch" && owP && <OwTab site={site} p={owP} />}
      {game === "valorant" && valP && <ValTab site={site} p={valP} />}
    </>
  );
}

function OwTab({ site, p }: { site: Awaited<ReturnType<typeof getSite>>; p: NonNullable<ReturnType<Awaited<ReturnType<typeof getSite>>["ow"]["players"]["get"]>> }) {
  const v = owPlayerView(site, p);
  return (
    <>
      <dl className="figures">
        <div><dt>Overwatch rating</dt><dd>{v.rating !== null ? num(v.rating) : "Unrated"}</dd></div>
        <div><dt>Record</dt><dd>{v.record}</dd></div>
        <div><dt>Win rate</dt><dd>{pct(v.winrate)}</dd></div>
        {v.roles.map((r) => <div key={r.role}><dt>{ROLE_LABEL[r.role]} rating</dt><dd>{num(r.rating)}<span className="sub">{r.maps} maps</span></dd></div>)}
      </dl>
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

function ValTab({ site, p }: { site: Awaited<ReturnType<typeof getSite>>; p: NonNullable<ReturnType<Awaited<ReturnType<typeof getSite>>["val"]["players"]["get"]>> }) {
  const v = valPlayerView(site, p);
  return (
    <>
      <dl className="figures">
        <div><dt>Valorant rating</dt><dd>{v.rating !== null ? num(v.rating) : "Unrated"}</dd></div>
        <div><dt>Record</dt><dd>{v.record}</dd></div>
        <div><dt>Win rate</dt><dd>{pct(v.winrate)}</dd></div>
        <div><dt>ACS</dt><dd>{num(v.r.acs)}</dd></div>
        <div><dt>K/D</dt><dd>{num(v.r.kd, 2)}</dd></div>
        {v.r.adr !== null && <div><dt>ADR</dt><dd>{num(v.r.adr)}</dd></div>}
        {v.r.hs !== null && <div><dt>Headshots</dt><dd>{pct(v.r.hs)}</dd></div>}
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
