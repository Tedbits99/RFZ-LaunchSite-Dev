#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is required}"
: "${SUPABASE_POOLER_HOST:?SUPABASE_POOLER_HOST is required}"
: "${SUPABASE_POOLER_PORT:?SUPABASE_POOLER_PORT is required}"
: "${SUPABASE_DB_USER:?SUPABASE_DB_USER is required}"

# This is the only direct SQL operation in the workflow. It is deliberately
# narrower than migration apply: it changes no rows and cannot create, remove,
# or promote an administrator. The reviewed migration in PR #69 remains the
# canonical history entry for fresh installs and future synchronized projects.
connection="host=$SUPABASE_POOLER_HOST port=$SUPABASE_POOLER_PORT user=$SUPABASE_DB_USER dbname=postgres sslmode=require connect_timeout=10"

before="$(PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "$connection" -v ON_ERROR_STOP=1 -Atqc \
  "SELECT has_function_privilege('authenticated', 'public.claim_first_admin()', 'EXECUTE')")"
[[ "$before" == t || "$before" == f ]] || {
  echo 'BLOCKED: could not determine authenticated execute privilege for claim_first_admin().' >&2
  exit 1
}

admin_count_before="$(PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "$connection" -v ON_ERROR_STOP=1 -Atqc \
  "SELECT count(*) FROM public.admins")"

PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "$connection" -v ON_ERROR_STOP=1 -Atqc \
  "BEGIN;
   REVOKE EXECUTE ON FUNCTION public.claim_first_admin() FROM PUBLIC, anon, authenticated;
   COMMIT;"

after="$(PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "$connection" -v ON_ERROR_STOP=1 -Atqc \
  "SELECT has_function_privilege('authenticated', 'public.claim_first_admin()', 'EXECUTE')")"
anon_after="$(PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "$connection" -v ON_ERROR_STOP=1 -Atqc \
  "SELECT has_function_privilege('anon', 'public.claim_first_admin()', 'EXECUTE')")"
admin_count_after="$(PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "$connection" -v ON_ERROR_STOP=1 -Atqc \
  "SELECT count(*) FROM public.admins")"

[[ "$after" == f && "$anon_after" == f ]] || {
  echo 'BLOCKED: claim_first_admin() remains executable by a client role after remediation.' >&2
  exit 1
}
[[ "$admin_count_before" == "$admin_count_after" ]] || {
  echo 'BLOCKED: admin record count changed during bootstrap lockdown.' >&2
  exit 1
}

echo "HOSTED_ADMIN_BOOTSTRAP_LOCK_PASS authenticated_before=$before authenticated_after=$after anon_after=$anon_after admin_records_preserved=true"
