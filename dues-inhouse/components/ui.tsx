import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { levelTier } from "@/lib/levels";
import type { Person } from "@/lib/season";
import { clock } from "@/lib/time";

export const num = (v: number | null | undefined, d = 0) =>
  v === null || v === undefined || Number.isNaN(v) ? "–" : v.toLocaleString("en-IE", { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${Math.round(v * 100)}%`);
export const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : "±0");
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function Delta({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return <span className="delta none">–</span>;
  return <span className={`delta ${v > 0 ? "up" : v < 0 ? "down" : "flat"}`}>{signed(v)}</span>;
}

export function PlayerLink({ p, game }: { p: Person; game?: "overwatch" | "valorant" }) {
  return <Link href={`/players/${p.slug}${game ? `?game=${game}` : ""}`}>{p.name}</Link>;
}

export function Level({ level }: { level: number }) {
  return <span className={`level t${levelTier(level) + 1}`} title={`Level ${level}`}>{level}</span>;
}

export function Avatar({ name, url, large }: { name: string; url: string | null; large?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img className={`avatar${large ? " lg" : ""}`} src={url} alt="" /> : <span className={`avatar${large ? " lg" : ""}`} aria-hidden>{name.slice(0, 1).toUpperCase()}</span>;
}

export interface TileMap {
  href: string;
  mapName: string;
  score: [number, number];
  winner: 0 | 1 | 2;
  complete: boolean;
  meta: string;
  playedAt: Date;
  upset?: boolean;
  teamNames: [string, string];
}

export function Tile({ t }: { t: TileMap }) {
  return (
    <Link className={`tile${t.complete ? "" : " unfinished"}`} href={t.href}>
      <span className="tile-map">{t.mapName}</span>
      <span className="tile-score">
        <span className={`side t1${t.complete && t.winner === 1 ? " won" : ""}`}><span className="sr">{t.teamNames[0]} </span>{t.score[0]}</span>
        <span className={`side t2${t.complete && t.winner === 2 ? " won" : ""}`}><span className="sr">{t.teamNames[1]} </span>{t.score[1]}</span>
      </span>
      <span className="tile-meta">{t.meta}, {clock(t.playedAt)}{t.upset && <span className="tag">Upset</span>}{!t.complete && <span className="tag">Unfinished</span>}</span>
    </Link>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** SVG line of rating after each game. */
export function RatingChart({ points, hrefFor, unit }: { points: { id: string; v: number; label: string }[]; hrefFor: (id: string) => string; unit: string }) {
  if (!points.length) return null;
  const W = 640, H = 200, L = 44, R = 16, T = 14, B = 26;
  const values = [...points.map((p) => p.v), 1000];
  let lo = Math.min(...values), hi = Math.max(...values);
  const step = hi - lo <= 300 ? 50 : 100;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (hi === lo) hi += step;
  const n = points.length;
  const x = (i: number) => L + (W - L - R) * (n > 1 ? i / (n - 1) : 0.5);
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const grid = [];
  for (let v = lo; v <= hi; v += step) grid.push(v);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Rating went from ${points[0].v} after the first ${unit} to ${points[n - 1].v} after the latest`}>
        {grid.map((v) => (
          <g key={v}>
            <line className={`grid${v === 1000 ? " base" : ""}`} x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
            <text className="axis" x={L - 8} y={y(v) + 4} textAnchor="end">{num(v)}</text>
          </g>
        ))}
        <polyline className="line" points={points.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")} />
        {points.map((p, i) => (
          <a key={p.id + i} href={hrefFor(p.id)}>
            <circle className="hit" cx={x(i)} cy={y(p.v)} r={10}><title>{`${p.label}: ${num(p.v)}`}</title></circle>
            <circle className={`dot${i === n - 1 ? " last" : ""}`} cx={x(i)} cy={y(p.v)} r={i === n - 1 ? 4.5 : 3} />
          </a>
        ))}
        <text className="axis" x={L} y={H - 6}>{points[0].label}</text>
        <text className="axis" x={W - R} y={H - 6} textAnchor="end">{points[n - 1].label}</text>
      </svg>
      <figcaption>Each point is a {unit}; select one to open its scoreboard. Everyone starts at 1,000, the rating of an average player.</figcaption>
    </figure>
  );
}

export function Flash({ ok, error }: { ok?: string | null; error?: string | null }) {
  if (error) return <p className="flash error" role="alert">{error}</p>;
  if (ok) return <p className="flash" role="status">{ok}</p>;
  return null;
}

export interface Fact { label: string; value: ReactNode; sub?: ReactNode }

/**
 * The page opener: a small eyebrow line, a large headline, a short subhead,
 * optional buttons, and a row of big figures with captions.
 */
export function Hero({ title, kicker, facts = [], children, crumb, avatar, actions, dark }: {
  title: string;
  kicker?: ReactNode;
  facts?: Fact[];
  children?: ReactNode;
  crumb?: ReactNode;
  avatar?: ReactNode;
  actions?: ReactNode;
  dark?: boolean;
}) {
  return (
    <section className={`hero${dark ? " dark" : ""}`} style={{ "--len": Math.max(6, title.length) } as CSSProperties}>
      {crumb && <p className="crumb">{crumb}</p>}
      <div className="hero-copy" data-reveal>
        {avatar && <div className="hero-avatar">{avatar}</div>}
        {kicker && <p className="eyebrow">{kicker}</p>}
        <h1 className="headline">{title}</h1>
        {children && <div className="subhead">{children}</div>}
        {actions && <div className="actions">{actions}</div>}
      </div>
      {facts.length > 0 && (
        <dl className="stats" data-reveal>
          {facts.map((f) => (
            <div key={f.label} className="stat"><dt>{f.label}{f.sub && <small>{f.sub}</small>}</dt><dd>{f.value}</dd></div>
          ))}
        </dl>
      )}
    </section>
  );
}
