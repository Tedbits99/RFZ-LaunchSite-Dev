#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
: "${SUPABASE_URL:?SUPABASE_URL is required}"
: "${SUPABASE_POOLER_HOST:?SUPABASE_POOLER_HOST is required}"
: "${SUPABASE_POOLER_PORT:?SUPABASE_POOLER_PORT is required}"
: "${SUPABASE_DB_USER:?SUPABASE_DB_USER is required}"
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is required}"
: "${PROJECT_ID:?PROJECT_ID is required}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"

export PGPASSWORD="$SUPABASE_DB_PASSWORD"
db_connection="host=$SUPABASE_POOLER_HOST port=$SUPABASE_POOLER_PORT user=$SUPABASE_DB_USER dbname=postgres sslmode=require connect_timeout=10"
temporary_dump="$RUNNER_TEMP/runfazone-development-data.sql"
temporary_schema_dump="$RUNNER_TEMP/runfazone-development-schema.sql"
functions_json="$(mktemp)"
secrets_json="$(mktemp)"
supplier_probe_body="$(mktemp)"
trap 'rm -f "$temporary_dump" "$temporary_schema_dump" "$functions_json" "$secrets_json" "$supplier_probe_body"' EXIT

# Verify the local reviewed disabled handler before probing hosted authorization.
node "$GITHUB_WORKSPACE/scripts/verify-disabled-fazercards-diagnostics.mjs"

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
        'is_enabled', is_enabled,
        'is_test_mode', is_test_mode
      ) ORDER BY method_key)
      FROM public.payment_config
    ), '[]'::json),
    'live_nonmanual_payment_configs', COALESCE((
      SELECT count(*) FROM public.payment_config
      WHERE COALESCE(provider_type, 'manual') <> 'manual'
        AND is_enabled IS TRUE
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
payment_configs="$(jq -c '.payment_configs' <<<"$db_summary")"
enabled_suppliers="$(jq -r '.enabled_suppliers' <<<"$db_summary")"
cron_job_count=0
if [[ "$cron_relation_present" = true ]]; then
  cron_job_count="$(psql "$db_connection" -v ON_ERROR_STOP=1 -Atqc 'SELECT count(*) FROM cron.job')"
fi
external_secret_names="$(jq -r 'if type == "array" then .[] else .secrets[] end | (.name // empty)' "$secrets_json" | awk '/^(PAYMENT_PAYMONGO_SECRET_KEY|PAYMENT_PAYMONGO_WEBHOOK_SECRET|SUPPLIER_FAZERCARDS_API_KEY|SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASSWORD|COMPLETION_RECEIPT_WORKER_ENABLED|COMPLETION_RECEIPT_WORKER_SECRET|COMPLETION_RECEIPT_APP_ORIGIN)$/ { print }' | paste -sd, -)"
known_external_functions="$(printf '%s\n' "$function_names" | tr ',' '\n' | awk '/^(auto-reconciliation|completion-receipt-email-worker|create-coin-topup-payment|create-qrph-payment|fazercards-test|fulfillment-handoff|fulfillment-handoff-v2|payment-webhook|send-transactional-email)$/ { print }' | paste -sd, -)"
echo "HOSTED_EDGE_FUNCTION_INVENTORY_OBSERVED count=$function_count names=${function_names:-none}"
echo "HOSTED_PROVIDER_SECRET_NAMES_RECORDED names=${secret_names:-none}"
echo "HOSTED_DB_INTEGRATION_SUMMARY cron_relation_present=$cron_relation_present cron_job_count=$cron_job_count enabled_suppliers=$enabled_suppliers live_nonmanual_payment_configs=$live_payment_configs payment_configs=$payment_configs"

# The deployed function inventory is evidence to classify, not a reason to
# fail merely because functions or server-side secrets exist. Secret names are
# metadata only; their values never leave Supabase. Safety is established by
# the active database configuration and the function authorization contracts:
# automated payment is disabled, suppliers are disabled, cron has no jobs, and
# the reviewed supplier diagnostic source has provider access removed. Hosted
# deployment is verified separately; source inspection alone cannot prove it.
echo "HOSTED_EDGE_FUNCTION_INVENTORY_PASS count=$function_count external_capable=${known_external_functions:-none} external_provider_secret_names=${external_secret_names:-none}"

# The audit must prove that an unauthenticated caller cannot reach the
# supplier-test handler. This request is intentionally stopped at the handler
# authorization boundary or permanent disabled response. Do not print the
# response body or any credential-bearing header.
supplier_test_status="$(curl --silent --show-error --output "$supplier_probe_body" --write-out '%{http_code}' \
  --max-time 15 \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H 'Content-Type: application/json' \
  "${SUPABASE_URL}/functions/v1/fazercards-test")"
supplier_test_denied=false
if [[ "$supplier_test_status" = 401 || "$supplier_test_status" = 403 ]]; then
  supplier_test_denied=true
elif [[ "$supplier_test_status" = 503 ]] && jq -e \
  '. == {"error":"FazerCards diagnostics are disabled; no provider request was made."}' \
  "$supplier_probe_body" >/dev/null; then
  supplier_test_denied=true
fi
[[ "$supplier_test_denied" = true ]] || {
  echo "HOSTED_INTEGRATION_AUDIT_FAIL=supplier_test_anonymous_access status=$supplier_test_status" >&2
  exit 1
}
echo "HOSTED_SUPPLIER_TEST_ANONYMOUS_DENIAL_PASS status=$supplier_test_status"

# The export is retained only in the ephemeral runner workspace and removed by
# the EXIT trap. It proves export capability, not a disposable restore.
supabase db dump --linked --schema public --file "$temporary_schema_dump"
test -s "$temporary_schema_dump"
supabase db dump --linked --schema public --data-only --file "$temporary_dump"
test -s "$temporary_dump"
echo 'HOSTED_RECOVERY_EXPORT_PASS data_dump_created=ephemeral_and_deleted restore=rehearsal_starting'

SOURCE_DB_CONNECTION="$db_connection" \
  SCHEMA_DUMP="$temporary_schema_dump" \
  DATA_DUMP="$temporary_dump" \
  bash scripts/verify-hosted-development-restore.sh

[[ "$live_payment_configs" = 0 ]] || {
  echo 'HOSTED_INTEGRATION_AUDIT_FAIL=non_test_payment_configuration' >&2
  exit 1
}

[[ "$enabled_suppliers" = 0 ]] || {
  echo 'HOSTED_INTEGRATION_AUDIT_FAIL=enabled_supplier_configuration' >&2
  exit 1
}

[[ "$cron_job_count" = 0 ]] || {
  echo 'HOSTED_INTEGRATION_AUDIT_FAIL=scheduled_jobs_present' >&2
  exit 1
}

echo "HOSTED_PROVIDER_SECRET_NAMES_RECORDED names=${secret_names:-none}"
echo "HOSTED_DB_INTEGRATION_SUMMARY cron_relation_present=$cron_relation_present cron_job_count=$cron_job_count live_nonmanual_payment_configs=$live_payment_configs"
echo "HOSTED_INTEGRATION_AUDIT_PASS edge_functions=$function_count provider_calls=uninvoked_by_audit payment_config=non_live supplier_config=disabled scheduled_jobs=none server_secrets=metadata_only"
