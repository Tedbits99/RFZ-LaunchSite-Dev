#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_POOLER_HOST:?SUPABASE_POOLER_HOST is required}"
: "${SUPABASE_POOLER_PORT:?SUPABASE_POOLER_PORT is required}"
: "${SUPABASE_DB_USER:?SUPABASE_DB_USER is required}"
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is required}"
: "${PROJECT_ID:?PROJECT_ID is required}"

test "$PROJECT_ID" = "ketdhcmwowzztcdlmris" || {
  echo 'BLOCKED: payment lockdown targets only the approved RunFazone development project.' >&2
  exit 1
}

export PGPASSWORD="$SUPABASE_DB_PASSWORD"
db_connection="host=$SUPABASE_POOLER_HOST port=$SUPABASE_POOLER_PORT user=$SUPABASE_DB_USER dbname=postgres sslmode=require connect_timeout=10"

psql "$db_connection" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

DO $$
DECLARE
  matching_rows integer;
BEGIN
  SELECT count(*) INTO matching_rows
  FROM public.payment_config
  WHERE method_key = 'paymongo_qrph'
    AND provider_type = 'automated'
    AND provider_name = 'paymongo';

  IF matching_rows <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one automated PayMongo QRPh configuration, found %', matching_rows;
  END IF;
END;
$$;

UPDATE public.payment_config
SET is_enabled = false,
    updated_at = now()
WHERE method_key = 'paymongo_qrph'
  AND provider_type = 'automated'
  AND provider_name = 'paymongo';

DO $$
DECLARE
  still_enabled boolean;
BEGIN
  SELECT is_enabled INTO still_enabled
  FROM public.payment_config
  WHERE method_key = 'paymongo_qrph'
    AND provider_type = 'automated'
    AND provider_name = 'paymongo';

  IF still_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'PayMongo QRPh configuration remained enabled';
  END IF;
END;
$$;

COMMIT;

SELECT json_build_object(
  'method_key', method_key,
  'provider_type', provider_type,
  'provider_name', provider_name,
  'is_enabled', is_enabled,
  'is_test_mode', is_test_mode
)
FROM public.payment_config
WHERE method_key = 'paymongo_qrph';
SQL

echo 'HOSTED_DEVELOPMENT_PAYMENT_LOCKDOWN_PASS method_key=paymongo_qrph is_enabled=false external_calls=blocked_by_configuration'
