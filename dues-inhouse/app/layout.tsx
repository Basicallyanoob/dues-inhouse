import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";
import { Avatar } from "@/components/ui";
import { GameSwitch, SiteNav } from "@/components/Nav";
import { getViewer, isOfficer } from "@/lib/auth";

export const metadata: Metadata = {
  title: { default: "DUES Inhouses", template: "%s · DUES Inhouses" },
  description: "Leaderboards, profiles and team builders for the Dublin University Esports Society's Overwatch and Valorant inhouses.",
  icons: { icon: "/logo.png" },
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/fonts/fonts.css" />
      </head>
      <body>
        <header className="masthead">
          <div className="wrap topbar">
            <Link className="club" href="/">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="club-logo" src="/logo.png" alt="" width={52} height={59} />
              <span className="club-text">
                <span className="club-name">DUES Inhouses</span>
                <span className="club-season">Dublin University Esports Society</span>
              </span>
            </Link>
            <div className="userbar">
              {viewer ? (
                <Link href="/me" title="Your account" aria-label="Your account"><Avatar name={viewer.name} url={viewer.avatarUrl} /></Link>
              ) : (
                <Link className="btn discord" href="/login">Sign in with Discord</Link>
              )}
            </div>
          </div>
          <div className="wrap subnav">
            <GameSwitch />
            <SiteNav officer={isOfficer(viewer)} />
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="wrap footer">
          <p>
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
