#!/usr/bin/env bash
# Start a throwaway Postgres for development and tests, in .data/pg, on port 5433.
# Needs PostgreSQL 15+ installed (initdb, pg_ctl). Prints the DATABASE_URL to use.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN=${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")}
DIR=.data/pg
PORT=${PG_PORT:-5433}
# Postgres refuses to run as root; in a container, run it as the postgres user.
AS=()
if [ "$(id -u)" = 0 ]; then AS=(su postgres -s /bin/bash -c); fi
run() { if [ ${#AS[@]} -gt 0 ]; then "${AS[@]}" "$*"; else bash -c "$*"; fi; }
if [ ! -d "$DIR" ]; then
  mkdir -p "$DIR"
  [ "$(id -u)" = 0 ] && chown -R postgres "$(dirname "$DIR")" "$DIR"
  run "'$BIN/initdb' -D '$PWD/$DIR' -U postgres -A trust" >/dev/null
fi
if ! run "'$BIN/pg_ctl' -D '$PWD/$DIR' status" >/dev/null 2>&1; then
  run "'$BIN/pg_ctl' -D '$PWD/$DIR' -o '-p $PORT -k /tmp' -l '$PWD/.data/pg.log' start" >/dev/null
  sleep 1
fi
psql -h /tmp -p "$PORT" -U postgres -tc "select 1 from pg_database where datname = 'dues'" | grep -q 1 \
  || psql -h /tmp -p "$PORT" -U postgres -c "create database dues" >/dev/null
PGOPTIONS="-c client_min_messages=warning" psql -h /tmp -p "$PORT" -U postgres -d dues -q -f supabase/schema.sql >/dev/null
PGOPTIONS="-c client_min_messages=warning" psql -h /tmp -p "$PORT" -U postgres -d dues -q -f supabase/seed.sql >/dev/null
echo "DATABASE_URL=postgres://postgres@localhost:$PORT/dues"
