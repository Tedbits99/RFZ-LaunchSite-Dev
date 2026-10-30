#!/usr/bin/env bash
set -euo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
stack_root="$(mktemp -d /tmp/rfz-vouchers-001.XXXXXX)"
stack_started=0
server_pid=''
cli_log="$stack_root/supabase-cli.log"

cleanup() {
  local exit_status=$?
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
  if [[ "$stack_started" == 1 ]]; then run_cli stop --no-backup >/dev/null 2>&1 || true; fi
  case "$stack_root" in
    /tmp/rfz-vouchers-001.*) rm -rf -- "$stack_root" ;;
    *) printf '%s\n' 'Refusing to remove an unexpected voucher fixture path.' >&2; exit_status=1 ;;
  esac
  exit "$exit_status"
}
trap cleanup EXIT INT TERM

cd "$project_root"
if command -v supabase >/dev/null 2>&1 && [[ "$(supabase --version)" == '2.121.0' ]]; then
  SUPABASE=(supabase)
else
  SUPABASE=(npx --yes supabase@2.121.0)
fi
run_cli() {
  env -u SUPABASE_ACCESS_TOKEN -u SUPABASE_DB_PASSWORD -u SUPABASE_PROJECT_ID \
    -u SUPABASE_DB_URL -u SUPABASE_PROJECT_REF \
    "${SUPABASE[@]}" --workdir "$RFZ_STACK_ROOT" "$@"
}

bash scripts/verify-deployable-migrations.sh --self-test
bash scripts/verify-deployable-migrations.sh
GITHUB_RUN_ID="${GITHUB_RUN_ID:-$(date -u +%s)}" GITHUB_RUN_ATTEMPT="${GITHUB_RUN_ATTEMPT:-1}" \
  node scripts/catalog-001/prepare-stack.mjs "$stack_root" "$stack_root/stack.env"
set -a
. "$stack_root/stack.env"
set +a
[[ ! -e "$RFZ_STACK_ROOT/supabase/.temp/project-ref" ]]
[[ "$(sed -n 's/^project_id = "\([^"]*\)"$/\1/p' "$RFZ_STACK_ROOT/supabase/config.toml")" == "$RFZ_STACK_PROJECT_ID" ]]
[[ "$RFZ_MIGRATION_FILE_COUNT" -gt 0 ]]

stack_started=1
if ! run_cli start --exclude studio,storage-api,imgproxy,realtime,edge-runtime,logflare,vector,postgres-meta,supavisor >"$cli_log" 2>&1; then
  printf '%s\n' 'Disposable PostgreSQL 17/Auth stack startup failed; sanitized diagnostics:' >&2
  node scripts/catalog-001/print-safe-log.mjs "$cli_log"
  exit 1
fi
if ! run_cli db reset --local --no-seed >"$cli_log" 2>&1; then
  printf '%s\n' 'Disposable canonical migration reset failed; sanitized diagnostics:' >&2
  node scripts/catalog-001/print-safe-log.mjs "$cli_log"
  exit 1
fi
run_cli status --output env > "$stack_root/status.env"
chmod 600 "$stack_root/status.env"
node scripts/catalog-001/export-stack-env.mjs "$stack_root/status.env" "$stack_root/test.env"
set -a
. "$stack_root/test.env"
set +a
node scripts/catalog-001/create-auth-fixtures.mjs "$stack_root/auth.env"
set -a
. "$stack_root/auth.env"
set +a
node scripts/catalog-001/seed-fixtures.mjs
node scripts/catalog-001/verify-local-database.mjs
node scripts/vouchers-001/verify-local-security.mjs

CATALOG_INTEGRATION_RUN=0 VOUCHERS_INTEGRATION_RUN=0 \
  env -u SUPABASE_SERVICE_ROLE_KEY npm test -- --pool=threads --no-file-parallelism --maxWorkers=1
npx tsc --noEmit
npm run lint
npm run build
npm run cloudflare:build

npm run start -- --hostname 127.0.0.1 --port 3000 >"$stack_root/next.log" 2>&1 &
server_pid=$!
ready=0
for _ in $(seq 1 90); do
  if curl --fail --silent http://127.0.0.1:3000/login >/dev/null; then ready=1; break; fi
  if ! kill -0 "$server_pid" >/dev/null 2>&1; then break; fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  printf '%s\n' 'Local Next.js server failed to become ready; sanitized diagnostics:' >&2
  node scripts/catalog-001/print-safe-log.mjs "$stack_root/next.log"
  exit 1
fi
CATALOG_INTEGRATION_RUN=1 VOUCHERS_INTEGRATION_RUN=1 \
  npm test -- --run tests/catalog-001/catalog-integration.test.ts tests/vouchers-001/vouchers-integration.test.ts \
  --pool=threads --no-file-parallelism --maxWorkers=1 --reporter=verbose
CATALOG_USE_EXISTING_SERVER=1 npx playwright test --config=playwright.vouchers-001.config.ts --reporter=list
printf 'VOUCHERS_001_DISPOSABLE_ACCEPTANCE_PASS migration_files=%s browser_projects=desktop,mobile provider_requests=0 release_locks=off\n' "$RFZ_MIGRATION_FILE_COUNT"
