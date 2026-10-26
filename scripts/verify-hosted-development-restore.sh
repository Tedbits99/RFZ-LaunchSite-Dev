#!/usr/bin/env bash
set -euo pipefail

: "${SCHEMA_DUMP:?SCHEMA_DUMP is required}"
: "${DATA_DUMP:?DATA_DUMP is required}"
: "${SOURCE_DB_CONNECTION:?SOURCE_DB_CONNECTION is required}"
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is required}"

test -s "$SCHEMA_DUMP" || { echo 'BLOCKED: hosted schema export is empty.' >&2; exit 1; }
test -s "$DATA_DUMP" || { echo 'BLOCKED: hosted data export is empty.' >&2; exit 1; }

container_name="runfazone-restore-${GITHUB_RUN_ID:-local}-$$"
local_port="$(shuf -i 20000-40000 -n 1)"
local_password='runfazone-disposable-restore'
cleanup() {
  docker rm --force "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

source_integrity="$(PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "$SOURCE_DB_CONNECTION" -v ON_ERROR_STOP=1 -Atqc "
  SELECT concat_ws('|',
    (SELECT count(*) FROM public.games),
    (SELECT count(*) FROM public.packages),
    (SELECT count(*) FROM public.payment_config),
    (SELECT count(*) FROM public.customer_profiles),
    (SELECT count(*) FROM public.orders),
    (SELECT count(*) FROM public.payment_submissions)
  )
")"

docker run --detach --rm --name "$container_name" \
  --publish "127.0.0.1:${local_port}:5432" \
  --env POSTGRES_PASSWORD="$local_password" \
  postgres:17-alpine >/dev/null

for _ in $(seq 1 60); do
  if PGPASSWORD="$local_password" pg_isready -h 127.0.0.1 -p "$local_port" -U postgres -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
PGPASSWORD="$local_password" pg_isready -h 127.0.0.1 -p "$local_port" -U postgres -d postgres >/dev/null || {
  echo 'BLOCKED: disposable PostgreSQL restore target did not become ready.' >&2
  exit 1
}

local_connection="host=127.0.0.1 port=$local_port user=postgres dbname=postgres sslmode=disable connect_timeout=10"
PGPASSWORD="$local_password" psql "$local_connection" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', role_name);
    END IF;
  END LOOP;
END;
$$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb
);
CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$ SELECT NULL::uuid $$;

-- Supabase public policies may reference auth.jwt() even though the
-- disposable restore target is a vanilla PostgreSQL instance.  Provide a
-- deliberately empty, non-privileged stub so schema restoration can verify
-- structure and row-count integrity without simulating an authenticated
-- request or exposing any hosted Auth state.
CREATE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$ SELECT '{}'::jsonb $$;
SQL
PGPASSWORD="$local_password" psql "$local_connection" -v ON_ERROR_STOP=1 -f "$SCHEMA_DUMP" >/dev/null
PGPASSWORD="$local_password" psql "$local_connection" -v ON_ERROR_STOP=1 -f "$DATA_DUMP" >/dev/null

restored_integrity="$(PGPASSWORD="$local_password" psql "$local_connection" -v ON_ERROR_STOP=1 -Atqc "
  SELECT concat_ws('|',
    (SELECT count(*) FROM public.games),
    (SELECT count(*) FROM public.packages),
    (SELECT count(*) FROM public.payment_config),
    (SELECT count(*) FROM public.customer_profiles),
    (SELECT count(*) FROM public.orders),
    (SELECT count(*) FROM public.payment_submissions)
  )
")"

test "$restored_integrity" = "$source_integrity" || {
  echo 'BLOCKED: disposable restore row-count integrity check failed.' >&2
  exit 1
}

table_count="$(PGPASSWORD="$local_password" psql "$local_connection" -v ON_ERROR_STOP=1 -Atqc "
  SELECT count(*)
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
")"
test "$table_count" -gt 0 || { echo 'BLOCKED: disposable restore contains no public tables.' >&2; exit 1; }

echo "HOSTED_DISPOSABLE_RESTORE_PASS tables=$table_count selected_row_counts=match external_effects=none"
