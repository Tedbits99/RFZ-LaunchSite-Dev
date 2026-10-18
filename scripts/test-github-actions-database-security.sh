#!/usr/bin/env bash
set -euo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
local_api_port=54321
local_db_port=54322

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is required to validate disposable connection URLs." >&2
  exit 2
fi
node_bin="$(command -v node)"

# One implementation is used both for the actual DB_URL and socket-free test
# inputs. It returns only a normalized, literal-loopback PostgreSQL URL.
validate_db_url() {
  local candidate="$1"
  local expected_port="$2"
  printf '%s' "$candidate" | RFZ_EXPECTED_DB_PORT="$expected_port" "$node_bin" -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => raw += chunk);
process.stdin.on("end", () => {
  try {
    if (raw !== raw.trim() || /[\s\\]/.test(raw) || /[\u0000-\u001f\u007f]/.test(raw)
      || raw.includes("?") || raw.includes("#") || raw.includes(",")) process.exit(1);
    const u = new URL(raw);
    const expectedPort = process.env.RFZ_EXPECTED_DB_PORT;
    const username = decodeURIComponent(u.username);
    const password = decodeURIComponent(u.password);
    if (!["postgres:", "postgresql:"].includes(u.protocol)
      || !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
      || u.port !== expectedPort || u.pathname !== "/postgres"
      || u.search !== "" || u.hash !== ""
      || username !== "postgres" || password.length === 0
      || /[\u0000-\u001f\u007f]/.test(username + password)) process.exit(1);
    const safe = new URL("postgresql://127.0.0.1");
    safe.port = expectedPort;
    safe.username = username;
    safe.password = password;
    safe.pathname = "/postgres";
    process.stdout.write(safe.toString());
  } catch { process.exit(1); }
});
' 2>/dev/null
}

test_db_url_validator() {
  local valid_url bad_url
  valid_url="$(validate_db_url "postgresql://postgres:test%40pass@localhost:${local_db_port}/postgres" "$local_db_port")" || {
    echo "ERROR: DB_URL validator rejected its valid loopback case." >&2
    return 1
  }
  if [ "$valid_url" != "postgresql://postgres:test%40pass@127.0.0.1:${local_db_port}/postgres" ]; then
    echo "ERROR: DB_URL validator did not normalize to the expected loopback destination." >&2
    return 1
  fi
  for bad_url in \
    "postgresql://postgres:pass@localhost.attacker.example:${local_db_port}/postgres" \
    "postgresql://postgres:pass@remote-localhost.example:${local_db_port}/postgres" \
    "postgresql://postgres:pass@127.0.0.1.evil:${local_db_port}/postgres" \
    "postgresql://postgres:pass@127.0.0.1:54323/postgres" \
    "postgresql://postgres:pass@127.0.0.1/postgres" \
    "https://postgres:pass@127.0.0.1:${local_db_port}/postgres" \
    "postgresql://user@127.0.0.1:${local_db_port}/postgres" \
    "postgresql://postgres:pass@127.0.0.1:${local_db_port},evil.example/postgres" \
    "postgresql://postgres:pass@127.0.0.1:${local_db_port}@evil.example/postgres" \
    "postgresql://postgres:pass@127.0.0.1:${local_db_port}/postgres?host=evil.example" \
    "postgresql://postgres:pass@127.0.0.1:${local_db_port}/postgres?hostaddr=203.0.113.1" \
    "postgresql://postgres:pass@127.0.0.1:${local_db_port}/postgres?service=evil" \
    "postgresql://postgres:pass@127.0.0.1:${local_db_port}/postgres?" \
    "postgresql://postgres:pass@127.0.0.1:${local_db_port}/postgres#" \
    "postgresql://postgres:bad%0apass@127.0.0.1:${local_db_port}/postgres" \
    "postgresql://postgres:pass@[::ffff:127.0.0.1]:${local_db_port}/postgres" \
    "postgresql://postgres:pass@[fe80::1%25lo0]:${local_db_port}/postgres"; do
    if validate_db_url "$bad_url" "$local_db_port" >/dev/null; then
      echo "ERROR: DB_URL validator accepted a malicious or malformed case." >&2
      return 1
    fi
  done
  echo "PASS: shared DB_URL validator positive and negative cases."
}

