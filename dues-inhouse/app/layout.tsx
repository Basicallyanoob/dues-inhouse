import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";
import { Avatar } from "@/components/ui";
import { DailyButton } from "@/components/DailyButton";
import { GameSwitch, SiteNav } from "@/components/Nav";
import { getViewer, isOfficer } from "@/lib/auth";
import { CURRENCY, DAILY_COINS, formatCoins } from "@/lib/economy";
import { balance, canClaimDaily } from "@/lib/shop";

export const metadata: Metadata = {
  title: { default: "DUES Inhouses", template: "%s · DUES Inhouses" },
  description: "Leaderboards, profiles, team builders and banners for the Dublin University Esports Society's Overwatch and Valorant inhouses.",
  icons: { icon: "/logo.png" },
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  const [coins, daily] = viewer ? await Promise.all([balance(viewer.id), canClaimDaily(viewer.id)]) : [0, false];
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
                <>
                  {daily && <DailyButton amount={formatCoins(DAILY_COINS)} />}
                  <Link className="coins" href="/shop" title={`${CURRENCY}: spend them in the shop`}>
                    <span className="crest" aria-hidden />{formatCoins(coins)}<span className="sr"> {CURRENCY}</span>
                  </Link>
                  <Link href="/me" title="Your account" aria-label="Your account"><Avatar name={viewer.name} url={viewer.avatarUrl} /></Link>
                </>
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
            <a href="https://docs.henrikdev.xyz">HenrikDev API</a>. {CURRENCY} and banners have no money value and can&apos;t be bought or traded.
            Overwatch is a trademark of Blizzard Entertainment. This site isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or
            opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, Valorant and all
            associated properties are trademarks or registered trademarks of Riot Games, Inc. Neither company is affiliated with this site.
          </p>
        </footer>
      </body>
    </html>
  );
}
