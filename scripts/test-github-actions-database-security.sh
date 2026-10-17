#!/usr/bin/env bash
set -euo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: Supabase CLI is required." >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is required for role and RPC integration assertions." >&2
  exit 2
fi

tmp_parent="${RUNNER_TEMP:-${TMPDIR:-$project_root}}"
test_root="$(mktemp -d "$tmp_parent/runfazone-supabase.XXXXXX")"

cleanup() {
  if [ -d "$test_root" ]; then
    (cd "$test_root" && supabase stop --no-backup >/dev/null 2>&1) || true
    rm -rf -- "$test_root"
  fi
}
trap cleanup EXIT

mkdir -p "$test_root/supabase/migrations" "$test_root/supabase/tests/database"

cat > "$test_root/supabase/config.toml" <<'EOF'
project_id = "runfazone-security-test"

[api]
enabled = true
port = 54321

[db]
port = 54322

[studio]
enabled = false

[inbucket]
enabled = false

[storage]
enabled = false

[analytics]
enabled = false
EOF

excluded_scheduler="20261008142813_20261008150000_schedule_auto_reconciliation.sql.sql"
excluded_incomplete_fulfillment="20260928071820_20260928_order_fulfillment_schema.sql"
excluded_ambiguous_status_rpc="20260928072329_20260928_fix_rpc_ambiguous_column.sql"
excluded_hardcoded_hok_uid="20260928124803_honor_of_kings_uid_input_field.sql"
required_hok_uid_correction="20260929131902_20260928124803_honor_of_kings_uid_input_field.sql.sql"
excluded_count=0

if [ ! -f "$project_root/supabase/migrations/$required_hok_uid_correction" ]; then
  echo "ERROR: Required corrected Honor of Kings migration is missing: $required_hok_uid_correction" >&2
  exit 3
fi

while IFS= read -r migration; do
  basename="$(basename "$migration")"
  case "$basename" in
    "$excluded_scheduler"|"$excluded_incomplete_fulfillment"|"$excluded_ambiguous_status_rpc"|"$excluded_hardcoded_hok_uid")
      echo "Excluding reviewed historical migration from disposable baseline: $basename"
      excluded_count=$((excluded_count + 1))
      continue
      ;;
  esac

  if grep -Eiq '(cron\.schedule|net\.http|http_post|http_get|https://[^[:space:]]+/functions/)' "$migration"; then
    echo "ERROR: Found an unapproved outbound/scheduled migration: $basename" >&2
    exit 3
  else
    cp "$migration" "$test_root/supabase/migrations/$basename"
  fi
done < <(find "$project_root/supabase/migrations" -maxdepth 1 -type f -name '*.sql' -print | sort)

if [ "$excluded_count" -ne 4 ]; then
  echo "ERROR: Expected exactly four reviewed baseline exclusions; found $excluded_count." >&2
  exit 3
fi

cp "$project_root/supabase/tests/database/privileged-rpc-security.sql" \
  "$test_root/supabase/tests/database/privileged-rpc-security.sql"
cp "$project_root/supabase/tests/privileged-rpc-security.sql" \
  "$test_root/supabase/tests/privileged-rpc-security.sql"
cp "$project_root/supabase/tests/customer-auth-foundation.sql" \
  "$test_root/supabase/tests/customer-auth-foundation.sql"
cp "$project_root/supabase/tests/customer-confirmation-resend-rate-limit.sql" \
  "$test_root/supabase/tests/customer-confirmation-resend-rate-limit.sql"
cp "$project_root/supabase/tests/customer-confirmation-resend-concurrency-assertion.sql" \
  "$test_root/supabase/tests/customer-confirmation-resend-concurrency-assertion.sql"
cp "$project_root/supabase/tests/fulfillment-completion-guard.sql" \
  "$test_root/supabase/tests/fulfillment-completion-guard.sql"
cp "$project_root/supabase/tests/reconciliation-atomicity.sql" \
  "$test_root/supabase/tests/reconciliation-atomicity.sql"
cp "$project_root/supabase/tests/reconciliation-concurrency-setup.sql" \
  "$test_root/supabase/tests/reconciliation-concurrency-setup.sql"
cp "$project_root/supabase/tests/reconciliation-concurrency-assertion.sql" \
  "$test_root/supabase/tests/reconciliation-concurrency-assertion.sql"
cp "$project_root/supabase/tests/reconciliation-concurrency-cleanup.sql" \
  "$test_root/supabase/tests/reconciliation-concurrency-cleanup.sql"

cd "$test_root"
echo "Starting isolated Supabase services..."
supabase start

