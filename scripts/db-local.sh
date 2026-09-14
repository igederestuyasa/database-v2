#!/usr/bin/env bash
# =============================================================================
# scripts/db-local.sh — local verification harness for the HC Core schema.
#
# supabase.com is unreachable from this environment and the `supabase` CLI is
# unavailable, so the schema is verified against a plain PostgreSQL 16 server
# instead. This script:
#
#   1. starts the local Postgres cluster
#   2. (re)creates the test database
#   3. applies db/local/00-shim.sql   — Supabase stand-in, NOT production schema
#   4. applies supabase/migrations/0001_init.sql — unmodified, exactly as it
#      would be applied to Supabase
#   5. optionally applies scripts/verify-schema.sql (default: yes)
#
# Usage:
#   bash scripts/db-local.sh                 # reset + migrate + verify
#   bash scripts/db-local.sh --no-verify     # reset + migrate only
#   bash scripts/db-local.sh --keep          # do not drop an existing database
#
# Env:
#   HC_LOCAL_DB    database name         (default: hc_core_test)
#   PG_SUPERUSER   bootstrapping role    (default: postgres)
# =============================================================================
set -euo pipefail

DB_NAME="${HC_LOCAL_DB:-hc_core_test}"
PG_SUPERUSER="${PG_SUPERUSER:-postgres}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHIM="$ROOT/db/local/00-shim.sql"
MIGRATION="$ROOT/supabase/migrations/0001_init.sql"
VERIFY="$ROOT/scripts/verify-schema.sql"

DO_VERIFY=1
DO_RESET=1
for arg in "$@"; do
  case "$arg" in
    --no-verify) DO_VERIFY=0 ;;
    --keep)      DO_RESET=0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# psql as the bootstrapping superuser, against maintenance db
psu() { sudo -u "$PG_SUPERUSER" psql -v ON_ERROR_STOP=1 -X -q "$@"; }
# psql as the bootstrapping superuser, against the test db
psdb() { sudo -u "$PG_SUPERUSER" psql -v ON_ERROR_STOP=1 -X -d "$DB_NAME" "$@"; }

say "Starting PostgreSQL"
if command -v pg_isready >/dev/null 2>&1 && pg_isready -q 2>/dev/null; then
  echo "already running"
elif command -v service >/dev/null 2>&1; then
  service postgresql start
elif command -v pg_ctlcluster >/dev/null 2>&1; then
  pg_ctlcluster 16 main start
else
  echo "cannot start postgres: no service/pg_ctlcluster found" >&2
  exit 1
fi

for _ in $(seq 1 30); do
  pg_isready -q && break
  sleep 1
done
pg_isready || { echo "postgres did not become ready" >&2; exit 1; }

# Harness convenience only: give the invoking OS user a matching superuser role
# so `npm run gen:types` (node-postgres over the unix socket, peer auth) can
# connect without a password. Never do this on a real server.
OS_USER="$(id -un)"
if [ "$OS_USER" != "$PG_SUPERUSER" ]; then
  say "Ensuring local login role '$OS_USER' (harness only)"
  psu -d postgres -c "do \$\$ begin
    if not exists (select 1 from pg_roles where rolname = '$OS_USER') then
      execute format('create role %I login superuser', '$OS_USER');
    end if;
  end \$\$;"
fi

if [ "$DO_RESET" -eq 1 ]; then
  say "Recreating database $DB_NAME"
  psu -d postgres -c "drop database if exists \"$DB_NAME\" with (force);"
  psu -d postgres -c "create database \"$DB_NAME\";"
else
  say "Reusing database $DB_NAME"
  psu -d postgres -c "select 1 from pg_database where datname = '$DB_NAME';" >/dev/null
fi

say "Applying LOCAL SHIM (db/local/00-shim.sql) — not production schema"
psdb -q -f "$SHIM"

# ALTER DATABASE ... SET only takes effect on new sessions.
say "Applying migration (supabase/migrations/0001_init.sql)"
psdb -q -f "$MIGRATION"

if [ "$DO_VERIFY" -eq 1 ]; then
  say "Verifying schema (scripts/verify-schema.sql)"
  # repo_root lets the script pg_read_file() lib/validation/lookupTypes.ts and
  # compare it against the CHECK constraint on lookups.tipe.
  psdb -v repo_root="$ROOT" -f "$VERIFY"
fi

say "Done — database '$DB_NAME' is ready"
echo "Connect with: sudo -u $PG_SUPERUSER psql -d $DB_NAME"
