import { NextResponse, type NextRequest } from "next/server";
import { sessionTick } from "@/lib/discord/schedule";

export const maxDuration = 60;

/**
 * The weekly session's scheduled check, called every ~10 minutes on Saturday
 * evenings by .github/workflows/schedule.yml with CRON_SECRET as a bearer token.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  return NextResponse.json(await sessionTick());
}