# psql receives one already-normalized connection URL plus only the handful of
# query/execution options used below. Values are exact or restricted to SQL
# command text; connection-selection flags and positional operands are denied.
validate_psql_invocation() {
  local actual_url="$1"
  local expected_url="$2"
  shift 2
  local argument seen_set=0 seen_file=0 seen_command=0
  local seen_quiet=0 seen_tuples=0 seen_no_align=0 seen_no_psqlrc=0

  if [ "$actual_url" != "$expected_url" ] || [ -z "$expected_url" ]; then
    return 1
  fi

  while [ "$#" -gt 0 ]; do
    argument="$1"
    shift
    case "$argument" in
      --set)
        [ "$seen_set" -eq 0 ] && [ "$#" -gt 0 ] || return 1
        [ "$1" = "ON_ERROR_STOP=1" ] || return 1
        seen_set=1
        shift
        ;;
      --file)
        [ "$seen_file" -eq 0 ] && [ "$#" -gt 0 ] || return 1
        case "$1" in
          supabase/tests/database/privileged-rpc-security.sql|\
          supabase/tests/customer-auth-foundation.sql|\
          supabase/tests/customer-confirmation-resend-rate-limit.sql|\
          supabase/tests/fulfillment-completion-guard.sql|\
          supabase/tests/reconciliation-atomicity.sql|\
          supabase/tests/completion-receipt-outbox.sql|\
          supabase/tests/completion-receipt-data-contract.sql|\
          supabase/tests/completion-receipt-outbox-worker.sql|\
          supabase/tests/customer-confirmation-resend-concurrency-assertion.sql|\
          supabase/tests/reconciliation-concurrency-setup.sql|\
          supabase/tests/reconciliation-concurrency-assertion.sql|\
          supabase/tests/reconciliation-concurrency-cleanup.sql) ;;
          *) return 1 ;;
        esac
        seen_file=1
        shift
        ;;
      --command)
        [ "$seen_command" -eq 0 ] && [ "$#" -gt 0 ] || return 1
        case "$1" in
          ''|-*|postgres://*|postgresql://*|host=*|hostaddr=*|port=*|dbname=*|service=*) return 1 ;;
        esac
        seen_command=1
        shift
        ;;
      --quiet)
        [ "$seen_quiet" -eq 0 ] || return 1
        seen_quiet=1
        ;;
      --tuples-only)
        [ "$seen_tuples" -eq 0 ] || return 1
        seen_tuples=1
        ;;
      --no-align)
        [ "$seen_no_align" -eq 0 ] || return 1
        seen_no_align=1
        ;;
      --no-psqlrc)
        [ "$seen_no_psqlrc" -eq 0 ] || return 1
        seen_no_psqlrc=1
        ;;
      *) return 1 ;;
    esac
  done

  [ "$seen_file" -eq 0 ] || [ "$seen_command" -eq 0 ]
}

test_psql_invocation_validator() {
  local valid_url
  valid_url="$(validate_db_url "postgresql://postgres:test%40pass@127.0.0.1:${local_db_port}/postgres" "$local_db_port")" || return 1

  # Exercise every argument shape used by the harness without opening a socket.
  validate_psql_invocation "$valid_url" "$valid_url" --set ON_ERROR_STOP=1 --file supabase/tests/completion-receipt-outbox-worker.sql || return 1
  validate_psql_invocation "$valid_url" "$valid_url" --set ON_ERROR_STOP=1 --command "SELECT 1;" || return 1
  validate_psql_invocation "$valid_url" "$valid_url" --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 || return 1

  assert_psql_args_rejected() {
    if validate_psql_invocation "$valid_url" "$valid_url" "$@"; then
      echo "ERROR: psql invocation validator accepted a forbidden argument case." >&2
      return 1
    fi
  }

  # Every disallowed case is tested against a valid, normalized primary URL.
  assert_psql_args_rejected --host remote.example || return 1
  assert_psql_args_rejected --host=remote.example || return 1
  assert_psql_args_rejected -h remote.example || return 1
  assert_psql_args_rejected -hremote.example || return 1
  assert_psql_args_rejected --port 5432 || return 1
  assert_psql_args_rejected --port=5432 || return 1
  assert_psql_args_rejected -p 5432 || return 1
  assert_psql_args_rejected -p5432 || return 1
  assert_psql_args_rejected --dbname remote_db || return 1
  assert_psql_args_rejected --dbname=remote_db || return 1
  assert_psql_args_rejected -d remote_db || return 1
  assert_psql_args_rejected -dremote_db || return 1
  assert_psql_args_rejected --service remote || return 1
  assert_psql_args_rejected --service=remote || return 1
  assert_psql_args_rejected -S remote || return 1
  assert_psql_args_rejected -Sremote || return 1
  assert_psql_args_rejected 'postgresql://other.example/db' || return 1
  assert_psql_args_rejected 'host=other.example' || return 1
  assert_psql_args_rejected 'hostaddr=203.0.113.1' || return 1
  assert_psql_args_rejected -- -h remote.example || return 1
  assert_psql_args_rejected --unknown-option || return 1
  assert_psql_args_rejected --file || return 1
  assert_psql_args_rejected --command || return 1
  assert_psql_args_rejected --set || return 1
  assert_psql_args_rejected --set --host=remote.example || return 1
  assert_psql_args_rejected --file --host=remote.example || return 1
  assert_psql_args_rejected --command --host=remote.example || return 1
  assert_psql_args_rejected --set ON_ERROR_STOP=1 --set ON_ERROR_STOP=1 || return 1
  assert_psql_args_rejected --file supabase/tests/completion-receipt-outbox-worker.sql \
    --file supabase/tests/completion-receipt-outbox-worker.sql || return 1
  assert_psql_args_rejected --command 'SELECT 1;' --command 'SELECT 2;' || return 1
  assert_psql_args_rejected --command 'postgresql://remote/db' || return 1
  assert_psql_args_rejected --command '--host=remote.example' || return 1
  assert_psql_args_rejected --command 'SELECT 1;' -- || return 1

  # A mismatched primary URL must fail even when all trailing options are safe.
  if validate_psql_invocation 'postgresql://postgres@127.0.0.1:54323/postgres' "$valid_url" --command "SELECT 1;"; then
    echo "ERROR: psql invocation validator accepted a non-approved connection URL." >&2
    return 1
  fi
  echo "PASS: shared psql invocation validator positive and negative cases."
}

