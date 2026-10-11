import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

/** A fresh test database for each test file, built from supabase/schema.sql and seed.sql. */
export const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5433/dues_test";

export async function resetDb(): Promise<void> {
  const admin = postgres(TEST_URL.replace(/\/[^/]+$/, "/postgres"), { max: 1, onnotice: () => {} });
  const name = TEST_URL.split("/").pop()!;
  await admin.unsafe(`select pg_terminate_backend(pid) from pg_stat_activity where datname = '${name}' and pid <> pg_backend_pid()`);
  await admin.unsafe(`drop database if exists ${name}`);
  await admin.unsafe(`create database ${name}`);
  await admin.end();
  const sql = postgres(TEST_URL, { max: 1, onnotice: () => {} });
  for (const f of ["schema.sql", "seed.sql"]) await sql.unsafe(fs.readFileSync(path.join(__dirname, "..", "supabase", f), "utf8"));
  await sql.end();
  process.env.DATABASE_URL = TEST_URL;
}
