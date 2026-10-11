/** URL-safe page names that keep non-Latin names distinct. */
export function slugify(name: string): string {
  const ascii = name.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  let slug = ascii.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const plain = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug || slug !== plain) {
    const hex = [...name].map((c) => c.codePointAt(0)!.toString(16)).join("").slice(0, 16);
    slug = (slug ? `${slug}-` : "p-") + hex;
  }
  return slug.slice(0, 60);
}
