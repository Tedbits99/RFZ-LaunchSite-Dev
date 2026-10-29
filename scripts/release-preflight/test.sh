#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
script="$repo/scripts/release-preflight/run.sh"
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
manifest="$repo/docs/transformation/CANONICAL_DISPOSABLE_MIGRATION_SEQUENCE.md"
manifest_sha=$(sha256sum -- "$manifest" | awk '{print $1}')
sha=$(git -C "$repo" rev-parse HEAD)
branch=$(git -C "$repo" symbolic-ref --short HEAD)

make_fixture() {
  printf '%s\n' 'Next.js checks' 'Production release safety' > "$fixture/checks.txt.required"
  printf '%s\n' 'PASS|Next.js checks' 'PASS|Production release safety' > "$fixture/checks.txt"
  printf '%s\n' 'protected main requires review' > "$fixture/protection.txt.required"
  printf '%s\n' 'PASS|protected main requires review' > "$fixture/protection.txt"
  printf '%s\n' 'LOCK=engaged' 'AUTO_MERGE=disabled' 'PAYMENTS=disabled' 'SUPPLIER_FULFILLMENT=disabled' 'RF_COINS=disabled' > "$fixture/lock.txt"
  printf '%s\n' 'ORIGIN=synthetic' 'SYNTHETIC_FIXTURE=PASS' > "$fixture/evidence.txt"
}

run_gate() {
  bash "$script" --repo "$repo" --expected-sha "$sha" --expected-branch "$branch" \
    --expected-manifest-sha "$manifest_sha" --config "$repo/docs/release-readiness/parallel-agent/environment-names.txt" \
    --migration-manifest "$manifest" --checks "$fixture/checks.txt" --protection "$fixture/protection.txt" \
    --release-lock "$fixture/lock.txt" --rollback "$repo/docs/release-readiness/parallel-agent/production-launch-runbook.md" \
    --evidence "$fixture/evidence.txt" --evidence-origin synthetic >/dev/null
}

expect_blocked() {
  local name=$1; shift
  if "$@" >/dev/null 2>&1; then
    echo "FAIL: $name was accepted" >&2
    exit 1
  fi
  echo "PASS: $name blocked"
}

make_fixture
run_gate
echo 'PASS: valid synthetic evidence accepted'

printf '%s\n' 'PASS|Next.js checks' 'PASS|Next.js checks' 'PASS|Production release safety' > "$fixture/checks.txt"
expect_blocked duplicate-pass run_gate
printf '%s\n' 'PASS|Next.js checks' 'PASS|Production release safety' 'PASS|stale check' > "$fixture/checks.txt"
expect_blocked stale-pass run_gate
printf '%s\n' 'PASS|Next.js checks' 'PASS|Production release safety' > "$fixture/checks.txt"
printf '%s\n' 'NOTPASS|Next.js checks' 'PASS|Production release safety' > "$fixture/checks.txt"
expect_blocked spoofed-pass run_gate
make_fixture
printf '%s\n' 'LOCK=engaged # spoof' 'AUTO_MERGE=disabled' 'PAYMENTS=disabled' 'SUPPLIER_FULFILLMENT=disabled' 'RF_COINS=disabled' > "$fixture/lock.txt"
expect_blocked malformed-lock run_gate
make_fixture
printf '%s\n' 'ORIGIN=synthetic' > "$fixture/evidence.txt"
expect_blocked missing-synthetic-marker run_gate
make_fixture
expect_blocked manifest-target-mismatch bash "$script" --repo "$repo" --expected-sha "$sha" --expected-branch "$branch" \
  --expected-manifest-sha "0000000000000000000000000000000000000000000000000000000000000000" \
  --config "$repo/docs/release-readiness/parallel-agent/environment-names.txt" --migration-manifest "$manifest" \
  --checks "$fixture/checks.txt" --protection "$fixture/protection.txt" --release-lock "$fixture/lock.txt" \
  --rollback "$repo/docs/release-readiness/parallel-agent/production-launch-runbook.md" --evidence "$fixture/evidence.txt" --evidence-origin synthetic
