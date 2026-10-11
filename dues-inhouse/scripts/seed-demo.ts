/**
 * Fill a database with the invented demo season, for trying the site locally:
 *   DATABASE_URL=postgres://... npx tsx scripts/seed-demo.ts
 * Adds the demo games, an admin called "Demo Admin", and a few members with
 * linked accounts. Never run it against the real site's database.
 */
import fs from "node:fs";
import path from "node:path";
import { db } from "../lib/db";
import { processUploads } from "../lib/uploads";
import { addRosterMember, approveLink, requestLink } from "../lib/members";

async function main() {
  const sql = db();
  const zip = new Uint8Array(fs.readFileSync(path.join(import.meta.dirname, "..", "tests", "fixtures", "demo.zip")));
  const results = await processUploads([{ name: "demo.zip", bytes: zip }], null);
  console.log(`Games: ${results.filter((r) => r.ok).length} files read`);
  const [admin] = await sql`insert into players (display_name, slug, role) values ('Demo Admin', 'demo-admin', 'admin')
                            on conflict (slug) do update set role = 'admin' returning id`;
  const member = async (name: string, ow: string[], riot: string[]) => {
    const [exists] = await sql`select id from players where display_name = ${name}`;
    if (!exists) await addRosterMember(name, ow, riot, admin.id);
  };
  await member("Pike", ["Pike#2211", "PikeOnAlt"], ["Pike#2211"]);
  await member("Marrow", ["Marrow"], ["Marrow#1916"]);
  // Kestrel "signs in" and asks to link both accounts, which the admin approves.
  let [kestrel] = await sql`select id from players where display_name = 'Kestrel'`;
  if (!kestrel) {
    [kestrel] = await sql`insert into players (display_name, slug, auth_id) values ('Kestrel', 'kestrel', gen_random_uuid()) returning id`;
    await requestLink(kestrel.id, "overwatch", "Kestrel#21934");
    await requestLink(kestrel.id, "valorant", "Kestrel#EUW");
    for (const a of await sql`select id from game_accounts where player_id = ${kestrel.id}`) await approveLink(a.id, admin.id);
    await requestLink(kestrel.id, "valorant", "KestrelAlt#EUW"); // left waiting, to show the queue
  }
  await sql`insert into ledger (player_id, kind, amount, note) values (${admin.id}, 'admin', 20000, 'Demo coins')`;
  console.log("Done. Sign in as Demo Admin or Kestrel on /login with DEV_LOGIN=1.");
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
