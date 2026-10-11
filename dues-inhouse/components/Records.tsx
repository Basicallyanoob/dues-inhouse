import Link from "next/link";
import { num, PlayerLink } from "./ui";
import type { RecordBoard } from "@/lib/views";
import { shortDay } from "@/lib/time";

export function Records({ boards, game }: { boards: RecordBoard[]; game: "overwatch" | "valorant" }) {
  return (
    <div className="records">
      {boards.map((b) => (
        <section key={b.key} className="record-card" aria-labelledby={`rec-${b.key}`}>
          <h2 id={`rec-${b.key}`}>{b.label}</h2>
          {b.rows.length ? (
            <ol>
              {b.rows.map((r, i) => (
                <li key={`${r.mapId}-${r.person.key}`}>
                  <span className="muted">{i + 1}</span>
                  <PlayerLink p={r.person} game={game} />
                  <span className="v">{num(r.value, Number.isInteger(r.value) ? 0 : b.unit === "%" ? 1 : 2)}{b.unit === "%" ? "%" : ""}</span>
                  <span className="d">{r.detail} on <Link href={`/${game}/matches/${encodeURIComponent(r.mapId)}`}>{r.mapName}</Link>, {shortDay(r.when)}</span>
                </li>
              ))}
            </ol>
          ) : <p className="empty">No games yet.</p>}
        </section>
      ))}
    </div>
  );
}
