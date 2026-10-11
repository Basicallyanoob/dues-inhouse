import { NextResponse, type NextRequest } from "next/server";
import { DEV_COOKIE } from "@/lib/auth";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  if (supabaseConfigured()) await (await supabaseServer()).auth.signOut();
  const res = NextResponse.redirect(new URL("/", req.url), { status: 303 });
  res.cookies.delete(DEV_COOKIE);
  return res;
}
