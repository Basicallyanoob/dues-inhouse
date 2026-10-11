"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BannerArt, type BannerInfo } from "./Banner";

interface Result extends BannerInfo { duplicate: boolean; refund: number; pity: boolean; bannerId: number }

const LABEL: Record<string, string> = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary", ultimate: "Ultimate" };
const ORDER = ["common", "rare", "epic", "legendary", "ultimate"];

/** Roll buttons and the card-flip reveal. The result is decided on the server before anything animates. */
export function RollPanel({ setId, cost, signedIn, currency }: { setId: number; cost: number; signedIn: boolean; currency: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [shown, setShown] = useState(0);

  async function go(count: 1 | 10) {
    setBusy(true);
    setError(null);
    setResults([]);
    setShown(0);
    const res = await fetch("/api/shop/roll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ setId, count }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(body.error ?? "Something went wrong. Try again."); return; }
    const list: Result[] = body.results.map((r: Record<string, unknown>) => ({ ...r, id: r.bannerId }));
    setResults(list);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.forEach((_, i) => setTimeout(() => setShown(i + 1), reduce ? 0 : 450 + i * 280));
    router.refresh();
  }

  const best = results.reduce((b, r) => Math.max(b, ORDER.indexOf(r.rarity)), -1);
  return (
    <div>
      <div className="roll-actions">
        {signedIn ? (
          <>
            <button className="btn" type="button" disabled={busy} onClick={() => go(1)}>Roll · {cost.toLocaleString("en-IE")}</button>
            <button className="btn" type="button" disabled={busy} onClick={() => go(10)}>Roll ×10 · {(cost * 10).toLocaleString("en-IE")}</button>
          </>
        ) : <a className="btn discord" href="/login?next=/shop">Sign in to roll</a>}
      </div>
      {error && <p className="flash error" role="alert">{error}</p>}
      {results.length > 0 && (
        <div className="reveal" aria-live="polite">
          {shown === results.length && (
            <p className="lede"><strong>{results.length === 1 ? `${LABEL[results[0].rarity]}: ${results[0].name}` : `Best pull: ${LABEL[ORDER[best]]}`}</strong>
              {results.some((r) => r.duplicate) && ` · Duplicates refunded ${results.reduce((s, r) => s + r.refund, 0).toLocaleString("en-IE")} ${currency}`}
              {results.some((r) => r.pity) && " · Pity guarantee used"}</p>
          )}
          <div className="reveal-grid">
            {results.map((r, i) => (
              <div key={i} className={`reveal-card rarity-${r.rarity}${i >= shown ? " hidden" : ""}${i < shown && ORDER.indexOf(r.rarity) >= 3 ? " glow" : ""}`}>
                <div className="inner">
                  <div className="face">
                    <BannerArt b={r} />
                    <div className="label">
                      <span className="rarity-tag">{LABEL[r.rarity]}{r.pity ? " · pity" : ""}</span>
                      <strong>{r.name}</strong>
                      {r.duplicate && <span className="dup">Duplicate, +{r.refund.toLocaleString("en-IE")} back</span>}
                    </div>
                  </div>
                  <div className="back" aria-hidden>DUES</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
