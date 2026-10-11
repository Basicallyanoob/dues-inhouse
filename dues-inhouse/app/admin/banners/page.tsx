import { officerPage } from "@/lib/auth";
import { BannerArt, toBanner } from "@/components/Banner";
import { ConfirmButton } from "@/components/Confirm";
import { Flash } from "@/components/ui";
import { deleteBanner, saveBannerAction, saveSetAction } from "../../actions";
import { db } from "@/lib/db";
import { RARITIES, RARITY_LABEL, RARITY_PRICE, type Rarity } from "@/lib/economy";
import { toSet, type BannerSet } from "@/lib/shop";
import { toInputValue } from "@/lib/time-input";

export default async function Banners({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; edit?: string }> }) {
  await officerPage();
  const q = await searchParams;
  const sql = db();
  const [sets, banners, owners] = await Promise.all([
    sql`select * from banner_sets order by sort, id`.then((r) => r.map(toSet)),
    sql`select * from banners order by set_id nulls first, array_position(${RARITIES as unknown as string[]}::text[], rarity) desc, name`,
    sql`select banner_id, count(*)::int as n from owned_banners group by banner_id`,
  ]);
  const owned = new Map(owners.map((o) => [o.banner_id as number, o.n as number]));
  const setName = new Map(sets.map((s) => [s.id, s.name]));
  return (
    <>
      <Flash ok={q.ok} error={q.error} />
      <section>
        <h2>Banners</h2>
        <p className="lede">Upload art to replace a placeholder: a wide picture, about 4:1 (1600 × 400 works well), PNG, JPEG or WebP, or a short WebM or MP4 for an animated banner. Up to 4 MB. Defaults belong to everyone; the rest are rolled or bought from their set.</p>
        <details className="card"><summary><strong>Add a banner</strong></summary><BannerForm sets={sets} /></details>
        <div className="admin-banners">
          {banners.map((b) => (
            <details key={b.id} className="card" open={q.edit === String(b.id)}>
              <summary className="banner-summary">
                <BannerArt b={toBanner(b)} />
                <span><span className={`rarity-tag rarity-${b.rarity}`}>{RARITY_LABEL[b.rarity as Rarity]}</span> <strong>{b.name}</strong>
                  <span className="muted"> · {b.is_default ? "default (everyone)" : setName.get(b.set_id) ?? "no set"}{b.buyable ? " · buyable" : ""}{b.active ? "" : " · retired"} · {b.is_default ? "owned by everyone" : `owned by ${owned.get(b.id) ?? 0}`}{b.image_url ? "" : " · placeholder art"}</span></span>
              </summary>
              <BannerForm sets={sets} b={b} />
              <form action={deleteBanner}><input type="hidden" name="id" value={b.id} /><ConfirmButton message={`Delete ${b.name}?`}>Delete banner</ConfirmButton></form>
            </details>
          ))}
        </div>
      </section>
      <section>
        <h2>Sets</h2>
        <p className="lede">A set is what members roll on. Limited sets can have start and end dates and their own rates; the shop shows open sets only. Rates are percentages and must add up to 100.</p>
        {sets.map((s) => (
          <details key={s.id} className="card"><summary><strong>{s.name}</strong> <span className="muted">· {s.kind}{s.active ? "" : " · hidden"} · roll {s.rollCost}</span></summary>
            <SetForm s={s} banners={banners.filter((b) => b.set_id === s.id)} /></details>
        ))}
        <details className="card"><summary><strong>Add a set</strong></summary><SetForm banners={[]} /></details>
      </section>
    </>
  );
}

