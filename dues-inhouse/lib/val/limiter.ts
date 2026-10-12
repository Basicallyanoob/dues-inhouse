/**
 * Keeps the whole site under the HenrikDev key's limit (30 requests a minute).
 * Imports, result checks, /link and rank refreshes can run at the same time on
 * different Vercel instances, so the count lives in the database: every request
 * first takes a slot in api_calls, under a lock, from a rolling 60-second window.
 *
 * - "high" requests (imports, results, /link) may use HENRIK_RATE_LIMIT a minute
 *   (default 28, two spare) and wait for a free slot while their deadline allows.
 * - "low" requests (rank refreshes) only use the first 60% of it, so they never
 *   crowd out results; they give up rather than wait.
 */
import { db } from "../db";

export type Priority = "high" | "low";

export const rateLimit = () => {
  const n = Number(process.env.HENRIK_RATE_LIMIT ?? 28);
  return Number.isFinite(n) && n > 0 ? n : 28;
};

const LOCK = 7_302_025; // any fixed number: the advisory lock that serialises slot-taking

export class RateLimited extends Error {}

// Without a database (the check script), a per-process window does the same job.
const local: number[] = [];

/** ms until a slot frees up, or 0 if one was taken now. */
async function trySlot(cap: number): Promise<number> {
  if (!process.env.DATABASE_URL) {
    const now = Date.now();
    while (local.length && local[0] <= now - 60_000) local.shift();
    if (local.length < cap) { local.push(now); return 0; }
    return local[0] + 60_000 - now;
  }
  return db().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK})`;
    await tx`delete from api_calls where at < now() - interval '2 minutes'`;
    const [r] = await tx`
      select count(*)::int as n,
             greatest(0, ceil(extract(epoch from (min(at) + interval '60 seconds' - now())) * 1000))::int as wait
      from api_calls where at > now() - interval '60 seconds'`;
    if (r.n < cap) {
      await tx`insert into api_calls default values`;
      return 0;
    }
    return Math.max(50, r.wait);
  });
}

/** Wait for a request slot, or throw RateLimited if none frees up before `deadline`. */
export async function takeSlot(priority: Priority = "high", deadline = Date.now() + 30_000): Promise<void> {
  const cap = priority === "low" ? Math.max(1, Math.floor(rateLimit() * 0.6)) : rateLimit();
  for (;;) {
    const wait = await trySlot(cap);
    if (!wait) return;
    if (priority === "low" || Date.now() + wait > deadline) throw new RateLimited("rate limited; the rest will be checked next time");
    await new Promise((r) => setTimeout(r, wait + 50));
  }
}