if [ "${1:-}" = "--test-db-url-validator" ]; then
  test_db_url_validator
  exit $?
fi
if [ "${1:-}" = "--test-psql-args" ]; then
  test_psql_invocation_validator
  exit $?
fi
if [ "$#" -ne 0 ]; then
  echo "ERROR: Unexpected harness argument." >&2
  exit 2
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: Supabase CLI is required." >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is required for role and RPC integration assertions." >&2
  exit 2
fi

supabase_bin="$(command -v supabase)"
psql_bin="$(command -v psql)"

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
    supabase_local stop --no-backup >/dev/null 2>&1 || true
    rm -rf -- "$test_root"
  fi
}
trap cleanup EXIT

mkdir -p "$test_root/supabase/migrations" "$test_root/supabase/tests/database"

cat > "$test_root/supabase/config.toml" <<EOF
project_id = "runfazone-security-test"

[api]
enabled = true
port = $local_api_port

[db]
port = $local_db_port

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
clean_home="$test_root/isolated-home"
mkdir -p "$clean_home"
if [ -e "$test_root/supabase/.temp/project-ref" ] \
  || ! grep -Fxq 'project_id = "runfazone-security-test"' "$test_root/supabase/config.toml"; then
  echo "ERROR: Disposable Supabase project identity is not isolated." >&2
  exit 4
fi

# Every Supabase CLI operation runs in the new, unlinked temp project with a
# clean HOME and environment: no access token, link metadata, DB URL, password,
# service key, or inherited connection override can select a remote project.
supabase_local() {
  (
    cd "$test_root"
    grep -Fxq 'project_id = "runfazone-security-test"' supabase/config.toml
    [ ! -e supabase/.temp/project-ref ]
    env -i PATH="$PATH" HOME="$clean_home" XDG_CONFIG_HOME="$clean_home/.config" \
      TMPDIR="$test_root" "$supabase_bin" "$@"
  )
}

echo "Starting isolated Supabase services..."
supabase_local start

status_env="$(supabase_local status -o env)"
raw_db_url="$(printf '%s\n' "$status_env" | sed -n 's/^DB_URL=//p' | sed 's/^"//; s/"$//')"
if [ -z "$raw_db_url" ]; then
  echo "ERROR: Disposable Supabase did not provide DB_URL." >&2
  exit 4
fi

# Parse without network access; accept only the expected local database and
# emit a normalized URL using a literal loopback IP. Never pass CLI output
# through to libpq until all destination/transport components are checked.
db_url="$(validate_db_url "$raw_db_url" "$local_db_port")" || {
  echo "ERROR: Refusing unsafe or malformed disposable DB_URL." >&2
  exit 4
}

psql() {
  if [ "$#" -lt 1 ] || ! validate_psql_invocation "$1" "$db_url" "${@:2}"; then
    echo "ERROR: Refusing psql invocation outside the validated disposable database URL." >&2
    return 4
  fi
  shift
  env -i PATH="$PATH" LC_ALL=C PGOPTIONS='-c statement_timeout=30000' \
    PGPASSFILE=/dev/null PGSERVICEFILE=/dev/null PGSYSCONFDIR=/dev/null \
    PSQLRC=/dev/null PGSSLMODE=disable \
    "$psql_bin" --no-psqlrc "$db_url" "$@"
}
echo "Applying the isolated migration baseline..."
supabase_local db reset

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

