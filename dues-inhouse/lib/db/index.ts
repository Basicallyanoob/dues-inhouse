import postgres from "postgres";

/** One connection pool per server instance. Supabase's pooler needs prepare: false. */
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

function connect(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See README: Setting up.");
  if (/\.supabase\.co(:5432)?\//.test(url) && !/pooler\.supabase\.com/.test(url)) {
    // db.<ref>.supabase.co is IPv6-only, which Vercel can't reach: the error is a confusing timeout.
    console.warn("DATABASE_URL looks like Supabase's direct connection. On Vercel use the Transaction pooler (port 6543).");
  }
  const local = /localhost|127\.0\.0\.1/.test(url);
  const options = {
    max: Number(process.env.DATABASE_POOL ?? (local ? 5 : 3)),
    prepare: false,
    idle_timeout: 20,
    ssl: local ? false : ("require" as const),
    // Supabase's transaction pooler can hand a pipelined query another query's rows: send one at a time.
    // max_pipeline is a real postgres.js option that its types leave out; 0 means no pipelining.
    max_pipeline: local ? 100 : 0,
  };
  return postgres(url, options as postgres.Options<{}>);
}

export function db(): postgres.Sql {
  globalForDb.sql ??= connect();
  return globalForDb.sql;
}

export type Tx = postgres.TransactionSql;

/** Tell every server instance that games changed, so ratings are recomputed. */
export async function bumpDataVersion(sql: postgres.Sql | Tx = db()): Promise<void> {
  await sql`update site_state set value = (value::bigint + 1)::text where key = 'data_version'`;
}

export async function dataVersion(): Promise<string> {
  const [row] = await db()`select value from site_state where key = 'data_version'`;
  return row?.value ?? "0";
}
