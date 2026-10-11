import Link from "next/link";
import { redirect } from "next/navigation";
import { devSignIn } from "../actions";
import { devLogin, getViewer, safePath } from "@/lib/auth";
import { db } from "@/lib/db";
import { supabaseConfigured } from "@/lib/supabase";

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  if (await getViewer()) redirect(safePath(next, "/me"));
  const players = devLogin() ? await db()`select id, display_name, role from players order by role desc, display_name limit 40` : [];
  return (
    <section className="intro">
      <h1>Sign in</h1>
      <p className="lede">Sign in with the Discord account you use in the DUES server. Then link your BattleTag and Riot ID, and an officer joins your games to your profile.</p>
      {error === "setup" && <p className="flash error">Discord sign-in isn&apos;t set up on this site yet: see the README.</p>}
      {error === "discord" && <p className="flash error">Discord didn&apos;t complete the sign-in. Try again.</p>}
      {supabaseConfigured() && <p><Link className="btn discord" href={`/auth/login?next=${encodeURIComponent(safePath(next, "/me"))}`}>Sign in with Discord</Link></p>}
      {devLogin() && (
        <div className="card">
          <h2>Development sign-in</h2>
          <p className="muted">Shown only when DEV_LOGIN=1 outside production. Pick anyone to act as them.</p>
          <div className="row">
            {players.map((p) => (
              <form key={p.id} action={devSignIn}><input type="hidden" name="id" value={p.id} /><button className="btn ghost small">{p.display_name}{p.role !== "member" ? ` (${p.role})` : ""}</button></form>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