# Exercise the isolated engine against the local disposable Supabase API only.
# This fake acknowledgment may mark the disposable fixture sent; it cannot reach
# any deployed function or production database.
api_url="$(printf '%s\n' "$status_env" | sed -n 's/^API_URL=//p' | sed 's/^"//; s/"$//')"
disposable_service_role_key="$(printf '%s\n' "$status_env" | sed -n 's/^SERVICE_ROLE_KEY=//p' | sed 's/^"//; s/"$//')"
api_url="$(printf '%s' "$api_url" | RFZ_EXPECTED_API_PORT="$local_api_port" node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => raw += chunk);
process.stdin.on("end", () => {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
      || u.port !== process.env.RFZ_EXPECTED_API_PORT || u.pathname !== "/"
      || u.username || u.password || u.search || u.hash) process.exit(1);
    process.stdout.write(`http://127.0.0.1:${process.env.RFZ_EXPECTED_API_PORT}`);
  } catch { process.exit(1); }
});
' 2>/dev/null)" || {
  echo "ERROR: Refusing worker-engine integration: API_URL is not the exact local disposable API." >&2
  exit 12
}
if [ -z "$disposable_service_role_key" ]; then
  echo "ERROR: Local disposable service-role test key is unavailable." >&2
  exit 12
fi
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" --set ON_ERROR_STOP=1 \
  --command "UPDATE public.orders SET reference = 'RF-OUTBOX-WORKER-2' WHERE id = '00000000-0000-0000-0000-000000000605'; UPDATE public.order_email_outbox SET receipt_snapshot = jsonb_set(receipt_snapshot, '{reference}', to_jsonb('RF-OUTBOX-WORKER-2'::text)), status = 'pending', attempt_count = 0, lease_token = NULL, lease_until = NULL, next_attempt_at = clock_timestamp() WHERE id = '00000000-0000-0000-0000-000000000609'; UPDATE public.orders SET reference = 'RF-OUTBOX-WORKER-3' WHERE id = '00000000-0000-0000-0000-000000000606'; UPDATE public.order_email_outbox SET receipt_snapshot = jsonb_set(receipt_snapshot, '{reference}', to_jsonb('RF-OUTBOX-WORKER-3'::text)), status = 'pending', attempt_count = 0, lease_token = NULL, lease_until = NULL, next_attempt_at = clock_timestamp() WHERE id = '00000000-0000-0000-0000-000000000610';"
(cd "$project_root" && \
  env -i PATH="$PATH" RFZ_COMPLETION_RECEIPT_INTEGRATION_MODE=disposable \
  RFZ_DISPOSABLE_SUPABASE_API_URL="$api_url" \
  RFZ_DISPOSABLE_SUPABASE_API_PORT="$local_api_port" \
  RFZ_DISPOSABLE_SUPABASE_SERVICE_ROLE_KEY="$disposable_service_role_key" \
  "$project_root/node_modules/.bin/vitest" run supabase/functions/completion-receipt-email-worker/testing/engine.integration.test.ts)
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" --set ON_ERROR_STOP=1 \
  --command "DO \$\$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.order_email_outbox WHERE id = '00000000-0000-0000-0000-000000000609' AND status = 'sent' AND attempt_count = 1 AND lease_token IS NULL AND lease_until IS NULL AND provider_message_id IS NULL) THEN RAISE EXCEPTION 'OUTBOX_WORKER_FAKE_ENGINE_ACK_INVALID'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.order_email_outbox WHERE id = '00000000-0000-0000-0000-000000000610' AND status = 'pending' AND attempt_count = 1 AND lease_token IS NULL AND lease_until IS NULL AND last_error = 'delivery_timeout' AND next_attempt_at > clock_timestamp()) THEN RAISE EXCEPTION 'OUTBOX_WORKER_FAKE_ENGINE_FAIL_INVALID'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.order_email_outbox WHERE id = '00000000-0000-0000-0000-000000000608' AND status = 'sent' AND attempt_count = 1 AND lease_token IS NULL AND lease_until IS NULL) THEN RAISE EXCEPTION 'OUTBOX_WORKER_UNRELATED_FIXTURE_CHANGED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.order_email_outbox WHERE id = '00000000-0000-0000-0000-000000000611' AND status = 'pending' AND attempt_count = 0 AND lease_token IS NULL AND lease_until IS NULL) THEN RAISE EXCEPTION 'OUTBOX_WORKER_UNRELATED_FIXTURE_CHANGED'; END IF;
  END \$\$;"

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
supabase_local db reset >/dev/null

echo "PASS: RunFazone database security integration tests completed."
