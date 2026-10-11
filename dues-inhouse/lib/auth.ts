/** Who is looking at the page. Members sign in with Discord through Supabase Auth. */
import { cookies } from "next/headers";
import { cache } from "react";
import { bumpDataVersion, db } from "./db";
import { slugify } from "./slug";
import { supabaseConfigured, supabaseServer } from "./supabase";

export type Role = "member" | "officer" | "admin";

export interface Viewer {
  id: string;
  name: string;
  slug: string;
  avatarUrl: string | null;
  role: Role;
  bannerId: number | null;
}

/** Development only: pretend to be a player without Discord (DEV_LOGIN=1, never in production). */
export const devLogin = () => process.env.DEV_LOGIN === "1" && process.env.NODE_ENV !== "production";
export const DEV_COOKIE = "dues_dev_player";

export const getViewer = cache(async (): Promise<Viewer | null> => {
  let row;
  if (devLogin()) {
    const id = (await cookies()).get(DEV_COOKIE)?.value;
    if (id && /^[0-9a-f-]{36}$/.test(id)) [row] = await db()`select * from players where id = ${id}`;
  }
  if (!row && supabaseConfigured()) {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    if (data.user) [row] = await db()`select * from players where auth_id = ${data.user.id}`;
  }
  if (!row) return null;
  return { id: row.id, name: row.display_name, slug: row.slug, avatarUrl: row.avatar_url, role: row.role, bannerId: row.banner_id };
});

export const isOfficer = (v: Viewer | null) => v?.role === "officer" || v?.role === "admin";
export const isAdmin = (v: Viewer | null) => v?.role === "admin";

export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) throw new AuthError("Sign in first.");
  return v;
}

export async function requireOfficer(): Promise<Viewer> {
  const v = await requireViewer();
  if (!isOfficer(v)) throw new AuthError("Only officers can do that.");
  return v;
}

export class AuthError extends Error {}

/** For admin pages: anyone who isn't an officer gets a 404, and nothing of the page is rendered. */
export async function officerPage(): Promise<Viewer> {
  const { notFound } = await import("next/navigation");
  const v = await getViewer();
  if (!isOfficer(v)) notFound();
  return v!;
}

/** Only same-site paths: no protocol-relative, backslash or control-character tricks. */
export function safePath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || /[\\\u0000-\u001f]/.test(next) || next.startsWith("//")) return fallback;
  try {
    const u = new URL(next, "https://dues.invalid");
    return u.origin === "https://dues.invalid" ? `${u.pathname}${u.search}${u.hash}` : fallback;
  } catch {
    return fallback;
  }
}

export async function uniqueSlug(name: string, exceptId?: string): Promise<string> {
  const base = slugify(name) || "player";
  let slug = base;
  for (let n = 2; ; n++) {
    const [hit] = await db()`select id from players where slug = ${slug}`;
    if (!hit || hit.id === exceptId) return slug;
    slug = `${base}-${n}`;
  }
}

/**
 * First sign-in creates the member; later sign-ins refresh their Discord name
 * and picture. The Discord id comes from the provider identity, which users
 * can't edit (unlike user_metadata).
 */
export async function ensurePlayer(user: {
  id: string;
  identities?: { provider: string; id?: string; identity_data?: Record<string, unknown> }[] | null;
}): Promise<string> {
  const ident = user.identities?.find((i) => i.provider === "discord");
  if (!ident) throw new AuthError("Only Discord sign-in is supported.");
  const data = ident.identity_data ?? {};
  const discordId = String(data.provider_id ?? data.sub ?? ident.id ?? "");
  if (!discordId) throw new AuthError("Discord didn't send an account id.");
  const claims = (data.custom_claims ?? {}) as Record<string, unknown>;
  const name = String(claims.global_name ?? data.full_name ?? data.name ?? "Member").replace(/#0$/, "").slice(0, 40) || "Member";
  const avatar = (data.avatar_url as string) ?? null;
  const isAdminId = (process.env.ADMIN_DISCORD_IDS ?? "").split(/[,\s]+/).filter(Boolean).includes(discordId);
  const sql = db();
  const [existing] = await sql`select id from players where auth_id = ${user.id} or discord_id = ${discordId}`;
  if (existing) {
    await sql`update players set auth_id = ${user.id}, discord_id = ${discordId}, avatar_url = ${avatar},
              role = case when ${isAdminId} then 'admin' else role end where id = ${existing.id}`;
    return existing.id;
  }
  try {
    const [row] = await sql`
      insert into players (auth_id, discord_id, display_name, slug, avatar_url, role)
      values (${user.id}, ${discordId}, ${name}, ${await uniqueSlug(name)}, ${avatar}, ${isAdminId ? "admin" : "member"})
      returning id`;
    await bumpDataVersion();
    return row.id;
  } catch (e) {
    // Two tabs finishing sign-in at once: the other one created the row.
    if ((e as { code?: string }).code !== "23505") throw e;
    const [again] = await sql`select id from players where auth_id = ${user.id} or discord_id = ${discordId}`;
    if (!again) throw e;
    return again.id;
  }
}
