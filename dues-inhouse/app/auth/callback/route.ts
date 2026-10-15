import { NextResponse, type NextRequest } from "next/server";
import { AuthError, ensurePlayer } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { checkOne } from "@/lib/dues";
import { db } from "@/lib/db";
import { safeNext } from "../login/route";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  if (!code) return NextResponse.redirect(new URL("/login?error=discord", req.url));
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(new URL("/login?error=discord", req.url));
  try {
    const playerId = await ensurePlayer(data.user);
    await checkSignedIn(playerId);
  } catch (e) {
    if (e instanceof AuthError) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/login?error=discord", req.url));
    }
    throw e;
  }
  return NextResponse.redirect(new URL(next, req.url));
}

/** Read their DUES member role from Discord. Sign-in carries on if Discord is slow or the bot isn't set up. */
async function checkSignedIn(playerId: string) {
  try {
    const [p] = await db()`select discord_id from players where id = ${playerId}`;
    if (p?.discord_id) await Promise.race([checkOne(p.discord_id), new Promise((r) => setTimeout(r, 4000))]);
  } catch (e) {
    console.error("could not check the DUES member role", e);
  }
}
