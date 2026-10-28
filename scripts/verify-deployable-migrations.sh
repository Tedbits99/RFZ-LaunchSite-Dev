#!/usr/bin/env bash
set -euo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
manifest="$project_root/docs/transformation/CANONICAL_DISPOSABLE_MIGRATION_SEQUENCE.md"
migrations="$project_root/supabase/migrations"
tmp_root="$(mktemp -d)"
trap 'rm -rf -- "$tmp_root"' EXIT

scan_external_operations() {
  local path="$1"
  if ! command -v grep >/dev/null 2>&1; then
    echo 'ERROR: required migration safety scanner (grep) is unavailable.' >&2
    return 2
  fi

  local scan_status=0
  grep -R -n -E -i -- '(cron\.schedule|net\.http|(extensions\.)?http_(post|get|put|delete|head|patch)|https?://)' "$path" \
    || scan_status=$?
  case "$scan_status" in
    0)
      echo 'ERROR: migration sequence contains an external scheduler or HTTP target.' >&2
      return 1
      ;;
    1)
      return 0
      ;;
    *)
      echo "ERROR: migration safety scan failed (grep exit $scan_status)." >&2
      return 2
      ;;
  esac
}

run_self_test() {
  local fixture="$tmp_root/self-test"
  mkdir -p "$fixture/clean" "$fixture/dangerous" "$fixture/no-tools" "$fixture/failing-tools"
  printf '%s\n' 'select 1;' > "$fixture/clean/0001.sql"
  printf '%s\n' "select net.http_post('https://example.invalid');" > "$fixture/dangerous/0001.sql"
  printf '#!/bin/sh\nexit 2\n' > "$fixture/failing-tools/grep"
  chmod +x "$fixture/failing-tools/grep"

  scan_external_operations "$fixture/clean" || {
    echo 'ERROR: clean migration fixture was rejected.' >&2
    return 1
  }
  if scan_external_operations "$fixture/dangerous"; then
    echo 'ERROR: external-operation fixture was not rejected.' >&2
    return 1
  fi
  if PATH="$fixture/no-tools" scan_external_operations "$fixture/clean"; then
    echo 'ERROR: missing scanner was accepted.' >&2
    return 1
  fi
  if PATH="$fixture/failing-tools" scan_external_operations "$fixture/clean"; then
    echo 'ERROR: scanner execution failure was accepted.' >&2
    return 1
  fi
  echo 'DEPLOYABLE_MIGRATION_SAFETY_SCANNER_SELF_TEST_PASS'
}

if [[ "${1:-}" == '--self-test' ]]; then
  run_self_test
  exit
fi

awk -F'|' '/\| INCLUDE \|/ {
  gsub(/`/, "", $4)
  gsub(/^[ \t]+|[ \t]+$/, "", $4)
  print $4
}' "$manifest" | sort > "$tmp_root/expected"
find "$migrations" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sort > "$tmp_root/actual"

if ! diff -u "$tmp_root/expected" "$tmp_root/actual"; then
  echo 'ERROR: executable migration directory differs from the reviewed canonical manifest.' >&2
  exit 1
fi

command -v sha256sum >/dev/null 2>&1 || {
  echo 'ERROR: required SHA-256 migration verifier is unavailable.' >&2
  exit 1
}
if ! awk -F'|' '/\| INCLUDE \|/ {
  gsub(/`/, "", $4)
  gsub(/^[ \t]+|[ \t]+$/, "", $4)
  gsub(/`/, "", $5)
  gsub(/^[ \t]+|[ \t]+$/, "", $5)
  if ($4 !~ /^[A-Za-z0-9_.-]+\.sql$/ || length($5) != 64 || $5 !~ /^[0-9a-f]+$/) exit 2
  print $4 "\t" $5
}' "$manifest" > "$tmp_root/expected-hashes"; then
  echo 'ERROR: canonical migration manifest contains an invalid filename or SHA-256.' >&2
  exit 1
fi
while IFS="$(printf '\t')" read -r filename expected_hash; do
  [ -n "$filename" ] || continue
  migration_path="$migrations/$filename"
  [ -f "$migration_path" ] || {
    echo "ERROR: canonical migration file is missing: $filename" >&2
    exit 1
  }
  actual_hash="$(sha256sum -- "$migration_path" | awk '{print $1}')"
  [ "$actual_hash" = "$expected_hash" ] || {
    echo "ERROR: canonical migration checksum mismatch: $filename" >&2
    exit 1
  }
done < "$tmp_root/expected-hashes"

count="$(wc -l < "$tmp_root/actual" | tr -d ' ')"
[ "$count" -gt 0 ] || {
  echo 'ERROR: executable migration directory is empty.' >&2
  exit 1
}

if ! scan_external_operations "$migrations"; then
  echo 'ERROR: executable migration sequence did not pass its external-operation safety scan.' >&2
  exit 1
fi

for pending_migrations in \
  "$project_root/supabase/migrations-pending" \
  "$project_root/supabase/migrations-pending-provider"; do
  if [ -d "$pending_migrations" ] && ! scan_external_operations "$pending_migrations"; then
    echo "ERROR: pending SQL set did not pass its external-operation safety scan: ${pending_migrations##*/}." >&2
    exit 1
  fi
done

echo "DEPLOYABLE_MIGRATION_MANIFEST_PASS count=$count"
