import Link from "next/link";
import { redirect } from "next/navigation";
import { Flash } from "@/components/ui";
import { linkAccount, saveProfile, unlinkAccount } from "../actions";
import { getViewer } from "@/lib/auth";
import { db } from "@/lib/db";
import { GAME_LABEL } from "@/lib/games";

export const metadata = { title: "Your account" };

export default async function Me({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const flash = await searchParams;
  const v = await getViewer();
  if (!v) redirect("/login?next=/me");
  const sql = db();
  const [[me], accounts] = await Promise.all([
    sql`select * from players where id = ${v.id}`,
    sql`select * from game_accounts where player_id = ${v.id} and status <> 'rejected' order by game, created_at`,
  ]);
  return (
    <>
      <section className="intro">
        <h1>Your account</h1>
        <p className="lede">Signed in as {v.name}. <Link href={`/players/${v.slug}`}>See your profile</Link>.</p>
        <Flash ok={flash.ok} error={flash.error} />
      </section>

      <div className="grid2">
        <section className="card">
          <h2>Profile</h2>
          <form action={saveProfile}>
            <div className="field"><label htmlFor="name">Name on the site</label><input id="name" name="name" type="text" defaultValue={me.display_name} maxLength={40} required /></div>
            <div className="field"><label htmlFor="note">Note</label><input id="note" name="note" type="text" defaultValue={me.note ?? ""} maxLength={75} /><span className="hint">Up to 75 characters, shown on your profile.</span></div>
            <button className="btn">Save</button>
          </form>
        </section>

        <section className="card">
          <h2>Game accounts</h2>
          <p className="muted">Link every account you play inhouses on. An officer approves each one; then your games, past and future, count for you. For Valorant, <code>/link Name#TAG</code> in the club Discord links it straight away.</p>
          {accounts.length > 0 && (
            <ul className="results">
              {accounts.map((a) => (
                <li key={a.id}>
                  {GAME_LABEL[a.game as "overwatch" | "valorant"]}: <strong>{a.account}</strong> <span className={`pill ${a.status}`}>{a.status === "approved" ? "linked" : "waiting for an officer"}</span>{" "}
                  <form className="inline-form" action={unlinkAccount}><input type="hidden" name="id" value={a.id} /><button className="btn ghost small">Remove</button></form>
                </li>
              ))}
            </ul>
          )}
          <form action={linkAccount}>
            <div className="row">
              <div className="field"><label htmlFor="game">Game</label>
                <select id="game" name="game" defaultValue="valorant"><option value="overwatch">Overwatch (BattleTag)</option><option value="valorant">Valorant (Riot ID)</option></select></div>
              <div className="field"><label htmlFor="account">Account</label><input id="account" name="account" type="text" placeholder="Name#1234 or Name#Tag" required /></div>
            </div>
            <button className="btn">Ask to link</button>
          </form>
        </section>
      </div>

      <form action="/auth/logout" method="post"><button className="btn ghost">Sign out</button></form>
    </>
  );
}
