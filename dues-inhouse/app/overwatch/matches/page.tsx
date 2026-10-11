import Link from "next/link";
import { Tile } from "@/components/ui";
import { getSite } from "@/lib/season";
import { nightLabel } from "@/lib/time";
import { owMatchView } from "@/lib/views";
import { owTile } from "../tiles";

export const metadata = { title: "Overwatch matches" };

export default async function OverwatchMatches() {
  const site = await getSite();
  const nights = new Map<string, ReturnType<typeof owTile>[]>();
  for (const m of [...site.ow.maps].reverse()) nights.set(m.night, [...(nights.get(m.night) ?? []), owTile(owMatchView(site, m))]);
  return (
    <>
      <section className="intro"><h1>Overwatch matches</h1><p className="lede">Every map from every club night, newest first. Team 1 is blue, team 2 is red.</p></section>
      {!nights.size && <p className="empty">No maps uploaded yet. <Link href="/overwatch">How to add them</Link></p>}
      {[...nights.entries()].map(([night, tiles]) => (
        <section key={night}>
          <h2>{nightLabel(night)}</h2>
          <div className="tiles">{tiles.map((t) => <Tile key={t.href} t={t} />)}</div>
        </section>
      ))}
    </>
  );
}
