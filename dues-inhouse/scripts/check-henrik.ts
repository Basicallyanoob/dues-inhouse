/**
 * Checks the HenrikDev API against a real account, the way the site uses it:
 *   npm run henrik:check -- "Name#TAG"
 * Prints the account id, current and peak rank, and the last 10 custom games
 * with what the import would do with each. Reads HENRIKDEV_API_KEY from
 * .env.local (never printed).
 */
import { fetchHistory, lookupAccount, valSettings } from "../lib/val/fetch";
import { isCustomGame, trim } from "../lib/val/match";
import { inWeeklyWindow } from "../lib/val/window";
import { tierName } from "../lib/weekly/strength";
import { clock, dayLabel } from "../lib/time";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: use the environment as it is.
}

const riotId = process.argv[2];
if (!riotId?.includes("#")) {
  console.error('Usage: npm run henrik:check -- "Name#TAG"');
  process.exit(1);
}
const s = valSettings();
if (!s.key) {
  console.error("HENRIKDEV_API_KEY isn't set in .env.local");
  process.exit(1);
}

const acc = await lookupAccount(riotId);
console.log(`Account: ${acc.name}#${acc.tag}  puuid ${acc.puuid.slice(0, 8)}…`);
console.log(`Rank: current ${tierName(acc.current) ?? "none"} (${acc.current}), peak ${tierName(acc.peak) ?? "none"} (${acc.peak})`);

const history = await fetchHistory(`${acc.name}#${acc.tag}`, s.key, s.region);
console.log(`\nLast ${history.length} custom games (mode=custom, region ${s.region}):`);
for (const raw of history) {
  const q = raw.metadata?.queue ?? {};
  const [ok, why] = isCustomGame(raw, s.minPlayers);
  const m = ok ? trim(raw) : null;
  const when = new Date(raw.metadata?.started_at);
  const verdict = !ok ? `skip: ${why}` : inWeeklyWindow(when) ? "import (in the Saturday window)" : "skip: outside the session window";
  console.log(`- ${dayLabel(when)} ${clock(when)}  ${raw.metadata?.map?.name ?? "?"}  ` +
    `${m ? `${m.score[0]}-${m.score[1]}, ` : ""}${(raw.players ?? []).length} players  queue id '${q.id ?? ""}' name '${q.name ?? ""}'  -> ${verdict}`);
}
