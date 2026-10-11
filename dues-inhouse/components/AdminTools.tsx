"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

interface Result { file: string; ok: boolean; message: string }

/** Drag-and-drop upload for ScrimTime logs and Valorant files. */
export function UploadBox() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  async function send(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    setBusy(true);
    setError(null);
    setResults([]);
    const out: Result[] = [];
    // Batches of up to about 3.5 MB stay under the server's 4.5 MB request limit.
    const batches: File[][] = [];
    for (const f of list) {
      const last = batches[batches.length - 1];
      if (last && last.reduce((s, x) => s + x.size, 0) + f.size <= 3.5e6) last.push(f);
      else batches.push([f]);
    }
    for (const batch of batches) {
      if (batch.length === 1 && batch[0].size > 4.4e6) { out.push({ file: batch[0].name, ok: false, message: "over 4.4 MB; split the zip into smaller ones" }); setResults([...out]); continue; }
      const form = new FormData();
      for (const f of batch) form.append("files", f);
      const res = await fetch("/api/admin/upload", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? `Upload failed (${res.status}).`); break; }
      out.push(...body.results);
      setResults([...out]);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <div className={`card dropzone${over ? " over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}>
        <p><strong>Drop files here</strong>, or <button type="button" className="btn ghost small" onClick={() => input.current?.click()} disabled={busy}>choose files</button></p>
        <p className="muted">ScrimTime logs (.txt), Valorant scoreboards (.csv), Valorant games saved from the API or the old site (.json), or a .zip of any of these. Files already imported are skipped.</p>
        <input ref={input} type="file" multiple hidden accept=".txt,.csv,.json,.zip" onChange={(e) => e.target.files && send(e.target.files)} />
      </div>
      {busy && <p role="status">Uploading…</p>}
      {error && <p className="flash error" role="alert">{error}</p>}
      {results.length > 0 && (
        <ul className="results">
          {results.map((r, i) => <li key={i} className={r.ok ? "" : "bad"}><strong>{r.file}</strong>: {r.message}</li>)}
        </ul>
      )}
    </div>
  );
}

interface Batch { checked: string[]; remaining: number; added: string[]; duplicates: number; skipped: Record<string, number>; errors: string[] }

/** Checks every linked Riot ID's recent games, a batch at a time, until all are done. */
export function ValorantFetch({ anchors, configured }: { anchors: number; configured: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(anchors);
  const [log, setLog] = useState<Batch | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setDone(0);
    const since = new Date().toISOString();
    const sum: Batch = { checked: [], remaining: 0, added: [], duplicates: 0, skipped: {}, errors: [] };
    for (;;) {
      const res = await fetch("/api/admin/valorant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ since }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { setError(b.error ?? `Failed (${res.status}).`); break; }
      sum.checked.push(...b.checked);
      sum.added.push(...b.added);
      sum.duplicates += b.duplicates;
      sum.errors.push(...b.errors);
      for (const [k, n] of Object.entries(b.skipped as Record<string, number>)) sum.skipped[k] = (sum.skipped[k] ?? 0) + n;
      setDone(sum.checked.length + sum.errors.length);
      setTotal(sum.checked.length + sum.errors.length + b.remaining);
      setLog({ ...sum });
      if (b.remaining === 0) break;
      const limited = (b.errors as string[]).some((e) => e.includes("rate limited"));
      if (!limited && !b.checked.length && !b.errors.length) break;
      if (limited) await new Promise((r) => setTimeout(r, 30000)); // let the API's per-minute limit reset
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <p><button className="btn" type="button" onClick={run} disabled={busy || !configured || !anchors}>{busy ? "Fetching…" : "Fetch now"}</button>{" "}
        <span className="muted">{configured ? `${anchors} linked Riot ID${anchors === 1 ? "" : "s"} to check, about 2 seconds each.` : "Set HENRIKDEV_API_KEY first (see the README)."}</span></p>
      {(busy || log) && total > 0 && <div className="progress" aria-hidden><span style={{ width: `${Math.round((done / total) * 100)}%` }} /></div>}
      {error && <p className="flash error" role="alert">{error}</p>}
      {log && (
        <ul className="results">
          <li>Checked {log.checked.length} account{log.checked.length === 1 ? "" : "s"}. {log.added.length ? `New games: ${log.added.join(", ")}.` : "No new games."} {log.duplicates ? `${log.duplicates} already saved.` : ""}</li>
          {Object.keys(log.skipped).length > 0 && <li className="muted">Not inhouses: {Object.entries(log.skipped).map(([k, n]) => `${n} × ${k}`).join(", ")}.</li>}
          {log.errors.map((e) => <li key={e} className="bad">{e}</li>)}
        </ul>
      )}
    </div>
  );
}
