/** Officers' side of the shop: banners, sets and promo codes. */
import { db } from "./db";
import { DEFAULT_RATES, RARITIES, type Rarity } from "./economy";
import { saveBannerFile } from "./storage";
import { zonedToUtc } from "./time";

export class CatalogError extends Error {}

const rarityOf = (x: FormDataEntryValue | null): Rarity => {
  const r = String(x ?? "") as Rarity;
  if (!RARITIES.includes(r)) throw new CatalogError("Pick a rarity.");
  return r;
};
const intOrNull = (x: FormDataEntryValue | null) => {
  const s = String(x ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) throw new CatalogError(`'${s}' should be a whole number.`);
  return n;
};
/** Date pickers send Irish wall-clock time with no zone. */
const dateOrNull = (x: FormDataEntryValue | null) => {
  const s = String(x ?? "").trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(s);
  const d = m ? zonedToUtc(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), 0) : new Date(s);
  if (Number.isNaN(d.getTime())) throw new CatalogError(`'${s}' is not a date.`);
  return d;
};

export async function saveBanner(form: FormData): Promise<number> {
  const id = intOrNull(form.get("id"));
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 40) throw new CatalogError("Give the banner a name of up to 40 characters.");
  const rarity = rarityOf(form.get("rarity"));
  const setId = intOrNull(form.get("set_id"));
  const isDefault = form.get("is_default") === "on";
  const fields = {
    name, rarity, set_id: isDefault ? null : setId, credit: String(form.get("credit") ?? "").trim().slice(0, 80),
    buyable: form.get("buyable") === "on", price: intOrNull(form.get("price")), is_default: isDefault,
    active: form.getAll("active").includes("on"),
  };
  const file = form.get("art");
  let art: { image_url?: string; media?: string } = {};
  if (file instanceof File && file.size > 0) {
    const saved = await saveBannerFile(file);
    art = { image_url: saved.url, media: saved.media };
  }
  if (form.get("clear_art") === "on") art = { image_url: null as unknown as string, media: "image" };
  const sql = db();
  if (id) {
    await sql`update banners set ${sql({ ...fields, ...art } as Record<string, unknown>)} where id = ${id}`;
    return id;
  }
  const [row] = await sql`insert into banners ${sql({ ...fields, ...art } as Record<string, unknown>)} returning id`;
  return row.id;
}

export async function saveSet(form: FormData): Promise<number> {
  const id = intOrNull(form.get("id"));
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 40) throw new CatalogError("Give the set a name of up to 40 characters.");
  const slug = (String(form.get("slug") ?? "").trim() || name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const rates: Record<string, number> = {};
  for (const r of RARITIES) {
    const v = Number(String(form.get(`rate_${r}`) ?? DEFAULT_RATES[r]));
    if (!Number.isFinite(v) || v < 0) throw new CatalogError(`The ${r} rate should be a number.`);
    rates[r] = v;
  }
  const total = Object.values(rates).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 100) > 0.01) throw new CatalogError(`The rates add up to ${total}%; they need to make 100%.`);
  const fields = {
    name, slug, description: String(form.get("description") ?? "").trim().slice(0, 300),
    kind: form.get("kind") === "limited" ? "limited" : "standard", active: form.get("active") === "on",
    starts_at: dateOrNull(form.get("starts_at")), ends_at: dateOrNull(form.get("ends_at")),
    roll_cost: intOrNull(form.get("roll_cost")) ?? 1000, pity: intOrNull(form.get("pity")) ?? 0,
    featured_banner_id: intOrNull(form.get("featured_banner_id")), rates,
  };
  if (fields.roll_cost < 1) throw new CatalogError("A roll has to cost something.");
  const sql = db();
  const row = { ...fields, rates: sql.json(rates) } as Record<string, unknown>;
  try {
    if (id) {
      await sql`update banner_sets set ${sql(row)} where id = ${id}`;
      return id;
    }
    const [r] = await sql`insert into banner_sets ${sql(row)} returning id`;
    return r.id;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new CatalogError(`Another set already uses the address '${slug}'.`);
    throw e;
  }
}

export async function createCode(form: FormData, officerId: string) {
  const code = String(form.get("code") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new CatalogError("Codes are 3 to 32 letters, numbers, - or _.");
  const reward = form.get("reward") === "banner" ? "banner" : "coins";
  const amount = intOrNull(form.get("amount")) ?? 0;
  const bannerId = intOrNull(form.get("banner_id"));
  if (reward === "coins" && amount <= 0) throw new CatalogError("How many Crests should it give?");
  if (reward === "banner" && !bannerId) throw new CatalogError("Pick the banner it gives.");
  try {
    await db()`insert into promo_codes (code, reward, amount, banner_id, max_uses, expires_at, created_by)
               values (${code}, ${reward}, ${reward === "coins" ? amount : 0}, ${reward === "banner" ? bannerId : null},
                       ${intOrNull(form.get("max_uses"))}, ${dateOrNull(form.get("expires_at"))}, ${officerId})`;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new CatalogError("That code already exists.");
    throw e;
  }
}
