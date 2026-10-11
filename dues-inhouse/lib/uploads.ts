/**
 * Officer uploads: ScrimTime logs (.txt), Valorant games (.json from the
 * HenrikDev API or the old Overtime site, .csv scoreboards), or a .zip of any
 * of these. Each file gets a one-line result.
 */
import JSZip from "jszip";
import { LogError, parseLog } from "./ow/parse";
import { fromOvertimeFile, isCustomGame, matchesIn, trim } from "./val/match";
import { ScoreboardError, parseScoreboard } from "./val/scoreboard";
import { saveOwMap, saveValMatch } from "./ingest";
import { valSettings } from "./val/fetch";

export interface UploadResult { file: string; ok: boolean; message: string }

const MAX_FILES = 400;
const MAX_UNPACKED = 60 * 1024 * 1024;

export async function processUploads(files: { name: string; bytes: Uint8Array }[], uploader: string | null): Promise<UploadResult[]> {
  const out: UploadResult[] = [];
  const budget = { files: MAX_FILES, bytes: MAX_UNPACKED };
  for (const f of files) await processOne(f.name, f.bytes, uploader, out, 0, budget);
  return out;
}

async function processOne(name: string, bytes: Uint8Array, uploader: string | null, out: UploadResult[], depth: number,
                          budget: { files: number; bytes: number }) {
  if (--budget.files < 0 || (budget.bytes -= bytes.length) < 0) {
    if (budget.files === -1 || budget.bytes + bytes.length >= 0) out.push({ file: name, ok: false, message: "too many files in one upload; send the rest separately" });
    return;
  }
  const lower = name.toLowerCase();
  const base = name.replace(/^.*[\\/]/, "");
  if (base.startsWith(".") || lower.includes("__macosx/")) return;
  try {
    if (lower.endsWith(".zip")) {
      if (depth > 1) return out.push({ file: name, ok: false, message: "zip inside a zip inside a zip; unpack it first" }) && undefined;
      const zip = await JSZip.loadAsync(bytes);
      const entries = Object.values(zip.files).filter((e) => !e.dir);
      if (!entries.length) out.push({ file: name, ok: false, message: "empty zip" });
      if (entries.length > MAX_FILES) return out.push({ file: name, ok: false, message: `more than ${MAX_FILES} files; split it up` }) && undefined;
      for (const e of entries) {
        if (budget.bytes <= 0 || budget.files <= 0) break;
        await processOne(e.name, await e.async("uint8array"), uploader, out, depth + 1, budget);
      }
      return;
    }
    const text = new TextDecoder("utf-8").decode(bytes);
    if (lower.endsWith(".txt")) {
      const m = parseLog(base, text);
      const r = await saveOwMap(m, base, uploader);
      out.push({ file: name, ok: true, message: r === "added"
        ? `Overwatch, ${m.mapName}, ${m.score[0]}–${m.score[1]}${m.complete ? "" : " (unfinished: shown but not rated)"}`
        : "already imported" });
    } else if (lower.endsWith(".csv")) {
      const m = parseScoreboard(base, text);
      const r = await saveValMatch(m, uploader);
      out.push({ file: name, ok: true, message: r === "added" ? `Valorant, ${m.mapName}, ${m.score[0]}–${m.score[1]} (typed in)` : "already imported" });
    } else if (lower.endsWith(".json")) {
      let data: unknown;
      try { data = JSON.parse(text); } catch { throw new LogError("not valid JSON"); }
      if (data && typeof data === "object" && (data as { format?: string }).format === "overtime-valorant-1") {
        const m = fromOvertimeFile(data);
        const r = await saveValMatch(m, uploader);
        out.push({ file: name, ok: true, message: r === "added" ? `Valorant, ${m.mapName}, ${m.score[0]}–${m.score[1]}` : "already imported" });
        return;
      }
      const raws = matchesIn(data);
      if (!raws.length) throw new LogError("no Valorant matches in this file");
      const { minPlayers } = valSettings();
      let added = 0, dup = 0;
      const skipped: Record<string, number> = {};
      for (const raw of raws) {
        const [ok, why] = isCustomGame(raw, minPlayers);
        if (!ok) { skipped[why] = (skipped[why] ?? 0) + 1; continue; }
        (await saveValMatch(trim(raw), uploader)) === "added" ? added++ : dup++;
      }
      const notes = Object.entries(skipped).map(([why, n]) => `${n} × ${why}`);
      out.push({ file: name, ok: added + dup > 0, message: `Valorant: ${added} added${dup ? `, ${dup} already imported` : ""}${notes.length ? `; skipped ${notes.join(", ")}` : ""}` });
    } else if (!lower.endsWith(".md")) {
      out.push({ file: name, ok: false, message: "not a .txt log, .json, .csv or .zip" });
    }
  } catch (e) {
    if (e instanceof LogError || e instanceof ScoreboardError) out.push({ file: name, ok: false, message: e.message });
    else throw e;
  }
}
