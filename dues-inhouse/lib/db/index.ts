import postgres from "postgres";

/** One connection pool per server instance. Supabase's pooler needs prepare: false. */
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

function connect(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See README: Setting up.");
  const local = /localhost|127\.0\.0\.1/.test(url);
  return postgres(url, {
    max: Number(process.env.DATABASE_POOL ?? (local ? 5 : 3)),
    prepare: false,
       idle_timeout: 20,
       ssl: local ? false : "require",
      });
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
