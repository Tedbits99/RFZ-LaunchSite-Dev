#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
: "${SUPABASE_URL:?SUPABASE_URL is required}"
: "${SUPABASE_POOLER_HOST:?SUPABASE_POOLER_HOST is required}"
: "${SUPABASE_POOLER_PORT:?SUPABASE_POOLER_PORT is required}"
: "${SUPABASE_DB_USER:?SUPABASE_DB_USER is required}"
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is required}"
: "${PROJECT_ID:?PROJECT_ID is required}"

export PGPASSWORD="$SUPABASE_DB_PASSWORD"
db_connection="host=$SUPABASE_POOLER_HOST port=$SUPABASE_POOLER_PORT user=$SUPABASE_DB_USER dbname=postgres sslmode=require connect_timeout=10"
temporary_dump="$RUNNER_TEMP/runfazone-development-data.sql"
functions_json="$(mktemp)"
secrets_json="$(mktemp)"
trap 'rm -f "$temporary_dump" "$functions_json" "$secrets_json"' EXIT

curl --fail --silent --show-error \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Accept: application/json' \
  "https://api.supabase.com/v1/projects/$PROJECT_ID/functions" > "$functions_json"
curl --fail --silent --show-error \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Accept: application/json' \
  "https://api.supabase.com/v1/projects/$PROJECT_ID/secrets" > "$secrets_json"

function_count="$(jq -r 'if type == "array" then length elif (.functions | type) == "array" then (.functions | length) else 0 end' "$functions_json")"
function_names="$(jq -r 'if type == "array" then .[] else .functions[] end | (.slug // .name // .id // empty)' "$functions_json" | paste -sd, -)"
secret_names="$(jq -r 'if type == "array" then .[] else .secrets[] end | (.name // empty)' "$secrets_json" | sort -u | paste -sd, -)"

db_summary="$(psql "$db_connection" -v ON_ERROR_STOP=1 -Atqc "
  SELECT json_build_object(
    'payment_configs', COALESCE((
      SELECT json_agg(json_build_object(
        'method_key', method_key,
        'provider_type', provider_type,
        'provider_name', provider_name,
        'is_test_mode', is_test_mode
      ) ORDER BY method_key)
      FROM public.payment_config
    ), '[]'::json),
    'live_nonmanual_payment_configs', COALESCE((
      SELECT count(*) FROM public.payment_config
      WHERE COALESCE(provider_type, 'manual') <> 'manual'
        AND is_test_mode IS NOT TRUE
    ), 0),
    'enabled_suppliers', COALESCE((
      SELECT count(*) FROM public.suppliers WHERE enabled IS TRUE
    ), 0),
    'cron_relation_present', EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'cron' AND c.relname = 'job'
    )
  )
")"

live_payment_configs="$(jq -r '.live_nonmanual_payment_configs' <<<"$db_summary")"
cron_relation_present="$(jq -r '.cron_relation_present' <<<"$db_summary")"
[[ "$live_payment_configs" = 0 ]] || {
  echo 'HOSTED_INTEGRATION_AUDIT_FAIL=non_test_payment_configuration' >&2
  exit 1
}

# The export stays in the ephemeral runner workspace and is removed by the
# EXIT trap. This proves export capability, not a disposable restore.
supabase db dump --linked --data-only --file "$temporary_dump"
test -s "$temporary_dump"

if [[ "$function_count" != 0 ]]; then
  echo "HOSTED_INTEGRATION_AUDIT_BLOCKED=edge_functions_present count=$function_count names=$function_names" >&2
  exit 1
fi

echo "HOSTED_EDGE_FUNCTION_INVENTORY_PASS count=$function_count"
echo "HOSTED_PROVIDER_SECRET_NAMES_RECORDED names=${secret_names:-none}"
echo "HOSTED_DB_INTEGRATION_SUMMARY cron_relation_present=$cron_relation_present live_nonmanual_payment_configs=$live_payment_configs"
echo 'HOSTED_RECOVERY_EXPORT_PASS data_dump_created=ephemeral_and_deleted restore=not_performed'
echo 'HOSTED_INTEGRATION_AUDIT_PASS edge_functions=0 provider_calls=uninvoked payment_config=non_live'
