#!/usr/bin/env bash
set -euo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
local_api_port=""
local_db_port=""
upgrade_mode=false

# Pending migrations are reviewed but not deployed by normal `db push`; scan
# every one explicitly before the disposable upgrade rehearsal so a queued
# migration cannot hide an outbound HTTP request or scheduled side effect.
if ! command -v grep >/dev/null 2>&1; then
  echo "ERROR: Required pending-migration safety scanner (grep) is unavailable." >&2
  exit 2
fi
pending_migration_dirs=()
for pending_dir in \
  "$project_root/supabase/migrations-pending" \
  "$project_root/supabase/migrations-pending-provider"; do
  # Empty/untracked directories disappear from clean Git checkouts. Treat a
  # missing optional queue as empty, but fail closed for an existing unreadable
  # path and continue scanning every pending SQL directory that is present.
  [ -e "$pending_dir" ] || continue
  if [ ! -d "$pending_dir" ] || [ ! -r "$pending_dir" ]; then
    echo "ERROR: Pending migration inventory path is not a readable directory: ${pending_dir##*/}." >&2
    exit 2
  fi
  pending_migration_dirs+=("$pending_dir")
done
pending_migrations=""
if [ "${#pending_migration_dirs[@]}" -gt 0 ]; then
  pending_migrations="$(find "${pending_migration_dirs[@]}" -type f -name '*.sql' -print 2>/dev/null | sort)" || {
  echo "ERROR: Could not inventory pending SQL migrations." >&2
  exit 2
  }
fi
if [ -n "$pending_migrations" ]; then
  pending_migration_count=0
  while IFS= read -r pending_migration; do
    [ -n "$pending_migration" ] || continue
    pending_migration_count=$((pending_migration_count + 1))
    scan_status=0
    grep -Eiq '(cron\.schedule|net\.http|(extensions\.)?http_(post|get|put|delete|head|patch)|https?://)' \
      "$pending_migration" || scan_status=$?
    case "$scan_status" in
      0)
        echo "ERROR: Pending migration contains an outbound/scheduled operation: $(basename "$pending_migration")" >&2
        exit 3
        ;;
      1) ;;
      *)
        echo "ERROR: Pending migration safety scanner failed for $(basename "$pending_migration") (exit $scan_status)." >&2
        exit 2
        ;;
    esac
  done <<EOF_PENDING_MIGRATIONS
$pending_migrations
EOF_PENDING_MIGRATIONS
else
  pending_migration_count=0
fi
echo "PENDING_MIGRATION_SAFETY_PASS count=$pending_migration_count"
if [ "${1:-}" = "--scan-pending-migrations" ]; then
  exit 0
fi

if [ "${1:-}" = "--existing-schema-upgrade" ]; then
  upgrade_mode=true
  shift
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is required to validate disposable connection URLs." >&2
  exit 2
fi
node_bin="$(command -v node)"

# GitHub-hosted runners can retain listeners from unrelated jobs. Ask the
# kernel for free loopback ports instead of assuming the conventional Supabase
# ports are available. The values are written into the disposable config and
# then revalidated from Supabase CLI output before any connection is allowed.
find_free_loopback_port() {
  "$node_bin" -e '
const net = require("node:net");
const server = net.createServer();
server.once("error", () => process.exit(1));
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") process.exit(1);
  process.stdout.write(String(address.port));
  server.close(() => process.exit(0));
});
' 2>/dev/null
}

local_api_port="$(find_free_loopback_port)" || {
  echo "ERROR: Could not reserve a disposable Supabase API port." >&2
  exit 2
}
local_db_port="$(find_free_loopback_port)" || {
  echo "ERROR: Could not reserve a disposable Supabase database port." >&2
  exit 2
}
while [ "$local_db_port" = "$local_api_port" ]; do
  local_db_port="$(find_free_loopback_port)" || {
    echo "ERROR: Could not reserve a distinct disposable Supabase database port." >&2
    exit 2
  }
