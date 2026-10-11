"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DailyButton({ amount }: { amount: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <button className="btn small" type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        const res = await fetch("/api/daily", { method: "POST" });
        const body = await res.json().catch(() => ({}));
        setMsg(res.ok ? `+${amount}` : body.error ?? "Try again");
        setBusy(false);
        router.refresh();
      }}>Daily +{amount}</button>
      {msg && <span className="muted" role="status">{msg}</span>}
    </>
  );
}
