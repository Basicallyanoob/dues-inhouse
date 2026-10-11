"use server";
/** Form actions. Each checks who is asking, does one thing, and returns to the page with a message. */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError, DEV_COOKIE, devLogin, requireOfficer, requireViewer, isAdmin, safePath } from "@/lib/auth";
import { CatalogError, createCode, saveBanner, saveSet } from "@/lib/catalog";
import { db } from "@/lib/db";
import { deleteGame } from "@/lib/ingest";
import {
  MemberError, addRosterMember, adjustCoins, approveLink, importRoster, rejectLink, removeLink, requestLink, setRole, updateProfile,
} from "@/lib/members";
import { ShopError, buy, equip, redeem } from "@/lib/shop";
import { StorageError } from "@/lib/storage";
import { isGame } from "@/lib/games";

const KNOWN = [AuthError, MemberError, ShopError, CatalogError, StorageError];

function back(path: string, kind: "ok" | "error", message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${kind}=${encodeURIComponent(message)}`);
}

/** Run an action; friendly errors go back to the page, anything else is a real bug and is thrown. */
async function attempt(path: string, ok: string, fn: () => Promise<string | void>) {
  let message: string | void;
  try {
    message = await fn();
  } catch (e) {
    if (KNOWN.some((K) => e instanceof K)) back(path, "error", (e as Error).message);
    throw e;
  }
  back(path, "ok", message || ok);
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const int = (f: FormData, k: string) => Number.parseInt(str(f, k), 10);

// ---------- members ----------

export async function linkAccount(f: FormData) {
  await attempt("/me", "Sent to the officers for approval.", async () => {
    const v = await requireViewer();
    const game = str(f, "game");
    if (!isGame(game)) throw new MemberError("Pick a game.");
    await requestLink(v.id, game, str(f, "account"));
  });
}

export async function unlinkAccount(f: FormData) {
  await attempt("/me", "Account removed.", async () => {
    const v = await requireViewer();
    await removeLink(v.id, int(f, "id"), false);
  });
}

export async function saveProfile(f: FormData) {
  await attempt("/me", "Saved.", async () => {
    const v = await requireViewer();
    await updateProfile(v.id, str(f, "name"), str(f, "note"));
  });
}

export async function equipBanner(f: FormData) {
  const to = str(f, "back");
  await attempt(safePath(to, "/me"), "Banner equipped.", async () => {
    const v = await requireViewer();
    const id = str(f, "banner_id");
    await equip(v.id, id ? Number(id) : null);
  });
}

export async function redeemCode(f: FormData) {
  await attempt("/me", "", async () => {
    const v = await requireViewer();
    return redeem(v.id, str(f, "code"));
  });
}

export async function buyBanner(f: FormData) {
  const set = str(f, "set");
  await attempt(`/shop${set ? `?set=${encodeURIComponent(set)}` : ""}`, "Bought. It's in your collection.", async () => {
    const v = await requireViewer();
    await buy(v.id, int(f, "banner_id"));
  });
}

export async function devSignIn(f: FormData) {
  if (!devLogin()) redirect("/login");
  (await cookies()).set(DEV_COOKIE, str(f, "id"), { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}

// ---------- officers ----------

export async function approve(f: FormData) {
  await attempt("/admin", "Linked. Their games, and the Crests for them, are on their profile now.", async () => {
    const o = await requireOfficer();
    const [mine] = await db()`select 1 from game_accounts where id = ${int(f, "id")} and player_id = ${o.id}`;
    if (mine && !isAdmin(o)) throw new MemberError("Ask another officer to approve your own accounts.");
    await approveLink(int(f, "id"), o.id);
  });
}

export async function reject(f: FormData) {
  await attempt("/admin", "Request declined.", async () => {
    const o = await requireOfficer();
    await rejectLink(int(f, "id"), o.id);
  });
}

export async function officerUnlink(f: FormData) {
  await attempt("/admin/members", "Account removed.", async () => {
    const o = await requireOfficer();
    await removeLink(o.id, int(f, "id"), true);
  });
}

export async function addMember(f: FormData) {
  await attempt("/admin/members", "Added to the roster.", async () => {
    const o = await requireOfficer();
    const list = (k: string) => str(f, k).split(/[;,\n]/).map((x) => x.trim()).filter(Boolean);
    await addRosterMember(str(f, "name"), list("battletags"), list("riot_ids"), o.id);
  });
}

export async function uploadRoster(f: FormData) {
  const file = f.get("file");
  let lines: string[] = [];
  await attempt("/admin/members", "", async () => {
    const o = await requireOfficer();
    if (!(file instanceof File) || !file.size) throw new MemberError("Choose a CSV file.");
    lines = await importRoster(await file.text(), o.id);
    return `Roster: ${lines.slice(0, 12).join("; ")}${lines.length > 12 ? `; and ${lines.length - 12} more` : ""}`;
  });
}

export async function changeRole(f: FormData) {
  await attempt("/admin/members", "Role changed.", async () => {
    const v = await requireViewer();
    if (!isAdmin(v)) throw new AuthError("Only admins can change roles.");
    const role = str(f, "role");
    if (!["member", "officer", "admin"].includes(role)) throw new MemberError("Unknown role.");
    if (str(f, "id") === v.id && role !== "admin") throw new MemberError("You can't demote yourself; ask another admin.");
    await setRole(str(f, "id"), role as "member" | "officer" | "admin");
  });
}

export async function giveCoins(f: FormData) {
  await attempt("/admin/members", "Coins adjusted.", async () => {
    const o = await requireOfficer();
    if (str(f, "id") === o.id && !isAdmin(o)) throw new MemberError("Ask an admin to adjust your own Crests.");
    await adjustCoins(str(f, "id"), int(f, "amount"), str(f, "note"), o.id);
  });
}

export async function removeGame(f: FormData) {
  await attempt("/admin/games", "Game removed, and the Crests it paid taken back.", async () => {
    await requireOfficer();
    const game = str(f, "game");
    if (!isGame(game)) throw new MemberError("Unknown game.");
    await deleteGame(game, str(f, "id"));
  });
}

export async function saveBannerAction(f: FormData) {
  await attempt("/admin/banners", "Banner saved.", async () => {
    await requireOfficer();
    await saveBanner(f);
  });
}

export async function deleteBanner(f: FormData) {
  await attempt("/admin/banners", "Banner deleted.", async () => {
    await requireOfficer();
    const id = int(f, "id");
    const [{ n }] = await db()`select count(*)::int as n from owned_banners where banner_id = ${id}`;
    if (n > 0) throw new CatalogError(`${n} member${n === 1 ? " owns" : "s own"} it, so retire it instead (untick Active).`);
    await db()`delete from banners where id = ${id}`;
  });
}

export async function saveSetAction(f: FormData) {
  await attempt("/admin/banners", "Set saved.", async () => {
    await requireOfficer();
    await saveSet(f);
  });
}

export async function createCodeAction(f: FormData) {
  await attempt("/admin/codes", "Code created.", async () => {
    const o = await requireOfficer();
    await createCode(f, o.id);
  });
}

export async function deleteCode(f: FormData) {
  await attempt("/admin/codes", "Code deleted.", async () => {
    await requireOfficer();
    await db()`delete from promo_codes where code = ${str(f, "code")}`;
  });
}