done

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
    "postgresql://postgres:pass@127.0.0.1:1/postgres" \
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
  local argument seen_error_stop=0 seen_expected_migration_count=0
  local upgrade_assertion_file=0 seen_file=0 seen_command=0
  local seen_quiet=0 seen_tuples=0 seen_no_align=0 seen_no_psqlrc=0

  if [ "$actual_url" != "$expected_url" ] || [ -z "$expected_url" ]; then
    return 1
  fi

  while [ "$#" -gt 0 ]; do
    argument="$1"
    shift
    case "$argument" in
      --set)
        [ "$#" -gt 0 ] || return 1
        case "$1" in
          ON_ERROR_STOP=1)
            [ "$seen_error_stop" -eq 0 ] || return 1
            seen_error_stop=1
            ;;
          expected_migration_count=[1-9][0-9]*)
            [ "$seen_expected_migration_count" -eq 0 ] || return 1
            [[ "${1#expected_migration_count=}" =~ ^[1-9][0-9]*$ ]] || return 1
            seen_expected_migration_count=1
            ;;
          *) return 1 ;;
        esac
        shift
        ;;
      --file)
        [ "$seen_file" -eq 0 ] && [ "$#" -gt 0 ] || return 1
        case "$1" in
          supabase/tests/database/privileged-rpc-security.sql|\
          supabase/tests/customer-auth-foundation.sql|\
          supabase/tests/customer-confirmation-resend-rate-limit.sql|\
          supabase/tests/fulfillment-completion-guard.sql|\
          supabase/tests/supplier_transactions_service_role_grants.sql|\
          supabase/tests/reconciliation-atomicity.sql|\
          supabase/tests/completion-receipt-outbox.sql|\
          supabase/tests/completion-receipt-data-contract.sql|\
          supabase/tests/completion-receipt-outbox-worker.sql|\
          supabase/tests/database/existing-schema-upgrade.sql|\
          supabase/tests/database/rf-coins-current-schema-upgrade.sql|\
          supabase/tests/hosted-acl-metadata-audit.sql|\
          supabase/tests/database/rf-coins-payment-compatibility-before-upgrade.sql|\
          supabase/tests/database/rf-coins-default-acl-fixture.sql|\
          supabase/tests/database/rf-coins-current-schema-upgrade.sql|\
          supabase/tests/customer-confirmation-resend-concurrency-assertion.sql|\
          supabase/tests/reconciliation-concurrency-setup.sql|\
          supabase/tests/reconciliation-concurrency-assertion.sql|\
          supabase/tests/reconciliation-concurrency-cleanup.sql) ;;
          *) return 1 ;;
        esac
        case "$1" in
          supabase/tests/database/existing-schema-upgrade.sql|\
          supabase/tests/database/rf-coins-current-schema-upgrade.sql) upgrade_assertion_file=1 ;;
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

  [ "$seen_file" -eq 0 ] || [ "$seen_command" -eq 0 ] || return 1
  [ "$seen_expected_migration_count" -eq 0 ] || {
    [ "$seen_error_stop" -eq 1 ] && [ "$upgrade_assertion_file" -eq 1 ]
  }
}

