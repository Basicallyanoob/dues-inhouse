"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { Who } from "@/lib/views";

/**
 * "Everyone / DUES members" above a leaderboard. Plain links, so a members-only
 * ranking can be shared; on the Overwatch page the chosen role tab comes along.
 */
export function WhoFilter({ base, who }: { base: string; who: Who }) {
  const router = useRouter();
  const href = (w: Who) => (w === "members" ? `${base}?who=members` : base);
  const keepRole = (w: Who) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    const role = document.querySelector<HTMLInputElement>("input.board-toggle:checked")?.id.replace("board-", "");
    if (!role || role === "overall" || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    router.replace(`${href(w)}${w === "members" ? "&" : "?"}role=${role}`, { scroll: false });
  };
  return (
    <nav className="tabs who-filter" aria-label="Who to show">
      {(["everyone", "members"] as Who[]).map((w) => (
        <Link key={w} href={href(w)} scroll={false} replace onClick={keepRole(w)} aria-current={who === w ? "page" : undefined}>
          {w === "everyone" ? "Everyone" : "DUES members"}
        </Link>
      ))}
    </nav>
  );
}
