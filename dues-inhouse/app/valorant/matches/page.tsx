import Link from "next/link";
import { Tile } from "@/components/ui";
import { getSite } from "@/lib/season";
import { nightLabel } from "@/lib/time";
import { valMatchView } from "@/lib/views";
import { valTile } from "../tiles";

export const metadata = { title: "Valorant matches" };

export default async function ValorantMatches() {
  const site = await getSite();
  const nights = new Map<string, ReturnType<typeof valTile>[]>();
  for (const m of [...site.val.maps].reverse()) nights.set(m.night, [...(nights.get(m.night) ?? []), valTile(valMatchView(site, m))]);
  return (
    <>
      <section className="intro"><h1>Valorant matches</h1><p className="lede">Every inhouse game, newest first, with rounds won by each side.</p></section>
      {!nights.size && <p className="empty">No games imported yet. <Link href="/valorant">How games are added</Link></p>}
      {[...nights.entries()].map(([night, tiles]) => (
        <section key={night}>
          <h2>{nightLabel(night)}</h2>
          <div className="tiles">{tiles.map((t) => <Tile key={t.href} t={t} />)}</div>
        </section>
      ))}
    </>
  );
}
