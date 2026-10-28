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

if rg -n -i '(cron\.schedule|net\.http|http_post|http_get|https://[^[:space:]]+/functions/)' "$migrations"; then
  echo 'ERROR: executable migration sequence contains an external scheduler or HTTP target.' >&2
  exit 1
fi

echo "DEPLOYABLE_MIGRATION_MANIFEST_PASS count=$count"
