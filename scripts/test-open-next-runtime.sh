#!/usr/bin/env bash

set -euo pipefail

port="${OPEN_NEXT_SMOKE_PORT:-8787}"
base_url="http://127.0.0.1:${port}"
log_file="${RUNNER_TEMP:-/tmp}/runfazone-open-next-runtime.log"
config_home="${XDG_CONFIG_HOME:-${RUNNER_TEMP:-/tmp}/rfz-xdg}"

mkdir -p "$config_home"

cleanup() {
  if [[ -n "${worker_pid:-}" ]]; then
    kill "$worker_pid" 2>/dev/null || true
    wait "$worker_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

test -s .open-next/worker.js || {
  echo 'RUNTIME_SMOKE_FAIL: .open-next/worker.js is missing or empty.' >&2
  exit 1
}
test -d .open-next/assets || {
  echo 'RUNTIME_SMOKE_FAIL: .open-next/assets is missing.' >&2
  exit 1
}

XDG_CONFIG_HOME="$config_home" npx --yes wrangler@4.151.3 dev \
  --local \
  --port "$port" \
  --config wrangler.jsonc \
  >"$log_file" 2>&1 &
worker_pid=$!

ready=0
for attempt in {1..30}; do
  if curl --silent --show-error --max-time 3 --fail "$base_url/" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$worker_pid" 2>/dev/null; then
    echo 'RUNTIME_SMOKE_FAIL: local Worker exited before becoming ready.' >&2
    tail -80 "$log_file" >&2 || true
    exit 1
  fi
  sleep 1
done

if (( ready == 0 )); then
  echo 'RUNTIME_SMOKE_FAIL: local Worker did not become ready within 30 seconds.' >&2
  tail -80 "$log_file" >&2 || true
  exit 1
fi

homepage="$(mktemp)"
trap 'rm -f "$homepage"; cleanup' EXIT
status="$(curl --silent --show-error --max-time 15 --output "$homepage" --write-out '%{http_code}' "$base_url/")"
[[ "$status" == 200 ]] || {
  echo "RUNTIME_SMOKE_FAIL: homepage returned HTTP $status." >&2
  tail -80 "$log_file" >&2 || true
  exit 1
}
grep -Eqi 'RunFazone|Game Top-Up Made Easy' "$homepage" || {
  echo 'RUNTIME_SMOKE_FAIL: homepage did not contain the expected RunFazone application marker.' >&2
  exit 1
}

css_path="$(grep -Eo 'href="/[^"]+\.css"' "$homepage" | head -1 | cut -d'"' -f2)"
js_path="$(grep -Eo 'src="/[^"]+\.js"' "$homepage" | head -1 | cut -d'"' -f2)"
[[ -n "$css_path" && -n "$js_path" ]] || {
  echo 'RUNTIME_SMOKE_FAIL: homepage did not expose both CSS and JavaScript assets.' >&2
  exit 1
}

for asset_path in "$css_path" "$js_path"; do
  asset_headers="$(mktemp)"
  asset_body="$(mktemp)"
  asset_status="$(curl --silent --show-error --max-time 15 --dump-header "$asset_headers" --output "$asset_body" --write-out '%{http_code}' "$base_url$asset_path")"
  [[ "$asset_status" == 200 ]] || {
    echo "RUNTIME_SMOKE_FAIL: static asset $asset_path returned HTTP $asset_status." >&2
    rm -f "$asset_headers" "$asset_body"
    exit 1
  }
  asset_type="$(sed -n -E 's/^[Cc]ontent-[Tt]ype:[[:space:]]*//p' "$asset_headers" | head -1 | tr -d '\r')"
  if [[ "$asset_path" == *.css ]]; then
    [[ "$asset_type" == text/css* ]] || {
      echo "RUNTIME_SMOKE_FAIL: CSS asset $asset_path returned unexpected content type $asset_type." >&2
      rm -f "$asset_headers" "$asset_body"
      exit 1
    }
    for marker in 'tailwindcss v4.' '.h-10{' '.px-5{' '.rounded-2xl{' '.text-3xl{' '.grid-cols-2{' '.lg\:grid-cols-4{'; do
      grep -Fq -- "$marker" "$asset_body" || {
        echo "RUNTIME_SMOKE_FAIL: CSS asset $asset_path is missing required compiled utility $marker." >&2
        rm -f "$asset_headers" "$asset_body"
        exit 1
      }
    done
    ! grep -Fq -- '@tailwind' "$asset_body" || {
      echo "RUNTIME_SMOKE_FAIL: CSS asset $asset_path still contains legacy @tailwind directives." >&2
      rm -f "$asset_headers" "$asset_body"
      exit 1
    }
  else
    [[ "$asset_type" == text/javascript* || "$asset_type" == application/javascript* ]] || {
      echo "RUNTIME_SMOKE_FAIL: JavaScript asset $asset_path returned unexpected content type $asset_type." >&2
      rm -f "$asset_headers" "$asset_body"
      exit 1
    }
  fi
  rm -f "$asset_headers" "$asset_body"
done

for route in /login /account /checkout /secure-admin-login; do
  route_status="$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' "$base_url$route")"
  [[ "$route_status" == 200 ]] || {
    echo "RUNTIME_SMOKE_FAIL: application route $route returned HTTP $route_status." >&2
    tail -80 "$log_file" >&2 || true
    exit 1
  }
done

if grep -Eqi 'loadManifest|Unhandled|TypeError:|ReferenceError:|SyntaxError:' "$log_file"; then
  echo 'RUNTIME_SMOKE_FAIL: local Worker log contains an unhandled runtime exception.' >&2
  tail -80 "$log_file" >&2 || true
  exit 1
fi

echo 'RUNTIME_SMOKE_PASS: OpenNext Worker rendered the homepage, application routes, and CSS/JavaScript assets without runtime exceptions.'
