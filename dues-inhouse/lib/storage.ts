/**
 * Banner art storage. In production: a public Supabase Storage bucket called
 * "banners". Without Supabase (local development): files in .data/uploads,
 * served by /media.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "banners";

export class StorageError extends Error {}
export const MAX_BYTES = 4 * 1024 * 1024; // under Vercel's 4.5 MB request limit
export const TYPES: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "video/webm": "webm", "video/mp4": "mp4",
};

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

export async function saveBannerFile(file: File): Promise<{ url: string; media: "image" | "video" }> {
  const ext = TYPES[file.type];
  if (!ext) throw new StorageError("Use a PNG, JPEG, WebP or GIF picture, or a WebM or MP4 video.");
  if (file.size > MAX_BYTES) throw new StorageError("That file is over 4 MB. Make it smaller first.");
  const name = `${randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const media = file.type.startsWith("video/") ? "video" : "image";
  const sb = admin();
  if (sb) {
    const { data: buckets } = await sb.storage.listBuckets();
    if (!buckets?.some((b) => b.name === BUCKET)) await sb.storage.createBucket(BUCKET, { public: true });
    const { error } = await sb.storage.from(BUCKET).upload(name, bytes, { contentType: file.type, upsert: false });
    if (error) throw new StorageError(`Upload failed: ${error.message}`);
    return { url: sb.storage.from(BUCKET).getPublicUrl(name).data.publicUrl, media };
  }
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    throw new StorageError("Banner uploads need SUPABASE_SERVICE_ROLE_KEY set in the site's environment variables (see the README).");
  }
  const dir = path.join(process.cwd(), ".data", "uploads");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), bytes);
  return { url: `/media/${name}`, media };
}
