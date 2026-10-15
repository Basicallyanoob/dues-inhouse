import { officerPage } from "@/lib/auth";
import Link from "next/link";
import { Flash } from "@/components/ui";
import { approve, reject } from "../actions";
import { db } from "@/lib/db";
import { GAME_LABEL } from "@/lib/games";
import { getSite } from "@/lib/season";
import { accountKey } from "@/lib/accounts";
import { shortDay } from "@/lib/time";

export default async function Requests({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await officerPage();
  const flash = await searchParams;
  const sql = db();
  const [pending, site] = await Promise.all([
    sql`select a.*, p.display_name, p.slug, p.discord_id,
          (select q.display_name from game_accounts h join players q on q.id = h.player_id
           where h.game = a.game and h.account_key = a.account_key and h.status = 'approved') as held_by
        from game_accounts a join players p on p.id = a.player_id
        where a.status = 'pending' order by a.created_at`,
    getSite(),
  ]);
  // How many games each requested account has already played, to help spot typos.
  const owCount = new Map<string, number>();
  for (const m of site.ow.maps) for (const p of m.players) owCount.set(accountKey("overwatch", p.name), (owCount.get(accountKey("overwatch", p.name)) ?? 0) + 1);
  const valCount = new Map<string, number>();
  for (const m of site.val.maps) for (const p of m.players) if (p.tag) valCount.set(accountKey("valorant", `${p.name}#${p.tag}`), (valCount.get(accountKey("valorant", `${p.name}#${p.tag}`)) ?? 0) + 1);
  return (
    <section>
      <Flash ok={flash.ok} error={flash.error} />
      <h2>Account link requests</h2>
      <p className="lede">Approve a request only if you know the account is theirs (ask in Discord if unsure). Approving joins every game on that account to their profile.</p>
      {!pending.length ? <p className="empty">Nothing waiting.</p> : (
        <div className="scroll"><table>
          <thead><tr><th scope="col">Member</th><th scope="col">Game</th><th scope="col">Account</th><th scope="col" className="num">Games already played</th><th scope="col">Asked</th><th scope="col">Decide</th></tr></thead>
          <tbody>{pending.map((a) => (
            <tr key={a.id}>
              <td className="name"><Link href={`/players/${a.slug}`}>{a.display_name}</Link></td>
              <td>{GAME_LABEL[a.game as "overwatch" | "valorant"]}</td>
              <td>{a.account}{a.held_by && <span className="alias">roster entry: {a.held_by} (merged on approval)</span>}</td>
              <td className="num">{(a.game === "overwatch" ? owCount : valCount).get(a.account_key) ?? 0}</td>
              <td>{shortDay(a.created_at)}</td>
              <td>
                <form className="inline-form" action={approve}><input type="hidden" name="id" value={a.id} /><button className="btn small">Approve</button></form>{" "}
                <form className="inline-form" action={reject}><input type="hidden" name="id" value={a.id} /><button className="btn ghost small">Decline</button></form>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
