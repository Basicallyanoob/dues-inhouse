import Link from "next/link";
import { redirect } from "next/navigation";
import { BannerArt, toBanner } from "@/components/Banner";
import { Flash, num } from "@/components/ui";
import { equipBanner, linkAccount, redeemCode, saveProfile, unlinkAccount } from "../actions";
import { getViewer } from "@/lib/auth";
import { db } from "@/lib/db";
import { CURRENCY, RARITIES, RARITY_LABEL, formatCoins } from "@/lib/economy";
import { GAME_LABEL } from "@/lib/games";
import { balance } from "@/lib/shop";
import { shortDay } from "@/lib/time";

export const metadata = { title: "Your account" };

export default async function Me({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const flash = await searchParams;
  const v = await getViewer();
  if (!v) redirect("/login?next=/me");
  const sql = db();
  const [[me], accounts, owned, history, coins] = await Promise.all([
    sql`select * from players where id = ${v.id}`,
    sql`select * from game_accounts where player_id = ${v.id} and status <> 'rejected' order by game, created_at`,
    sql`select b.*, o.obtained_at from banners b left join owned_banners o on o.banner_id = b.id and o.player_id = ${v.id}
        where b.is_default or o.player_id is not null order by array_position(${RARITIES as unknown as string[]}::text[], b.rarity) desc, b.name`,
    sql`select kind, amount, note, created_at from ledger where player_id = ${v.id} order by id desc limit 15`,
    balance(v.id),
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
          <p className="muted">Link every account you play inhouses on. An officer approves each one; then your games, past and future, count for you and pay {CURRENCY}.</p>
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

      <section>
        <h2>Banner collection</h2>
        <p className="lede">{owned.length} banner{owned.length === 1 ? "" : "s"}. Pick one to show on your profile, or get more in the <Link href="/shop">shop</Link>.</p>
        <div className="grid3">
          {owned.map((b) => (
            <article key={b.id} className={`banner-card rarity-${b.rarity}${me.banner_id === b.id ? " equipped" : ""}`}>
              <BannerArt b={toBanner(b)} />
              <div className="meta">
                <span className="rarity-tag">{RARITY_LABEL[b.rarity as keyof typeof RARITY_LABEL]}</span>
                <strong>{b.name}</strong>
                {me.banner_id === b.id ? <span className="muted">Equipped</span> : (
                  <form action={equipBanner}><input type="hidden" name="banner_id" value={b.id} /><button className="btn ghost small">Equip</button></form>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="grid2">
        <section className="card">
          <h2>Promo code</h2>
          <form action={redeemCode} className="row">
            <div className="field"><label htmlFor="code">Code</label><input id="code" name="code" type="text" autoComplete="off" required /></div>
            <div className="field"><span className="label">&nbsp;</span><button className="btn">Redeem</button></div>
          </form>
        </section>
        <section className="card">
          <h2>{CURRENCY}: {formatCoins(coins)}</h2>
          {history.length ? (
            <ul className="results">
              {history.map((h, i) => (
                <li key={i}><span className={h.amount < 0 ? "bad" : ""}>{h.amount > 0 ? "+" : "−"}{num(Math.abs(h.amount))}</span> {h.note ?? h.kind} <span className="muted">{shortDay(h.created_at)}</span></li>
              ))}
            </ul>
          ) : <p className="muted">Nothing yet. Play an inhouse or claim the daily reward.</p>}
        </section>
      </div>

      <form action="/auth/logout" method="post"><button className="btn ghost">Sign out</button></form>
    </>
  );
}
