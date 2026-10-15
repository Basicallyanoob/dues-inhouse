import { NextResponse, type NextRequest } from "next/server";
import { announceResults, postImportSummary } from "@/lib/discord/schedule";
import { checkEveryoneIfDue } from "@/lib/dues";
import { FetchError, fetchBatch } from "@/lib/val/fetch";

export const maxDuration = 60;

/**
 * The full import: every linked Riot ID. Called on Sunday morning and afternoon
 * by .github/workflows/schedule.yml (and weekly by Vercel Cron as a fallback),
 * with CRON_SECRET as a bearer token. One call checks as many accounts as fit
 * in 50 seconds; the workflow calls again while `remaining` is above 0.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  try {
    // DUES member roles first, in a short slot (twice a day at most), then the games.
    const members = await checkEveryoneIfDue().catch((e) => ({ error: `could not check DUES member roles: ${(e as Error).message}` }));
    const report = await fetchBatch({ since: new Date(Date.now() - 3 * 3600 * 1000), budgetMs: members ? 38000 : 50000 });
    const posted = await announceResults(report).catch((e) => [`could not post results: ${(e as Error).message}`]);
    await postImportSummary(report).catch((e) => console.error("could not post the import summary", e));
    return NextResponse.json({ ...report, posted, ...(members ? { members } : {}) });
  } catch (e) {
    if (e instanceof FetchError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
