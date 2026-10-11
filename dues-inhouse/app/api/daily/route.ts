import { sameOrigin } from "@/lib/origin";
import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth";
import { ShopError, claimDaily } from "@/lib/shop";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Wrong origin." }, { status: 403 });
  const v = await getViewer();
  if (!v) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    return NextResponse.json({ amount: await claimDaily(v.id) });
  } catch (e) {
    if (e instanceof ShopError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