test_psql_invocation_validator() {
  local valid_url manifest_count
  valid_url="$(validate_db_url "postgresql://postgres:test%40pass@127.0.0.1:${local_db_port}/postgres" "$local_db_port")" || return 1
  manifest_count="$(awk -F'|' '/\| INCLUDE \|/ { count++ } END { print count + 0 }' \
    "$project_root/docs/transformation/CANONICAL_DISPOSABLE_MIGRATION_SEQUENCE.md")" || return 1
  [[ "$manifest_count" =~ ^[1-9][0-9]*$ ]] || return 1

  # Exercise every argument shape used by the harness without opening a socket.
  validate_psql_invocation "$valid_url" "$valid_url" --set ON_ERROR_STOP=1 --file supabase/tests/completion-receipt-outbox-worker.sql || return 1
  validate_psql_invocation "$valid_url" "$valid_url" --set ON_ERROR_STOP=1 \
    --set expected_migration_count="$manifest_count" \
    --file supabase/tests/database/existing-schema-upgrade.sql || return 1
  validate_psql_invocation "$valid_url" "$valid_url" --set ON_ERROR_STOP=1 \
    --set expected_migration_count="$manifest_count" \
    --file supabase/tests/database/rf-coins-current-schema-upgrade.sql || return 1
  validate_psql_invocation "$valid_url" "$valid_url" --set ON_ERROR_STOP=1 \
    --file supabase/tests/database/rf-coins-default-acl-fixture.sql || return 1
  validate_psql_invocation "$valid_url" "$valid_url" --set ON_ERROR_STOP=1 --command "SELECT 1;" || return 1
  validate_psql_invocation "$valid_url" "$valid_url" --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 || return 1
  validate_psql_invocation "$valid_url" "$valid_url" --quiet --tuples-only --no-align \
    --set ON_ERROR_STOP=1 --file supabase/tests/hosted-acl-metadata-audit.sql || return 1

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
  assert_psql_args_rejected --set ON_ERROR_STOP=1 --set expected_migration_count=0 \
    --file supabase/tests/database/existing-schema-upgrade.sql || return 1
  assert_psql_args_rejected --set ON_ERROR_STOP=1 --set expected_migration_count="$manifest_count" \
    --file supabase/tests/privileged-rpc-security.sql || return 1
  assert_psql_args_rejected --set ON_ERROR_STOP=1 --set expected_migration_count="$manifest_count" \
    --file supabase/tests/database/existing-schema-upgrade.sql \
    --set expected_migration_count="$((manifest_count + 1))" || return 1
  assert_psql_args_rejected --file supabase/tests/completion-receipt-outbox-worker.sql \
    --file supabase/tests/completion-receipt-outbox-worker.sql || return 1
  assert_psql_args_rejected --command 'SELECT 1;' --command 'SELECT 2;' || return 1
  assert_psql_args_rejected --command 'postgresql://remote/db' || return 1
  assert_psql_args_rejected --command '--host=remote.example' || return 1
  assert_psql_args_rejected --command 'SELECT 1;' -- || return 1

  # A mismatched primary URL must fail even when all trailing options are safe.
  if validate_psql_invocation 'postgresql://postgres@127.0.0.1:1/postgres' "$valid_url" --command "SELECT 1;"; then
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

echo "Running source-only hosted ACL remediation rehearsal in standalone disposable PostgreSQL 17..."
bash "$project_root/scripts/test-hosted-acl-remediation-postgres17.sh"

tmp_parent="${RUNNER_TEMP:-${TMPDIR:-$project_root}}"
test_root="$(mktemp -d "$tmp_parent/runfazone-supabase.XXXXXX")"
outbox_barrier_in=""
outbox_barrier_out=""
outbox_barrier_pid=""
outbox_worker_a_pid=""
outbox_worker_b_pid=""

cleanup() {
  cleanup_status=$?
  if [ -n "$outbox_barrier_in" ]; then
    printf 'COMMIT;\n\\q\n' >&"$outbox_barrier_in" 2>/dev/null || true
  fi
  if [ -n "$outbox_worker_a_pid" ]; then wait "$outbox_worker_a_pid" 2>/dev/null || true; fi
  if [ -n "$outbox_worker_b_pid" ]; then wait "$outbox_worker_b_pid" 2>/dev/null || true; fi
  if [ -n "$outbox_barrier_pid" ]; then wait "$outbox_barrier_pid" 2>/dev/null || true; fi
  if [ -d "$test_root" ]; then
    if [ "$cleanup_status" -ne 0 ] && command -v docker >/dev/null 2>&1; then
      echo "Diagnostic: disposable Supabase container state before cleanup:" >&2
      container_names="$(docker ps -a --format '{{.Names}}' | grep -E 'runfazone-security-test|supabase' || true)"
      if [ -z "$container_names" ]; then
        echo "  no matching disposable Supabase containers found" >&2
      else
        while IFS= read -r container_name; do
          [ -n "$container_name" ] || continue
          docker inspect --format '  {{.Name}} status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_name" 2>/dev/null || true
          docker logs --tail 80 "$container_name" 2>&1 \
            | sed -E 's/(password|token|key|secret|authorization|apikey|service_role)[^[:space:]]*/\1=<redacted>/Ig; s#https?://[^[:space:]]+#<url-redacted>#g' \
            | sed 's/^/    /' || true
        done <<< "$container_names"
      fi
    fi
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
major_version = 17

[studio]
enabled = false

[inbucket]
enabled = false

[storage]
enabled = false

[analytics]
enabled = false
EOF

while IFS= read -r migration; do
  basename="$(basename "$migration")"

  if [ "$upgrade_mode" = true ]; then
    # Reproduce the observed hosted starting point exactly. The post-baseline
    # sequence is copied only after this baseline has been reset and checked.
    case "$basename" in
      20260927062024_runfazone_core_catalog.sql|\
      20260927063133_runfazone_vouchers_promos.sql|\
      20260927064634_runfazone_mlbb_packages.sql|\
      20260928042134_runfazone_games_update_policy.sql|\
      20260928051223_admin_games_rpc.sql|\
      20260928055204_20260928_apply_games_rpc.sql.sql|\
      20260928055236_20260928_games_with_package_counts_rpc.sql.sql|\
      20260928060956_20260928_order_fulfillment_payment.sql.sql|\
      20260928061342_20260928_order_fulfillment_rls.sql.sql|\
      20260928062007_20260928_fix_order_status_rpc.sql.sql|\
      20260928062039_20260928_update_orders_status_check.sql.sql)
        cp "$migration" "$test_root/supabase/migrations/$basename"
        ;;
    esac
    continue
  fi

  if grep -Eiq '(cron\.schedule|net\.http|http_post|http_get|https://[^[:space:]]+/functions/)' "$migration"; then
    echo "ERROR: Found an unapproved outbound/scheduled migration: $basename" >&2
    exit 3
  else
    cp "$migration" "$test_root/supabase/migrations/$basename"
  fi
done < <(find "$project_root/supabase/migrations" -maxdepth 1 -type f -name '*.sql' -print | sort)

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
cp "$project_root/supabase/tests/supplier_transactions_service_role_grants.sql" \
  "$test_root/supabase/tests/supplier_transactions_service_role_grants.sql"
cp "$project_root/supabase/tests/reconciliation-atomicity.sql" \
  "$test_root/supabase/tests/reconciliation-atomicity.sql"
cp "$project_root/supabase/tests/completion-receipt-outbox.sql" \
  "$test_root/supabase/tests/completion-receipt-outbox.sql"
cp "$project_root/supabase/tests/completion-receipt-data-contract.sql" \
  "$test_root/supabase/tests/completion-receipt-data-contract.sql"
cp "$project_root/supabase/tests/completion-receipt-outbox-worker.sql" \
  "$test_root/supabase/tests/completion-receipt-outbox-worker.sql"
cp "$project_root/supabase/tests/database/existing-schema-upgrade.sql" \
  "$test_root/supabase/tests/database/existing-schema-upgrade.sql"
cp "$project_root/supabase/tests/hosted-acl-metadata-audit.sql" \
  "$test_root/supabase/tests/hosted-acl-metadata-audit.sql"
cp "$project_root/supabase/tests/database/rf-coins-payment-compatibility-before-upgrade.sql" \
  "$test_root/supabase/tests/database/rf-coins-payment-compatibility-before-upgrade.sql"
cp "$project_root/supabase/tests/database/rf-coins-default-acl-fixture.sql" \
  "$test_root/supabase/tests/database/rf-coins-default-acl-fixture.sql"
cp "$project_root/supabase/tests/database/rf-coins-current-schema-upgrade.sql" \
  "$test_root/supabase/tests/database/rf-coins-current-schema-upgrade.sql"
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
supabase_local start --debug

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
if [ "$upgrade_mode" = true ]; then
  echo "LEGACY_UPGRADE_PHASE=baseline-reset"
  set +e
  supabase_local db reset --debug
  baseline_reset_status=$?
  set -e
  echo "LEGACY_UPGRADE_BASELINE_RESET_STATUS=$baseline_reset_status"
  if [ "$baseline_reset_status" -ne 0 ]; then
    echo "ERROR: The reproduced 11-migration hosted baseline could not be reset locally." >&2
    exit "$baseline_reset_status"
  fi
  echo "LEGACY_UPGRADE_PHASE=baseline-reset-complete"
  PGOPTIONS='-c statement_timeout=30000' psql "$db_url" --set ON_ERROR_STOP=1 \
    --command "DO \$\$ BEGIN
      IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 11 THEN
        RAISE EXCEPTION 'LEGACY_BASELINE_MIGRATION_COUNT_INVALID';
      END IF;
      IF to_regclass('public.order_email_outbox') IS NOT NULL
         OR to_regclass('public.suppliers') IS NOT NULL THEN
        RAISE EXCEPTION 'LEGACY_BASELINE_CONTAINS_POST_BASELINE_OBJECT';
      END IF;
    END \$\$;"

  echo "Preparing canonical post-baseline upgrade sequence..."
  upgrade_count=0
  while IFS= read -r migration_name; do
    [ -n "$migration_name" ] || continue
    case "$migration_name" in
      20260927062024_runfazone_core_catalog.sql|\
      20260927063133_runfazone_vouchers_promos.sql|\
      20260927064634_runfazone_mlbb_packages.sql|\
      20260928042134_runfazone_games_update_policy.sql|\
      20260928051223_admin_games_rpc.sql|\
      20260928055204_20260928_apply_games_rpc.sql.sql|\
      20260928055236_20260928_games_with_package_counts_rpc.sql.sql|\
      20260928060956_20260928_order_fulfillment_payment.sql.sql|\
      20260928061342_20260928_order_fulfillment_rls.sql.sql|\
      20260928062007_20260928_fix_order_status_rpc.sql.sql|\
      20260928062039_20260928_update_orders_status_check.sql.sql)
        continue
        ;;
    esac
    case "$migration_name" in
      20261028120000_rf_coins_schema.sql|\
      20261028120100_rf_coins_functions.sql|\
      20261028120200_rf_coin_admin_center_read.sql)
        # The legacy stage intentionally stops before RF Coins. The three
        # reviewed wallet migrations are applied in the separate post-upgrade
        # rehearsal below, matching their canonical dependency order.
        continue
        ;;
    esac
    case "$migration_name" in
      20261030122423_supplier_catalog_multigame_import.sql|\
      20261030135332_vouchers_001_campaign_engine.sql|\
      20261030211523_vouchers_001_rpc_abuse_boundary.sql)
        # These appended catalog/campaign/security migrations are timestamped after
        # the wallet migrations, so defer them until that chronological
        # segment is applied.
        continue
        ;;
    esac
    source_migration="$project_root/supabase/migrations/$migration_name"
    echo "LEGACY_UPGRADE_CANDIDATE=$migration_name"
    [ -f "$source_migration" ] || {
      echo "ERROR: Canonical upgrade migration is missing: $migration_name" >&2
      exit 13
    }
    if grep -Eiq '(cron\.schedule|net\.http|http_post|http_get|https://[^[:space:]]+/functions/)' "$source_migration"; then
      echo "ERROR: Canonical upgrade sequence contains an unsafe outbound/scheduled migration: $migration_name" >&2
      exit 13
    fi
    cp "$source_migration" "$test_root/supabase/migrations/$migration_name"
    upgrade_count=$((upgrade_count + 1))
  done < <(awk -F'|' '/\| INCLUDE \|/ {gsub(/`/, "", $4); gsub(/^[ \t]+|[ \t]+$/, "", $4); print $4}' "$project_root/docs/transformation/CANONICAL_DISPOSABLE_MIGRATION_SEQUENCE.md")

  manifest_count="$(awk -F'|' '/\| INCLUDE \|/ { count++ } END { print count + 0 }' "$project_root/docs/transformation/CANONICAL_DISPOSABLE_MIGRATION_SEQUENCE.md")"
  wallet_migration_count=3
  post_wallet_migration_count=3
  pre_wallet_manifest_count=$((manifest_count - wallet_migration_count - post_wallet_migration_count))
  expected_upgrade_count=$((pre_wallet_manifest_count - 11))
  if [ "$upgrade_count" -ne "$expected_upgrade_count" ]; then
    echo "ERROR: Expected $expected_upgrade_count canonical post-baseline migrations from the reviewed manifest; found $upgrade_count." >&2
    exit 13
  fi
  echo "LEGACY_UPGRADE_PHASE=canonical-selection-complete count=$upgrade_count"
  supabase_local migration up
  echo "LEGACY_UPGRADE_PHASE=canonical-apply-complete"
  PGOPTIONS='-c statement_timeout=30000' psql "$db_url" --set ON_ERROR_STOP=1 \
    --set expected_migration_count="$pre_wallet_manifest_count" \
    --file supabase/tests/database/existing-schema-upgrade.sql
  echo "LEGACY_UPGRADE_PHASE=seed-synthetic-order-payment"
  PGOPTIONS='-c statement_timeout=30000' psql "$db_url" --set ON_ERROR_STOP=1 \
    --file supabase/tests/database/rf-coins-payment-compatibility-before-upgrade.sql
  # A second migration-up must be a no-op. This is separate from db reset so
  # forward-only and duplicate-history behavior are exercised.
  supabase_local migration up

  echo "LEGACY_UPGRADE_PHASE=rf-coins-current-schema-rehearsal"
  echo "LEGACY_UPGRADE_PHASE=postgres17-default-acl-fixture"
  PGOPTIONS='-c statement_timeout=30000' psql "$db_url" --set ON_ERROR_STOP=1 \
    --file supabase/tests/database/rf-coins-default-acl-fixture.sql
  for migration_name in \
    20261028120000_rf_coins_schema.sql \
    20261028120100_rf_coins_functions.sql \
    20261028120200_rf_coin_admin_center_read.sql; do
    source_migration="$project_root/supabase/migrations/$migration_name"
    test -s "$source_migration" || {
      echo "ERROR: Canonical RF Coins migration is missing: $migration_name" >&2
      exit 13
    }
    cp "$source_migration" "$test_root/supabase/migrations/$migration_name"
  done
  # This rehearsal intentionally applies wallet migrations whose timestamps
  # precede the already-applied AdminOps migration. Supabase CLI requires
  # --include-all to apply this reviewed out-of-order fixture sequence.
  supabase_local migration up --include-all
  echo "LEGACY_UPGRADE_PHASE=post-wallet-catalog-campaign-security-migrations"
  for post_wallet_migration in \
    20261030122423_supplier_catalog_multigame_import.sql \
    20261030135332_vouchers_001_campaign_engine.sql \
    20261030211523_vouchers_001_rpc_abuse_boundary.sql; do
    source_migration="$project_root/supabase/migrations/$post_wallet_migration"
    test -s "$source_migration" || {
      echo "ERROR: Canonical post-wallet migration is missing: $post_wallet_migration" >&2
      exit 13
    }
    cp "$source_migration" "$test_root/supabase/migrations/$post_wallet_migration"
    # These deferred catalog/campaign migrations also precede AdminOps in the
    # migration ledger, so include-all is required for the synthetic upgrade.
    supabase_local migration up --include-all
  done
  PGOPTIONS='-c statement_timeout=30000' psql "$db_url" --set ON_ERROR_STOP=1 \
    --set expected_migration_count="$manifest_count" \
    --file supabase/tests/database/rf-coins-current-schema-upgrade.sql
  echo "LEGACY_UPGRADE_PHASE=rf-coins-current-schema-rehearsal-complete"