function BannerForm({ sets, b }: { sets: BannerSet[]; b?: Record<string, unknown> }) {
  return (
    <form action={saveBannerAction} className="admin-form">
      {b && <input type="hidden" name="id" value={b.id as number} />}
      <div className="row">
        <label className="field"><span className="label">Name</span><input name="name" type="text" defaultValue={(b?.name as string) ?? ""} maxLength={40} required /></label>
        <label className="field"><span className="label">Rarity</span><select name="rarity" defaultValue={(b?.rarity as string) ?? "common"}>{RARITIES.map((r) => <option key={r} value={r}>{RARITY_LABEL[r]}</option>)}</select></label>
        <label className="field"><span className="label">Set</span><select name="set_id" defaultValue={String(b?.set_id ?? sets[0]?.id ?? "")}><option value="">None</option>{sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      </div>
      <div className="row">
        <label className="field"><span className="label">Art</span><input name="art" type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/webm,video/mp4" /></label>
        <label className="field"><span className="label">Artist credit</span><input name="credit" type="text" defaultValue={(b?.credit as string) ?? ""} maxLength={80} /></label>
        <label className="field"><span className="label">Price if bought</span><input name="price" type="number" min={1} defaultValue={(b?.price as number) ?? ""} placeholder={`default ${RARITY_PRICE[((b?.rarity as Rarity) ?? "common")]}`} /></label>
      </div>
      <div className="row checks">
        <label><input type="checkbox" name="buyable" defaultChecked={Boolean(b?.buyable)} /> Can be bought outright</label>
        <label><input type="checkbox" name="is_default" defaultChecked={Boolean(b?.is_default)} /> Default: everyone owns it</label>
        <label><input type="hidden" name="active" value="off" /><input type="checkbox" name="active" value="on" defaultChecked={b ? Boolean(b.active) : true} /> Active</label>
        {b?.image_url ? <label><input type="checkbox" name="clear_art" /> Go back to placeholder art</label> : null}
      </div>
      <button className="btn">{b ? "Save banner" : "Add banner"}</button>
    </form>
  );
}

function SetForm({ s, banners }: { s?: BannerSet; banners: Record<string, unknown>[] }) {
  return (
    <form action={saveSetAction} className="admin-form">
      {s && <input type="hidden" name="id" value={s.id} />}
      <div className="row">
        <label className="field"><span className="label">Name</span><input name="name" type="text" defaultValue={s?.name ?? ""} maxLength={40} required /></label>
        <label className="field"><span className="label">Address</span><input name="slug" type="text" defaultValue={s?.slug ?? ""} placeholder="from the name" /></label>
        <label className="field"><span className="label">Kind</span><select name="kind" defaultValue={s?.kind ?? "limited"}><option value="standard">Standard</option><option value="limited">Limited</option></select></label>
      </div>
      <label className="field"><span className="label">Description</span><input name="description" type="text" defaultValue={s?.description ?? ""} maxLength={300} /></label>
      <div className="row">
        <label className="field"><span className="label">Opens (Irish time)</span><input name="starts_at" type="datetime-local" defaultValue={toInputValue(s?.startsAt)} /></label>
        <label className="field"><span className="label">Closes</span><input name="ends_at" type="datetime-local" defaultValue={toInputValue(s?.endsAt)} /></label>
        <label className="field"><span className="label">Roll cost</span><input name="roll_cost" type="number" min={1} defaultValue={s?.rollCost ?? 1000} required /></label>
        <label className="field"><span className="label">Pity (0 = off)</span><input name="pity" type="number" min={0} defaultValue={s?.pity ?? 60} /></label>
      </div>
      <div className="row">
        {RARITIES.map((r) => (
          <div key={r} className="field"><label>{RARITY_LABEL[r]} %</label><input name={`rate_${r}`} type="number" step="0.1" min={0} defaultValue={s?.rates[r] ?? { common: 56, rare: 30, epic: 11, legendary: 2.5, ultimate: 0.5 }[r]} style={{ width: "6em" }} /></div>
        ))}
      </div>
      <div className="row checks">
        <label className="field"><span className="label">Featured banner</span><select name="featured_banner_id" defaultValue={String(s?.featuredBannerId ?? "")}><option value="">None</option>{banners.map((b) => <option key={b.id as number} value={b.id as number}>{b.name as string}</option>)}</select></label>
        <label><input type="checkbox" name="active" defaultChecked={s ? s.active : true} /> In the shop</label>
      </div>
      <button className="btn">{s ? "Save set" : "Add set"}</button>
    </form>
  );
}
