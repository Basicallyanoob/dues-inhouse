import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";
import { Avatar, num } from "@/components/ui";
import { GlobalNav, LocalNav, type Findable } from "@/components/Nav";
import { Reveal } from "@/components/Reveal";
import { getViewer, isOfficer } from "@/lib/auth";
import { getSite } from "@/lib/season";
import { owBoard, valBoard } from "@/lib/views";

export const metadata: Metadata = {
  title: { default: "DUES Inhouses", template: "%s · DUES Inhouses" },
  description: "Leaderboards, profiles and team builders for the Dublin University Esports Society's Overwatch and Valorant inhouses.",
  icons: { icon: "/logo.png" },
};

export const dynamic = "force-dynamic";

/** Everyone the search box can find: members, and anyone who has played. */
async function findable(): Promise<Findable[]> {
  try {
    const site = await getSite();
    const val = new Map([...valBoard(site).rows, ...valBoard(site).unranked].map((r) => [r.person.key, r.rating]));
    const ow = new Map([...owBoard(site, null).rows, ...owBoard(site, null).unranked].map((r) => [r.person.key, r.rating]));
    return [...site.people.values()]
      .filter((p) => p.memberId || val.has(p.key) || ow.has(p.key))
      .map((p) => ({
        name: p.name, slug: p.slug,
        sub: [val.has(p.key) && `Valorant ${num(val.get(p.key))}`, ow.has(p.key) && `Overwatch ${num(ow.get(p.key))}`].filter(Boolean).join(", "),
        also: [...p.riotIds, ...p.owNames, ...p.linked.overwatch, ...p.linked.valorant].join(" ").toLowerCase(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return []; // search is a convenience; the page still works without it
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/fonts/fonts.css" />
      </head>
      <body>
        <GlobalNav
          officer={isOfficer(viewer)}
          viewer={viewer ? { name: viewer.name, slug: viewer.slug, avatar: <Avatar name={viewer.name} url={viewer.avatarUrl} /> } : null}
          people={await findable()}
        />
        <LocalNav />
        <Reveal />
        <main className="wrap">{children}</main>
        <footer className="footer">
          <p className="wrap">
            Dublin University Esports Society. Overwatch stats from ScrimTime Workshop logs; Valorant stats from the unofficial{" "}
            <a href="https://docs.henrikdev.xyz">HenrikDev API</a>.
            Overwatch is a trademark of Blizzard Entertainment. This site isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or
            opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, Valorant and all
            associated properties are trademarks or registered trademarks of Riot Games, Inc. Neither company is affiliated with this site.
          </p>
        </footer>
      </body>
    </html>
  );
}
