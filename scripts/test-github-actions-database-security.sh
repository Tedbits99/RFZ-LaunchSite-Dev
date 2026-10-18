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
outbox_barrier_in=""
outbox_barrier_out=""
outbox_barrier_pid=""
outbox_worker_a_pid=""
outbox_worker_b_pid=""

cleanup() {
  if [ -n "$outbox_barrier_in" ]; then
    printf 'COMMIT;\n\\q\n' >&"$outbox_barrier_in" 2>/dev/null || true
  fi
  if [ -n "$outbox_worker_a_pid" ]; then wait "$outbox_worker_a_pid" 2>/dev/null || true; fi
  if [ -n "$outbox_worker_b_pid" ]; then wait "$outbox_worker_b_pid" 2>/dev/null || true; fi
  if [ -n "$outbox_barrier_pid" ]; then wait "$outbox_barrier_pid" 2>/dev/null || true; fi
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
cp "$project_root/supabase/tests/completion-receipt-outbox.sql" \
  "$test_root/supabase/tests/completion-receipt-outbox.sql"
cp "$project_root/supabase/tests/completion-receipt-data-contract.sql" \
  "$test_root/supabase/tests/completion-receipt-data-contract.sql"
cp "$project_root/supabase/tests/completion-receipt-outbox-worker.sql" \
  "$test_root/supabase/tests/completion-receipt-outbox-worker.sql"
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

echo "Executing completion receipt outbox assertions..."
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" \
  --set ON_ERROR_STOP=1 \
  --file supabase/tests/completion-receipt-outbox.sql

echo "Executing completion receipt data contract assertions..."
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" \
  --set ON_ERROR_STOP=1 \
  --file supabase/tests/completion-receipt-data-contract.sql

echo "Executing completion receipt outbox worker assertions..."
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" \
  --set ON_ERROR_STOP=1 \
  --file supabase/tests/completion-receipt-outbox-worker.sql

worker_race_a="$test_root/completion-receipt-outbox-worker-a.out"
worker_race_b="$test_root/completion-receipt-outbox-worker-b.out"
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" --set ON_ERROR_STOP=1 \
  --command "UPDATE public.order_email_outbox SET next_attempt_at = clock_timestamp() WHERE id = '00000000-0000-0000-0000-000000000611';"
coproc OUTBOX_BARRIER { PGOPTIONS='-c statement_timeout=30000' psql "$db_url" --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1; }
outbox_barrier_in="${OUTBOX_BARRIER[1]}"
outbox_barrier_out="${OUTBOX_BARRIER[0]}"
outbox_barrier_pid="$OUTBOX_BARRIER_PID"
printf "BEGIN; SELECT 'OUTBOX_BARRIER_LOCKED' FROM (SELECT pg_advisory_xact_lock(180018, 2)) AS lock_ready;\n" >&"$outbox_barrier_in"
if ! IFS= read -r -t 15 barrier_ready <&"$outbox_barrier_out" || [ "$barrier_ready" != "OUTBOX_BARRIER_LOCKED" ]; then
  echo "ERROR: Could not acquire the deterministic outbox race barrier." >&2
  exit 7
fi

PGOPTIONS='-c statement_timeout=30000' psql "$db_url" --set ON_ERROR_STOP=1 \
  --command "SELECT * FROM public.claim_completion_receipt_outbox(1, 300);" \
  >"$worker_race_a" 2>&1 &
outbox_worker_a_pid=$!

overlap_confirmed=false
for _ in $(seq 1 200); do
  waiting_sessions="$(PGOPTIONS='-c statement_timeout=30000' psql "$db_url" --set ON_ERROR_STOP=1 --tuples-only --no-align --quiet \
    --command "SELECT count(*) FROM pg_stat_activity a JOIN pg_locks waiting_lock ON waiting_lock.pid = a.pid WHERE a.wait_event_type = 'Lock' AND a.wait_event = 'advisory' AND waiting_lock.locktype = 'advisory' AND waiting_lock.classid = 180018::oid AND waiting_lock.objid = 2::oid AND NOT waiting_lock.granted AND a.query LIKE '%claim_completion_receipt_outbox%' AND EXISTS (SELECT 1 FROM pg_locks signal_lock WHERE signal_lock.pid = a.pid AND signal_lock.locktype = 'advisory' AND signal_lock.classid = 180018::oid AND signal_lock.objid = 1::oid AND signal_lock.granted);")"
  if [ "$waiting_sessions" = "1" ]; then overlap_confirmed=true; break; fi
  sleep 0.1
done
if [ "$overlap_confirmed" != true ]; then
  echo "ERROR: Worker A never reached the database barrier while holding the target row lock; no concurrency result is claimed." >&2
  exit 8
fi

PGOPTIONS='-c statement_timeout=30000' psql "$db_url" --set ON_ERROR_STOP=1 \
  --command "SELECT * FROM public.claim_completion_receipt_outbox(1, 300);" \
  >"$worker_race_b" 2>&1 &
outbox_worker_b_pid=$!
wait "$outbox_worker_b_pid"
outbox_worker_b_pid=""
if grep -Fq '00000000-0000-0000-0000-000000000611' "$worker_race_b"; then
  cat "$worker_race_b" >&2
  echo "ERROR: Worker B claimed the row held by Worker A." >&2
  exit 9
fi

printf "COMMIT; SELECT 'OUTBOX_BARRIER_RELEASED';\n" >&"$outbox_barrier_in"
if ! IFS= read -r -t 15 barrier_released <&"$outbox_barrier_out" || [ "$barrier_released" != "OUTBOX_BARRIER_RELEASED" ]; then
  echo "ERROR: Could not release the deterministic outbox race barrier." >&2
  exit 10
fi
printf '\\q\n' >&"$outbox_barrier_in"
wait "$outbox_barrier_pid"
outbox_barrier_pid=""
outbox_barrier_in=""
outbox_barrier_out=""
wait "$outbox_worker_a_pid"
outbox_worker_a_pid=""
if ! grep -Fq '00000000-0000-0000-0000-000000000611' "$worker_race_a"; then
  cat "$worker_race_a" "$worker_race_b" >&2
  echo "ERROR: Worker A did not claim the synchronized race fixture." >&2
  exit 11
fi
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" --set ON_ERROR_STOP=1 \
  --command "DO \$\$ DECLARE v_count integer; BEGIN SELECT count(*) INTO v_count FROM public.order_email_outbox WHERE id = '00000000-0000-0000-0000-000000000611' AND status = 'processing' AND attempt_count = 1 AND lease_token IS NOT NULL AND lease_until > clock_timestamp(); IF v_count <> 1 THEN RAISE EXCEPTION 'OUTBOX_WORKER_RACE_INVALID'; END IF; END \$\$;"
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" --set ON_ERROR_STOP=1 \
  --command "DROP TRIGGER IF EXISTS outbox_worker_race_barrier ON public.order_email_outbox; DROP FUNCTION IF EXISTS public.test_outbox_worker_race_barrier(); DELETE FROM public.order_email_outbox WHERE id IN ('00000000-0000-0000-0000-000000000608','00000000-0000-0000-0000-000000000609','00000000-0000-0000-0000-000000000610','00000000-0000-0000-0000-000000000611'); DELETE FROM public.supplier_transactions WHERE id IN ('00000000-0000-0000-0000-000000000614','00000000-0000-0000-0000-000000000615','00000000-0000-0000-0000-000000000616','00000000-0000-0000-0000-000000000617'); DELETE FROM public.orders WHERE id IN ('00000000-0000-0000-0000-000000000604','00000000-0000-0000-0000-000000000605','00000000-0000-0000-0000-000000000606','00000000-0000-0000-0000-000000000607'); DELETE FROM public.suppliers WHERE id = '00000000-0000-0000-0000-000000000613'; DELETE FROM public.packages WHERE id = '00000000-0000-0000-0000-000000000603'; DELETE FROM public.games WHERE id = '00000000-0000-0000-0000-000000000602';"

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
