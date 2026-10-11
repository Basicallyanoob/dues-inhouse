import { Records } from "@/components/Records";
import { getSite } from "@/lib/season";
import { owRecords } from "@/lib/views";

export const metadata = { title: "Overwatch records" };

export default async function OverwatchRecords() {
  const site = await getSite();
  return (
    <>
      <section className="intro"><h1>Overwatch records</h1><p className="lede">The best single maps of the season, totals for the whole map. Long maps give more room, so a record on a short map is worth more.</p></section>
      <Records boards={owRecords(site)} game="overwatch" />
    </>
  );
}
