#!/usr/bin/env bash
set -euo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
manifest="$project_root/docs/transformation/CANONICAL_DISPOSABLE_MIGRATION_SEQUENCE.md"
migrations="$project_root/supabase/migrations"
tmp_root="$(mktemp -d)"
trap 'rm -rf -- "$tmp_root"' EXIT

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

count="$(wc -l < "$tmp_root/actual" | tr -d ' ')"
[ "$count" = 98 ] || {
  echo "ERROR: expected 98 executable migrations, found $count." >&2
  exit 1
}

if rg -n -i '(cron\.schedule|net\.http|http_post|http_get|https://[^[:space:]]+/functions/)' "$migrations"; then
  echo 'ERROR: executable migration sequence contains an external scheduler or HTTP target.' >&2
  exit 1
fi

echo "DEPLOYABLE_MIGRATION_MANIFEST_PASS count=$count"