status_env="$(supabase status -o env)"
db_url="$(printf '%s\n' "$status_env" | sed -n 's/^DB_URL=//p' | sed 's/^"//; s/"$//')"

case "$db_url" in
  *localhost*|*127.0.0.1*|*::1*) ;;
  *)
    echo "ERROR: Refusing to run: resolved DB_URL is not local." >&2
    exit 4
    ;;
esac

echo "Applying the isolated migration baseline..."
supabase db reset

echo "Executing database security integration assertions..."
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" \
  --set ON_ERROR_STOP=1 \
  --file supabase/tests/database/privileged-rpc-security.sql

echo "Executing customer authentication foundation assertions..."
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" \
  --set ON_ERROR_STOP=1 \
  --file supabase/tests/customer-auth-foundation.sql

echo "Executing customer confirmation-resend rate-limit assertions..."
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" \
  --set ON_ERROR_STOP=1 \
  --file supabase/tests/customer-confirmation-resend-rate-limit.sql

echo "Executing direct fulfillment completion guard assertions..."
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" \
  --set ON_ERROR_STOP=1 \
  --file supabase/tests/fulfillment-completion-guard.sql

echo "Executing reconciliation atomicity assertions..."
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" \
  --set ON_ERROR_STOP=1 \
  --file supabase/tests/reconciliation-atomicity.sql

echo "Preparing concurrent reconciliation assertion..."
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" \
  --set ON_ERROR_STOP=1 \
  --file supabase/tests/reconciliation-concurrency-setup.sql

concurrency_a="$test_root/reconciliation-concurrency-a.out"
concurrency_b="$test_root/reconciliation-concurrency-b.out"
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" --set ON_ERROR_STOP=1 \
  --command "SELECT * FROM public.finalize_supplier_reconciliation('00000000-0000-0000-0000-000000000205', 'completed', 'auto-reconciliation', NULL);" \
  >"$concurrency_a" 2>&1 &
pid_a=$!
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" --set ON_ERROR_STOP=1 \
  --command "SELECT * FROM public.finalize_supplier_reconciliation('00000000-0000-0000-0000-000000000205', 'completed', 'auto-reconciliation', NULL);" \
  >"$concurrency_b" 2>&1 &
pid_b=$!

wait "$pid_a"
wait "$pid_b"

echo "Preparing concurrent customer confirmation-resend assertion..."
resend_concurrency_a="$test_root/customer-confirmation-resend-concurrency-a.out"
resend_concurrency_b="$test_root/customer-confirmation-resend-concurrency-b.out"
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" --set ON_ERROR_STOP=1 \
  --tuples-only --no-align --quiet \
  --command "BEGIN; SET LOCAL ROLE service_role; SELECT allowed FROM public.reserve_customer_confirmation_resend(repeat('8', 64), repeat('9', 64)); COMMIT;" \
  >"$resend_concurrency_a" 2>&1 &
pid_resend_a=$!
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" --set ON_ERROR_STOP=1 \
  --tuples-only --no-align --quiet \
  --command "BEGIN; SET LOCAL ROLE service_role; SELECT allowed FROM public.reserve_customer_confirmation_resend(repeat('8', 64), repeat('9', 64)); COMMIT;" \
  >"$resend_concurrency_b" 2>&1 &
pid_resend_b=$!

wait "$pid_resend_a"
wait "$pid_resend_b"

if ! awk '$0 == "t" { true_count++ } $0 == "f" { false_count++ } END { exit !(true_count == 1 && false_count == 1) }' \
  "$resend_concurrency_a" "$resend_concurrency_b"; then
  cat "$resend_concurrency_a" "$resend_concurrency_b" >&2
  echo "ERROR: concurrent confirmation-resend calls did not produce exactly one allowed and one denied outcome." >&2
  exit 6
fi

PGOPTIONS='-c statement_timeout=30000' psql "$db_url" \
  --set ON_ERROR_STOP=1 \
  --file supabase/tests/customer-confirmation-resend-concurrency-assertion.sql

if ! grep -Eq 'applied|already-finalized' "$concurrency_a" "$concurrency_b"; then
  cat "$concurrency_a" "$concurrency_b" >&2
  echo "ERROR: concurrent calls did not return a finalization outcome." >&2
  exit 5
fi

PGOPTIONS='-c statement_timeout=30000' psql "$db_url" \
  --set ON_ERROR_STOP=1 \
  --file supabase/tests/reconciliation-concurrency-assertion.sql
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" \
  --set ON_ERROR_STOP=1 \
  --file supabase/tests/reconciliation-concurrency-cleanup.sql

echo "Reapplying the isolated baseline to verify reset/retry behavior..."
supabase db reset >/dev/null

echo "PASS: RunFazone database security integration tests completed."
