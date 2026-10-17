#!/usr/bin/env bash
set -euo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$project_root"

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: Supabase CLI is required. Install it before running this test." >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is required to exercise PostgreSQL roles and RPC behavior." >&2
  exit 2
fi

if ! supabase status >/dev/null 2>&1; then
  echo "Starting the disposable local Supabase stack..."
  supabase start
fi

status_env="$(supabase status -o env)"
db_url="$(printf '%s\n' "$status_env" | sed -n 's/^DB_URL=//p' | sed 's/^"//; s/"$//')"

if [ -z "$db_url" ]; then
  echo "ERROR: Could not obtain the local Supabase DB_URL." >&2
  exit 2
fi

case "$db_url" in
  *localhost*|*127.0.0.1*|*::1*) ;;
  *)
    echo "ERROR: Refusing to run: Supabase DB_URL is not local." >&2
    exit 2
    ;;
esac

echo "Resetting the local database and applying all migrations..."
supabase db reset

echo "Running role, RPC, RLS, SECURITY DEFINER, and catalog compatibility tests..."
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" \
  --set ON_ERROR_STOP=1 \
  --file supabase/tests/privileged-rpc-security.sql

echo "Re-running the migration reset to verify clean retry/idempotency..."
supabase db reset >/dev/null

echo "PASS: local disposable database security tests completed."
echo "Stop and remove the local stack with: supabase stop --no-backup"
