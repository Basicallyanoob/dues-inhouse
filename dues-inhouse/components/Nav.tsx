"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

const SECTIONS = {
  overwatch: { title: "Overwatch", links: [["", "Leaderboard"], ["/matches", "Matches"], ["/records", "Records"], ["/heroes", "Heroes"]], action: ["/builder", "Team builder"] },
  valorant: { title: "Valorant", links: [["", "Leaderboard"], ["/matches", "Matches"], ["/records", "Records"], ["/agents", "Agents"]], action: ["/builder", "Team builder"] },
} as const;

const gameOf = (path: string) => (path.startsWith("/valorant") ? "valorant" : path.startsWith("/overwatch") ? "overwatch" : null);

/** Someone you can search for: their name, how to reach them, and the names they play under. */
export interface Findable { name: string; slug: string; sub: string; also: string }

export interface ViewerSummary { name: string; slug: string; avatar: ReactNode }

/** Close a menu on Escape or a click outside it. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const click = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", click);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("mousedown", click); };
  }, [open, close, ref]);
}

/**
 * The thin bar at the very top. On wide screens: the crest, the two games,
 * admin, search and your account. On phones the links fold into a menu
 * button, as on most product sites; search and your account stay one tap away.
 */
export function GlobalNav({ officer, viewer, people }: { officer: boolean; viewer: ViewerSummary | null; people: Findable[] }) {
  const path = usePathname();
  const game = gameOf(path);
  const [panel, setPanel] = useState<null | "menu" | "search" | "account">(null);
  const bar = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = useMemo(() => () => setPanel(null), []);
  useDismiss(panel !== null, close, bar);
  useEffect(() => { opener.current = null; setPanel(null); }, [path]);
  useEffect(() => {
    document.documentElement.classList.toggle("menu-open", panel === "menu" || panel === "search");
  }, [panel]);
  const links: [string, string, boolean][] = [
    ["/overwatch", "Overwatch", game === "overwatch"],
    ["/valorant", "Valorant", game === "valorant"],
    ...(officer ? [["/admin", "Admin", path.startsWith("/admin")] as [string, string, boolean]] : []),
  ];
  // When a panel closes, put the keyboard back on the button that opened it.
  useEffect(() => {
    if (panel === null && opener.current && (document.activeElement === document.body || !document.activeElement)) opener.current.focus();
  }, [panel]);
  const toggle = (p: "menu" | "search" | "account", e: React.MouseEvent<HTMLElement>) => {
    opener.current = e.currentTarget;
    setPanel((cur) => (cur === p ? null : p));
  };
  return (
    <header className={`gnav${panel ? ` open-${panel}` : ""}`} ref={bar}>
      <div className="gnav-inner">
        <button className="gnav-icon gnav-burger" type="button" aria-expanded={panel === "menu"} aria-controls="gnav-menu" onClick={(e) => toggle("menu", e)}>
          <span className="sr">{panel === "menu" ? "Close menu" : "Menu"}</span>
          <span className="burger" aria-hidden />
        </button>
        <Link className="gnav-mark" href="/" aria-current={path === "/" ? "page" : undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={18} height={20} />
          <span>DUES Inhouses</span>
        </Link>
        <nav className="gnav-links" aria-label="Site">
          {links.map(([href, label, on]) => <Link key={href} href={href} aria-current={on ? "page" : undefined}>{label}</Link>)}
        </nav>
        <div className="gnav-tools">
          <button className="gnav-icon" type="button" aria-expanded={panel === "search"} aria-controls="gnav-search" onClick={(e) => toggle("search", e)}>
            <span className="sr">Find a player</span>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden><circle cx="6.8" cy="6.8" r="5.3" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10.7 10.7 15 15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
          {viewer ? (
            <button className="gnav-icon gnav-me" type="button" aria-expanded={panel === "account"} aria-controls="gnav-account" onClick={(e) => toggle("account", e)}>
              <span className="sr">Your account</span>
              {viewer.avatar}
            </button>
          ) : (
            <Link className="gnav-signin" href={`/login?next=${encodeURIComponent(path)}`}>Sign in</Link>
          )}
        </div>
      </div>

      {panel === "menu" && (
        <nav id="gnav-menu" className="gnav-menu" aria-label="Menu">
          <ul>
            <li><Link href="/" aria-current={path === "/" ? "page" : undefined}>Home</Link></li>
            {links.map(([href, label, on]) => <li key={href}><Link href={href} aria-current={on ? "page" : undefined}>{label}</Link></li>)}
          </ul>
          <ul className="small">
            {viewer
              ? <><li><Link href={`/players/${viewer.slug}`}>Your profile</Link></li><li><Link href="/me">Account and linked games</Link></li></>
              : <li><Link href={`/login?next=${encodeURIComponent(path)}`}>Sign in with Discord</Link></li>}
          </ul>
        </nav>
      )}
      {panel === "search" && <Search people={people} onDone={close} />}
      {panel === "account" && viewer && (
        <div id="gnav-account" className="gnav-pop">
          <p className="pop-name">{viewer.name}</p>
          <Link href={`/players/${viewer.slug}`}>Your profile</Link>
          <Link href="/me">Account and linked games</Link>
          <form action="/auth/logout" method="post"><button type="submit">Sign out</button></form>
        </div>
      )}
    </header>
  );
}

/** Find a player by name, Riot ID or BattleTag. Arrow keys move, Enter opens, Escape closes. */
function Search({ people, onDone }: { people: Findable[]; onDone: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const needle = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!needle) return [];
    const starts = people.filter((p) => p.name.toLowerCase().startsWith(needle));
    const rest = people.filter((p) => !p.name.toLowerCase().startsWith(needle) && (p.name.toLowerCase().includes(needle) || p.also.includes(needle)));
    return [...starts, ...rest].slice(0, 8);
  }, [needle, people]);
  useEffect(() => { setAt(0); }, [needle]);
  const open = (p: Findable) => { router.push(`/players/${p.slug}`); onDone(); };
  return (
    <div id="gnav-search" className="gnav-search">
      <div className="search-inner">
        <input
          ref={input} type="search" value={q} placeholder="Find a player" aria-label="Find a player by name, Riot ID or BattleTag"
          role="combobox" aria-expanded={hits.length > 0} aria-controls={listId} aria-activedescendant={hits[at] ? `${listId}-${at}` : undefined}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(i + 1, hits.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
            if (e.key === "Enter" && hits[at]) { e.preventDefault(); open(hits[at]); }
          }}
        />
        {needle && (
          hits.length ? (
            <ul id={listId} role="listbox" className="search-hits">
              {hits.map((p, i) => (
                <li key={p.slug} id={`${listId}-${i}`} role="option" aria-selected={i === at}>
                  <Link href={`/players/${p.slug}`} onClick={onDone} onMouseEnter={() => setAt(i)}><b>{p.name}</b>{p.sub && <span>{p.sub}</span>}</Link>
                </li>
              ))}
            </ul>
          ) : <p className="search-none">No player called “{q.trim()}”. Try their Riot ID or BattleTag.</p>
        )}
        {!needle && <p className="search-none">Search by name, Riot ID or BattleTag.</p>}
      </div>
    </div>
  );
}

