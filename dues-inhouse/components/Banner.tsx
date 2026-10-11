import type { Rarity } from "@/lib/economy";

export interface BannerInfo {
  id: number;
  name: string;
  rarity: Rarity;
  imageUrl: string | null;
  media: "image" | "video";
}

/** A banner's art, or a placeholder in its rarity colour until an officer uploads art. */
export function BannerArt({ b, className = "" }: { b: BannerInfo | null; className?: string }) {
  if (!b) return <div className={`banner-art placeholder rarity-common ${className}`} aria-hidden />;
  if (b.imageUrl && b.media === "video") {
    return (
      <div className={`banner-art rarity-${b.rarity} ${className}`}>
        <video src={b.imageUrl} autoPlay muted loop playsInline aria-label={b.name} />
      </div>
    );
  }
  if (b.imageUrl) {
    return (
      <div className={`banner-art rarity-${b.rarity} ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={b.imageUrl} alt={b.name} loading="lazy" />
      </div>
    );
  }
  return (
    <div className={`banner-art placeholder rarity-${b.rarity} ${className}`} role="img" aria-label={`${b.name} (placeholder art)`}>
      <span className="ph-name">{b.name}</span>
    </div>
  );
}

export const toBanner = (r: Record<string, unknown>): BannerInfo => ({
  id: r.id as number, name: r.name as string, rarity: r.rarity as Rarity,
  imageUrl: (r.image_url as string) ?? null, media: (r.media as "image" | "video") ?? "image",
});
