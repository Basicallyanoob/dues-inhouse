import type { NextRequest } from "next/server";

/** Refuse cross-site form posts to the JSON endpoints (sign-in cookies are SameSite=Lax as well). */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetches from older browsers, and server-to-server calls
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}
