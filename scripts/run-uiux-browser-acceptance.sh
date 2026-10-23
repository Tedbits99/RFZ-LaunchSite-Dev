#!/usr/bin/env bash
set -euo pipefail

: "${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is required}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?NEXT_PUBLIC_SUPABASE_ANON_KEY is required}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required}"
: "${RFZ_UIUX_FIXTURE_FILE:?RFZ_UIUX_FIXTURE_FILE is required}"

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
server_log="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/runfazone-uiux-next.log"
server_pid=""
cleanup_server() {
  status=$?
  node "$project_root/scripts/cleanup-uiux-browser-fixtures.mjs" >/dev/null 2>&1 || true
  if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  exit "$status"
}
trap cleanup_server EXIT

export NEXT_PUBLIC_APP_URL="http://127.0.0.1:3000"
export UIUX_BROWSER_BASE_URL="$NEXT_PUBLIC_APP_URL"
export NODE_ENV="test"

node "$project_root/scripts/prepare-uiux-browser-fixtures.mjs"

(cd "$project_root" && npm run dev -- --hostname 127.0.0.1 >"$server_log" 2>&1) &
server_pid=$!
for _ in $(seq 1 60); do
  if curl --silent --fail "$NEXT_PUBLIC_APP_URL/login" >/dev/null; then break; fi
  sleep 1
done
curl --silent --fail "$NEXT_PUBLIC_APP_URL/login" >/dev/null || {
  sed -n '1,160p' "$server_log" >&2
  echo "ERROR: Next.js did not become ready for browser acceptance." >&2
  exit 1
}

(cd "$project_root" && npx playwright test)