else
  supabase_local db reset
fi

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

echo "Executing narrow supplier transaction grant assertions..."
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" \
  --set ON_ERROR_STOP=1 \
  --file supabase/tests/supplier_transactions_service_role_grants.sql

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

echo "Executing metadata-only ACL inventory against the disposable PostgreSQL 17 database..."
acl_metadata_output="$test_root/hosted-acl-metadata-validation.jsonl"
psql "$db_url" --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 \
  --file supabase/tests/hosted-acl-metadata-audit.sql > "$acl_metadata_output"
node - "$acl_metadata_output" <<'NODE'
const fs = require('node:fs');
const [outputPath] = process.argv.slice(2);
const lines = fs.readFileSync(outputPath, 'utf8').trim().split(/\r?\n/);
if (lines.length !== 9) throw new Error(`expected 9 metadata sections, got ${lines.length}`);
const rows = lines.map((line) => JSON.parse(line));
const expected = [
  'database', 'tables', 'effective_table_privileges', 'direct_relation_acl',
  'default_acl', 'role_memberships', 'payment_transactions', 'public_functions', 'scheduled_jobs',
];
if (rows.some((row, index) => row.section !== expected[index])) {
  throw new Error('metadata sections are missing, duplicated, or incorrectly ordered');
}
const data = Object.fromEntries(rows.map((row) => [row.section, row.data]));
const tableCount = Number(data.database.public_table_count);
if (Number(data.database.server_version_num) < 170000) throw new Error('database is below PostgreSQL 17');
if (data.database.required_roles_present !== true) throw new Error('required Supabase roles are missing');
if (tableCount < 1 || data.tables.length !== tableCount || data.direct_relation_acl.length !== tableCount) {
  throw new Error('public table or direct ACL inventory is incomplete');
}
if (data.effective_table_privileges.length !== tableCount * 2) {
  throw new Error('effective anon/authenticated privilege inventory is incomplete');
}
if (data.payment_transactions.exists !== true) throw new Error('payment_transactions metadata is absent');
const tableNames = new Set(data.tables.map((table) => table.name));
for (const table of data.effective_table_privileges) {
  if (!tableNames.has(table.table) || !['anon', 'authenticated'].includes(table.role)) {
    throw new Error('effective privilege row references an unexpected table or role');
  }
}
for (const table of data.direct_relation_acl) {
  if (!tableNames.has(table.table) || !Array.isArray(table.entries)) {
    throw new Error('direct ACL provenance is incomplete');
  }
}
process.stdout.write(`HOSTED_ACL_METADATA_POSTGRES17_FIXTURE_PASS tables=${tableCount} sections=${rows.length}\n`);
NODE

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
  --command "UPDATE public.orders SET reference = CASE id WHEN '00000000-0000-0000-0000-000000000605' THEN 'RF-OUTBOX-WORKER-2' WHEN '00000000-0000-0000-0000-000000000606' THEN 'RF-OUTBOX-WORKER-3' END WHERE id IN ('00000000-0000-0000-0000-000000000605', '00000000-0000-0000-0000-000000000606');
