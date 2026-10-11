"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = {
  overwatch: [["", "Leaderboard"], ["/matches", "Matches"], ["/records", "Records"], ["/heroes", "Heroes"], ["/builder", "Team builder"]],
  valorant: [["", "Leaderboard"], ["/matches", "Matches"], ["/records", "Records"], ["/agents", "Agents"], ["/builder", "Team builder"]],
} as const;

export function GameSwitch() {
  const path = usePathname();
  const game = path.startsWith("/valorant") ? "valorant" : path.startsWith("/overwatch") ? "overwatch" : null;
  return (
    <nav className="games" aria-label="Game">
      <Link href="/overwatch" aria-current={game === "overwatch" ? "page" : undefined}>Overwatch</Link>
      <Link href="/valorant" aria-current={game === "valorant" ? "page" : undefined}>Valorant</Link>
    </nav>
  );
}

export function SiteNav({ officer }: { officer: boolean }) {
  const path = usePathname();
  const game = path.startsWith("/valorant") ? "valorant" : path.startsWith("/overwatch") ? "overwatch" : null;
  const links: [string, string][] = game
    ? SECTIONS[game].map(([href, label]) => [`/${game}${href}`, label])
    : [["/", "Home"]];
  links.push(["/shop", "Shop"]);
  if (officer) links.push(["/admin", "Admin"]);
  const current = (href: string) =>
    href === `/${game}` || href === "/" ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <nav className="site-nav" aria-label="Site">
      {links.map(([href, label]) => (
        <Link key={href} href={href} aria-current={current(href) ? "page" : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
