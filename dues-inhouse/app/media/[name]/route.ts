/** Local development only: serves banner art saved in .data/uploads. */
import fs from "node:fs/promises";
import path from "node:path";
import { TYPES } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!/^[0-9a-f-]{36}\.[a-z0-9]{3,4}$/.test(name)) return new Response("Not found", { status: 404 });
  try {
    const bytes = await fs.readFile(path.join(process.cwd(), ".data", "uploads", name));
    const type = Object.entries(TYPES).find(([, ext]) => name.endsWith(`.${ext}`))?.[0] ?? "application/octet-stream";
    return new Response(new Uint8Array(bytes), { headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
