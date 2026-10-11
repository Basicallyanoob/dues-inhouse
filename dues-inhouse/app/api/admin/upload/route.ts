import { sameOrigin } from "@/lib/origin";
import { NextResponse, type NextRequest } from "next/server";
import { getViewer, isOfficer } from "@/lib/auth";
import { processUploads } from "@/lib/uploads";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Wrong origin." }, { status: 403 });
  const v = await getViewer();
  if (!isOfficer(v)) return NextResponse.json({ error: "Officers only." }, { status: 403 });
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const parts = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  return NextResponse.json({ results: await processUploads(parts, v!.id) });
}
