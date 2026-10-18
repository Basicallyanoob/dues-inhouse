/** Keeps the Supabase sign-in session fresh on every page load. */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let response = NextResponse.next({ request });
  if (!url || !key) return response;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  // Refreshes an expired session; otherwise verifies the token locally rather than asking Supabase Auth on every click.
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  // Discord and the scheduled checks carry no sign-in cookie; skipping them saves a Supabase call per request.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.png|fonts/|api/cron|api/discord).*)"],
};
