import { sameOrigin } from "@/lib/origin";
import { NextResponse, type NextRequest } from "next/server";
import { getViewer, isOfficer } from "@/lib/auth";
import { FetchError, fetchBatch } from "@/lib/val/fetch";

export const maxDuration = 60;

/** One batch of anchors; the admin page calls this repeatedly until nothing remains. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Wrong origin." }, { status: 403 });
  const v = await getViewer();
  if (!isOfficer(v)) return NextResponse.json({ error: "Officers only." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const since = body.since ? new Date(body.since) : new Date();
  try {
    return NextResponse.json(await fetchBatch({ since, budgetMs: 45000, uploader: v!.id }));
  } catch (e) {
    if (e instanceof FetchError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
