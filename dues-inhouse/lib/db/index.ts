import postgres from "postgres";

/**
 * One connection pool per server instance.
 *
 * On Supabase this connects through the transaction pooler (port 6543), which
 * suits Vercel's short-lived servers but can hand a pipelined query another
 * query's rows. So, away from localhost, each connection sends one query at a
 * time (max_pipeline 0, a real postgres.js option its types leave out). The
 * driver's own transactions refuse to start in that mode (UNSAFE_TRANSACTION),
 * so `begin` is replaced with one that reserves a connection and runs
 * BEGIN/COMMIT on it itself. DATABASE_SERIAL=1 turns this on locally, for tests.
 */
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

function connect(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See README: Setting up.");
  if (/\.supabase\.co(:5432)?\//.test(url) && !/pooler\.supabase\.com/.test(url)) {
    // db.<ref>.supabase.co is IPv6-only, which Vercel can't reach: the error is a confusing timeout.
    console.warn("DATABASE_URL looks like Supabase's direct connection. On Vercel use the Transaction pooler (port 6543).");
  }
  const local = /localhost|127\.0\.0\.1/.test(url);
  const serial = !local || process.env.DATABASE_SERIAL === "1";
  const sql = postgres(url, {
    max: Number(process.env.DATABASE_POOL ?? (local ? 5 : 3)),
    prepare: false,
    idle_timeout: 20,
    ssl: local ? false : "require",
    ...(serial ? { max_pipeline: 0 } : {}),
  } as postgres.Options<{}>);
  if (serial) sql.begin = ((a: unknown, b?: unknown) => serialBegin(sql, a, b)) as typeof sql.begin;
  return sql;
}

async function serialBegin(sql: postgres.Sql, a: unknown, b?: unknown): Promise<unknown> {
  const fn = (typeof a === "function" ? a : b) as (tx: postgres.ReservedSql) => unknown;
  const mode = typeof a === "string" ? a : "";
  if (mode && !/^[a-z ]+$/i.test(mode)) throw new Error("Bad transaction mode.");
  const conn = await sql.reserve();
  // Nested inTx() calls see no `begin` and run inside this transaction.
  delete (conn as Partial<postgres.ReservedSql>).begin;
  try {
    await conn.unsafe(`begin ${mode}`);
    const result = await fn(conn);
    await conn.unsafe("commit");
    return result;
  } catch (e) {
    await conn.unsafe("rollback").catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
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
