import Link from "next/link";
import { BannerArt, toBanner } from "@/components/Banner";
import { Level, num, PlayerLink, Tile } from "@/components/ui";
import { db } from "@/lib/db";
import { getViewer } from "@/lib/auth";
import { CURRENCY } from "@/lib/economy";
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
  const [featured] = await db()`
    select b.*, s.name as set_name, s.slug as set_slug from banner_sets s join banners b on b.id = s.featured_banner_id
    where s.active and (s.starts_at is null or s.starts_at <= now()) and (s.ends_at is null or s.ends_at > now())
    order by s.kind = 'limited' desc, s.sort limit 1`;
  return (
    <>
      <section className="intro">
        <h1>DUES inhouses</h1>
        <p className="lede">Ratings, records and profiles from the society&apos;s Overwatch and Valorant inhouses, plus a banner collection paid for in {CURRENCY} you earn by playing.{" "}
          {!viewer && <>Sign in with Discord and link your BattleTag or Riot ID to start earning.</>}</p>
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
      {featured && (
        <section>
          <h2>In the shop: {featured.set_name}</h2>
          <Link href={`/shop?set=${featured.set_slug}`} className="featured-link"><BannerArt b={toBanner(featured)} /></Link>
        </section>
      )}
      {latest.length > 0 && (
        <section>
          <h2>Latest games</h2>
          <div className="tiles">{latest.map(({ t }) => <Tile key={t.href} t={t} />)}</div>
        </section>
      )}
    </>
  );
}
