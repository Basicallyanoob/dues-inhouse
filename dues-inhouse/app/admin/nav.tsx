"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [["/admin", "Link requests"], ["/admin/games", "Games"], ["/admin/members", "Members"], ["/admin/banners", "Banners"], ["/admin/codes", "Promo codes"]];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="admin-nav" aria-label="Admin">
      {LINKS.map(([href, label]) => <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>{label}</Link>)}
    </nav>
  );
}