/**
 * Under the global bar on a game's pages: the game's name, its pages, and the
 * team builder as the one button. On narrow screens the pages fold behind a
 * chevron next to the name.
 */
export function LocalNav() {
  const path = usePathname();
  const game = gameOf(path);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useMemo(() => () => setOpen(false), []);
  useDismiss(open, close, box);
  useEffect(() => { setOpen(false); }, [path]);
  if (!game) return null;
  const s = SECTIONS[game];
  const current = (href: string) => (href === "" ? path === `/${game}` : path === `/${game}${href}` || path.startsWith(`/${game}${href}/`));
  const here = s.links.find(([href]) => current(href))?.[1];
  return (
    <div className={`lnav${open ? " open" : ""}`} ref={box}>
      <div className="lnav-inner">
        <div className="lnav-head">
          <Link className="lnav-title" href={`/${game}`}>{s.title}</Link>
          <button className="lnav-toggle" type="button" aria-expanded={open} aria-controls="lnav-links" onClick={() => setOpen((o) => !o)}>
            <span className="sr">{open ? "Hide" : "Show"} {s.title} pages{here ? `, now on ${here}` : ""}</span>
            <svg viewBox="0 0 12 8" width="12" height="8" aria-hidden><path d="M1 1.5 6 6.5l5-5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
        <nav id="lnav-links" className="lnav-links" aria-label={`${s.title} pages`}>
          {s.links.map(([href, label]) => (
            <Link key={href} href={`/${game}${href}`} aria-current={current(href) ? "page" : undefined}>{label}</Link>
          ))}
        </nav>
        <Link className="pill small" href={`/${game}${s.action[0]}`} aria-current={current(s.action[0]) ? "page" : undefined}>{s.action[1]}</Link>
      </div>
    </div>
  );
}
