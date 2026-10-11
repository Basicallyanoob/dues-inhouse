import Link from "next/link";
import { BannerArt, toBanner } from "@/components/Banner";
import { RollPanel } from "@/components/RollPanel";
import { Flash } from "@/components/ui";
import { buyBanner } from "../actions";
import { getViewer } from "@/lib/auth";
import { db } from "@/lib/db";
import { CURRENCY, DUPLICATE_REFUND, RARITIES, RARITY_LABEL, formatCoins, type Rarity } from "@/lib/economy";
import { bannerPrice, pityCount, setOpen, toSet } from "@/lib/shop";
import { dayLabel } from "@/lib/time";

export const metadata = { title: "Shop" };

export default async function Shop({ searchParams }: { searchParams: Promise<{ set?: string; ok?: string; error?: string }> }) {
  const q = await searchParams;
  const viewer = await getViewer();
  const sql = db();
  const sets = (await sql`select * from banner_sets order by kind = 'limited' desc, sort, id`).map(toSet).filter((s) => setOpen(s));
  if (!sets.length) return <section className="intro"><h1>Shop</h1><p className="empty">Nothing in the shop right now.</p></section>;
  const set = sets.find((s) => s.slug === q.set) ?? sets[0];
  const banners = await sql`select * from banners where set_id = ${set.id} and active and not is_default
                            order by array_position(${RARITIES as unknown as string[]}::text[], rarity) desc, name`;
  const owned = viewer ? new Set((await sql`select banner_id from owned_banners where player_id = ${viewer.id}`).map((r) => r.banner_id as number)) : new Set<number>();
  const featured = banners.find((b) => b.id === set.featuredBannerId) ?? banners[0];
  const pity = viewer && set.pity ? await pityCount(viewer.id, set.id) : 0;
  const present = new Set(banners.map((b) => b.rarity as Rarity));
  const rates = RARITIES.filter((r) => present.has(r));
  const rateTotal = rates.reduce((s, r) => s + set.rates[r], 0) || 1;
  const buyable = banners.filter((b) => b.buyable);
  return (
    <>
      <section className="intro">
        <h1>Shop</h1>
        <p className="lede">Spend {CURRENCY} on banners for your profile. You earn them by playing inhouses and from the daily reward; they can&apos;t be bought with money.</p>
        <Flash ok={q.ok} error={q.error} />
        {sets.length > 1 && (
          <nav className="tabs" aria-label="Banner sets">
            {sets.map((s) => <Link key={s.id} href={`/shop?set=${s.slug}`} aria-current={s.id === set.id ? "page" : undefined}>{s.name}{s.kind === "limited" ? " · limited" : ""}</Link>)}
          </nav>
        )}
      </section>
      <section className="shop-head">
        <div className="featured">
          {featured && <BannerArt b={toBanner(featured)} />}
          <h2 style={{ marginTop: 12 }}>{set.name}</h2>
          <p className="lede">{set.description}{set.endsAt && <> Leaves the shop {dayLabel(set.endsAt)}.</>}</p>
          {featured && <p className="muted">Featured: <span className={`rarity-tag rarity-${featured.rarity}`}>{RARITY_LABEL[featured.rarity as Rarity]}</span> {featured.name}</p>}
        </div>
        <div className="card">
          <h2>Roll</h2>
          <p className="muted">Each roll gives one banner from this set. A banner you already own refunds part of the cost.</p>
          <ul className="rates">
            {rates.map((r) => (
              <li key={r}><span className={`rarity-tag rarity-${r}`}>{RARITY_LABEL[r]}</span><span>{((set.rates[r] / rateTotal) * 100).toFixed(1).replace(/\.0$/, "")}% · duplicate refund {Math.round(DUPLICATE_REFUND[r] * 100)}%</span></li>
            ))}
          </ul>
          {set.pity > 0 && <p className="muted">Guaranteed legendary or better within {set.pity} rolls{viewer ? `: ${set.pity - pity} to go` : ""}.</p>}
          <RollPanel setId={set.id} cost={set.rollCost} signedIn={!!viewer} currency={CURRENCY} />
        </div>
      </section>
      {buyable.length > 0 && (
        <section>
          <h2>Buy outright</h2>
          <div className="grid3">
            {buyable.map((b) => (
              <article key={b.id} className={`banner-card rarity-${b.rarity}`}>
                <BannerArt b={toBanner(b)} />
                <div className="meta">
                  <span className="rarity-tag">{RARITY_LABEL[b.rarity as Rarity]}</span>
                  <strong>{b.name}</strong>
                  {owned.has(b.id) ? <span className="muted">Owned</span> : viewer ? (
                    <form action={buyBanner}><input type="hidden" name="banner_id" value={b.id} /><input type="hidden" name="set" value={set.slug} />
                      <button className="btn small">Buy · {formatCoins(bannerPrice(b as never))}</button></form>
                  ) : <span className="muted">{formatCoins(bannerPrice(b as never))} {CURRENCY}</span>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2>In this set</h2>
        <p className="lede">{banners.length} banners{viewer ? `, ${banners.filter((b) => owned.has(b.id)).length} of them yours` : ""}.</p>
        <div className="grid3">
          {banners.map((b) => (
            <article key={b.id} className={`banner-card rarity-${b.rarity}${viewer && !owned.has(b.id) ? " locked" : ""}`}>
              <BannerArt b={toBanner(b)} />
              <div className="meta"><span className="rarity-tag">{RARITY_LABEL[b.rarity as Rarity]}</span><strong>{b.name}</strong>
                {b.credit && <span className="muted">Art: {b.credit}</span>}
                {viewer && <span className="muted">{owned.has(b.id) ? "Owned" : "Not yet"}</span>}</div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
