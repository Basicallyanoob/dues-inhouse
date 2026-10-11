import { NextResponse, type NextRequest } from "next/server";
import { FetchError, fetchBatch } from "@/lib/val/fetch";

export const maxDuration = 60;

/** Called by Vercel Cron every morning (vercel.json), with CRON_SECRET as a bearer token. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  try {
    return NextResponse.json(await fetchBatch({ since: new Date(Date.now() - 12 * 3600 * 1000), budgetMs: 50000 }));
  } catch (e) {
    if (e instanceof FetchError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
