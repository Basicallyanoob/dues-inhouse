"use server";
/** Form actions. Each checks who is asking, does one thing, and returns to the page with a message. */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError, DEV_COOKIE, devLogin, requireOfficer, requireViewer, isAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteGame } from "@/lib/ingest";
import {
  MemberError, addRosterMember, approveLink, importRoster, rejectLink, removeLink, requestLink, setRole, updateProfile,
} from "@/lib/members";
import { isGame } from "@/lib/games";
import { checkEveryone, setDues } from "@/lib/dues";
import { setSeasonStart } from "@/lib/seasons";
import { DiscordError } from "@/lib/discord/api";

const KNOWN = [AuthError, MemberError];

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

export async function devSignIn(f: FormData) {
  if (!devLogin()) redirect("/login");
  (await cookies()).set(DEV_COOKIE, str(f, "id"), { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}

// ---------- officers ----------

export async function approve(f: FormData) {
  await attempt("/admin", "Linked. Their games are on their profile now.", async () => {
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

/** An officer marks someone as a DUES member or not. */
export async function setDuesMember(f: FormData) {
  await attempt("/admin/members", "DUES membership saved.", async () => {
    await requireOfficer();
    const v = str(f, "dues");
    if (!["yes", "no"].includes(v)) throw new MemberError("Pick Yes or No.");
    await setDues(str(f, "id"), v === "yes");
  });
}

/** Read everyone's member role from Discord now, rather than waiting for Sunday. */
export async function checkDuesRoles() {
  await attempt("/admin/members", "", async () => {
    await requireOfficer();
    let r;
    try {
      r = await checkEveryone();
    } catch (e) {
      if (e instanceof DiscordError) throw new MemberError(`Discord said no: ${e.message.slice(0, 160)}`);
      throw e;
    }
    if (!r.ok) throw new MemberError(r.note ?? "Couldn't check the Discord roles.");
    return [
      `Checked ${r.checked} ${r.checked === 1 ? "person" : "people"} for the ${r.role} role: ${r.changed} changed, ${r.members} DUES members now.`,
      r.remaining ? `${r.remaining} still to check; press again.` : "",
      r.note ?? "",
    ].filter(Boolean).join(" ");
  });
}

/** Start a new season: only games from that day count. Empty to count every game again. */
export async function setSeason(f: FormData) {
  await attempt("/admin/games", "", async () => {
    await requireOfficer();
    const day = str(f, "day").trim();
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new MemberError("Pick a date.");
    await setSeasonStart(day || null);
    return day ? `New season from ${day}. Ratings now count only games from then on.` : "Every game counts again.";
  });
}

export async function removeGame(f: FormData) {
  await attempt("/admin/games", "Game removed.", async () => {
    await requireOfficer();
    const game = str(f, "game");
    if (!isGame(game)) throw new MemberError("Unknown game.");
    await deleteGame(game, str(f, "id"));
  });
}
