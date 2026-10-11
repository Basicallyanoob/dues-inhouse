import { NextResponse, type NextRequest } from "next/server";
import { AuthError, ensurePlayer } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { safeNext } from "../login/route";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  if (!code) return NextResponse.redirect(new URL("/login?error=discord", req.url));
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(new URL("/login?error=discord", req.url));
  try {
    await ensurePlayer(data.user);
  } catch (e) {
    if (e instanceof AuthError) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/login?error=discord", req.url));
    }
    throw e;
  }
  return NextResponse.redirect(new URL(next, req.url));
}
