import { Records } from "@/components/Records";
import { getSite } from "@/lib/season";
import { valRecords } from "@/lib/views";

export const metadata = { title: "Valorant records" };

export default async function ValorantRecords() {
  const site = await getSite();
  return (
    <>
      <section className="intro"><h1>Valorant records</h1><p className="lede">The best single games of the season. Highest ACS counts games of 13 rounds or more; best K/D needs 10 kills, and headshot rate 40 hits.</p></section>
      <Records boards={valRecords(site)} game="valorant" />
    </>
  );
}
