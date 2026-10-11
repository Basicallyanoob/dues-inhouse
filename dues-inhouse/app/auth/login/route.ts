import { NextResponse, type NextRequest } from "next/server";
import { safePath } from "@/lib/auth";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  if (!supabaseConfigured()) return NextResponse.redirect(new URL(`/login?error=setup`, req.url));
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: `${req.nextUrl.origin}/auth/callback?next=${encodeURIComponent(next)}`, scopes: "identify" },
  });
  if (error || !data.url) return NextResponse.redirect(new URL(`/login?error=discord`, req.url));
  return NextResponse.redirect(data.url);
}

export function safeNext(next: string | null): string {
  return safePath(next, "/");
}