UPDATE public.order_email_outbox AS outbox
SET receipt_snapshot = jsonb_build_object(
      'reference', ord.reference,
      'total_cents', ord.total_cents,
      'payment_method', ord.payment_method,
      'game_name', game.name,
      'package_name', package.name,
      'quantity', ord.quantity,
      'masked_player_identifier', CASE
        WHEN length(NULLIF(btrim(COALESCE(ord.player_inputs->>'user_id', ord.player_inputs->>'player_id', ord.player_inputs->>'uid', ord.player_inputs->>'riot_id')), '')) <= 4
          THEN repeat('*', length(NULLIF(btrim(COALESCE(ord.player_inputs->>'user_id', ord.player_inputs->>'player_id', ord.player_inputs->>'uid', ord.player_inputs->>'riot_id')), '')))
        ELSE repeat('*', length(NULLIF(btrim(COALESCE(ord.player_inputs->>'user_id', ord.player_inputs->>'player_id', ord.player_inputs->>'uid', ord.player_inputs->>'riot_id')), '')) - 4)
          || right(NULLIF(btrim(COALESCE(ord.player_inputs->>'user_id', ord.player_inputs->>'player_id', ord.player_inputs->>'uid', ord.player_inputs->>'riot_id')), ''), 4)
      END,
      'completed_at', outbox.completed_at
    ),
    status = 'pending', attempt_count = 0, lease_token = NULL,
    lease_until = NULL, next_attempt_at = clock_timestamp()
FROM public.orders AS ord
JOIN public.games AS game ON game.id = ord.game_id
JOIN public.packages AS package ON package.id = ord.package_id
WHERE outbox.order_id = ord.id
  AND outbox.id IN ('00000000-0000-0000-0000-000000000609', '00000000-0000-0000-0000-000000000610');
DO \$\$ BEGIN
  IF (SELECT count(*) FROM public.order_email_outbox
      WHERE id IN ('00000000-0000-0000-0000-000000000609', '00000000-0000-0000-0000-000000000610')) <> 2 THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_INTEGRATION_FIXTURE_MISSING';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.order_email_outbox
    WHERE id IN ('00000000-0000-0000-0000-000000000609', '00000000-0000-0000-0000-000000000610')
      AND CASE WHEN jsonb_typeof(receipt_snapshot) = 'object'
        THEN (SELECT count(*) FROM jsonb_object_keys(receipt_snapshot)) <> 8
        ELSE true END
  ) THEN RAISE EXCEPTION 'OUTBOX_WORKER_INTEGRATION_FIXTURE_SNAPSHOT_INVALID'; END IF;
END \$\$;"
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
