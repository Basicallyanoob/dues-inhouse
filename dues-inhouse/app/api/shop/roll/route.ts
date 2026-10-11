import { sameOrigin } from "@/lib/origin";
import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth";
import { db } from "@/lib/db";
import { ShopError, roll } from "@/lib/shop";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Wrong origin." }, { status: 403 });
  const v = await getViewer();
  if (!v) return NextResponse.json({ error: "Sign in to roll." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const setId = Number(body.setId);
  const count = body.count === 10 ? 10 : 1;
  if (!Number.isInteger(setId)) return NextResponse.json({ error: "Which set?" }, { status: 400 });
  try {
    const out = await roll(v.id, setId, count);
    const ids = out.results.map((r) => r.bannerId);
    const art = await db()`select id, image_url, media from banners where id = any(${ids})`;
    const byId = new Map(art.map((a) => [a.id, a]));
    return NextResponse.json({
      balance: out.balance,
      results: out.results.map((r) => ({ ...r, imageUrl: byId.get(r.bannerId)?.image_url ?? null, media: byId.get(r.bannerId)?.media ?? "image" })),
    });
  } catch (e) {
    if (e instanceof ShopError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
