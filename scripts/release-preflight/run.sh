#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo 'usage: run.sh --repo DIR --expected-sha SHA --expected-branch BRANCH --expected-manifest-sha SHA256 --config FILE --migration-manifest FILE --checks FILE --protection FILE --release-lock FILE --rollback FILE --evidence FILE --evidence-origin synthetic|hosted-independent' >&2
  exit 2
}

repo= expected_sha= expected_branch= expected_manifest_sha= config= manifest=
checks= protection= lock= rollback= evidence= evidence_origin=
while (($#)); do
  case "$1" in
    --repo) repo=${2-}; shift 2;;
    --expected-sha) expected_sha=${2-}; shift 2;;
    --expected-branch) expected_branch=${2-}; shift 2;;
    --expected-manifest-sha) expected_manifest_sha=${2-}; shift 2;;
    --config) config=${2-}; shift 2;;
    --migration-manifest) manifest=${2-}; shift 2;;
    --checks) checks=${2-}; shift 2;;
    --protection) protection=${2-}; shift 2;;
    --release-lock) lock=${2-}; shift 2;;
    --rollback) rollback=${2-}; shift 2;;
    --evidence) evidence=${2-}; shift 2;;
    --evidence-origin) evidence_origin=${2-}; shift 2;;
    *) usage;;
  esac
done
[[ -n "$repo" && -n "$expected_sha" && -n "$expected_branch" && -n "$expected_manifest_sha" && -n "$config" && -n "$manifest" && -n "$checks" && -n "$protection" && -n "$lock" && -n "$rollback" && -n "$evidence" && -n "$evidence_origin" ]] || usage
[[ "$evidence_origin" == synthetic || "$evidence_origin" == hosted-independent ]] || usage

cd -- "$repo"
fail() { echo "BLOCKED: $*" >&2; exit 1; }
command -v rg >/dev/null 2>&1 || fail 'ripgrep (rg) is required but unavailable'
rg --version >/dev/null 2>&1 || fail 'ripgrep (rg) failed its version check'
[[ "$expected_sha" =~ ^[0-9a-fA-F]{40}$ ]] || fail 'expected SHA is not a full commit SHA'
[[ "$expected_manifest_sha" =~ ^[0-9a-fA-F]{64}$ ]] || fail 'expected manifest SHA is not a SHA-256'
[[ "$expected_branch" =~ ^[A-Za-z0-9._/-]+$ ]] || fail 'expected branch contains unsafe characters'

for f in "$config" "$manifest" "$checks" "$protection" "$lock" "$rollback" "$evidence" "$checks.required" "$protection.required"; do
  [[ -s "$f" ]] || fail "required evidence is missing or empty: $f"
done
actual_sha=$(git rev-parse HEAD 2>/dev/null) || fail 'not a Git checkout'
[[ "$actual_sha" == "$expected_sha" ]] || fail "HEAD SHA mismatch (expected $expected_sha, got $actual_sha)"
actual_branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null) || fail 'detached HEAD is not releasable'
[[ "$actual_branch" == "$expected_branch" ]] || fail "branch mismatch (expected $expected_branch, got $actual_branch)"
actual_manifest_sha=$(sha256sum -- "$manifest" | awk '{print $1}')
[[ "$actual_manifest_sha" == "$expected_manifest_sha" ]] || fail "migration manifest SHA mismatch (expected $expected_manifest_sha, got $actual_manifest_sha)"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
while IFS= read -r name || [[ -n "$name" ]]; do
  [[ -z "$name" || "$name" == \#* ]] && continue
  [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || fail "invalid configuration name in $config"
  rg -l --hidden --glob '!.git/**' --glob '!node_modules/**' -F -- "$name" . >/dev/null || fail "configuration name is undocumented: $name"
done < "$config"

awk -F'|' '/\| (INCLUDE|EXCLUDE) \|/ {
  gsub(/^[[:space:]]+|[[:space:]]+$/, "", $3); gsub(/^[[:space:]]+|[[:space:]]+$/, "", $4); gsub(/^[[:space:]]+|[[:space:]]+$/, "", $5)
  gsub(/`/, "", $4); gsub(/`/, "", $5); print $3 "\t" $4 "\t" $5
}' "$manifest" > "$tmp/entries"
[[ -s "$tmp/entries" ]] || fail 'migration manifest has no entries'
if ! awk -F '\t' '{ if (++seen[$2] > 1) exit 1 }' "$tmp/entries"; then
  fail 'migration manifest contains a duplicated or contradictory filename'
fi
awk -F '\t' '$1=="INCLUDE" {print $2}' "$tmp/entries" | sort -u > "$tmp/included"
find supabase/migrations -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sort -u > "$tmp/actual"
diff -u "$tmp/included" "$tmp/actual" >/dev/null || fail 'migration manifest and supabase/migrations differ'
while IFS=$'\t' read -r action filename digest _; do
  [[ "$action" == INCLUDE || "$action" == EXCLUDE ]] || fail "invalid migration manifest action: $action"
  [[ "$filename" =~ ^[A-Za-z0-9_.-]+\.sql$ ]] || fail "invalid migration manifest filename: $filename"
  if [[ "$action" == INCLUDE ]]; then
    [[ "$digest" =~ ^[0-9a-fA-F]{64}$ ]] || fail "invalid migration checksum: $filename"
    [[ "$(sha256sum -- "supabase/migrations/$filename" | awk '{print $1}')" == "$digest" ]] || fail "migration checksum mismatch: $filename"
  else
    [[ ! -e "supabase/migrations/$filename" ]] || fail "excluded migration is present in source tree: $filename"
  fi
done < "$tmp/entries"

validate_exact_evidence() {
  local evidence_file=$1 required_file=$2 label=$3 line item
  declare -A required_seen=() evidence_seen=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" != *'|'* && "$line" != *$'\t'* ]] || fail "$label required context is malformed"
    [[ "$line" =~ ^[^[:space:]|].*[^[:space:]|]$ ]] || fail "$label required context is malformed"
    [[ -z "${required_seen[$line]+x}" ]] || fail "$label required context is duplicated: $line"
    required_seen["$line"]=1
  done < "$required_file"
  ((${#required_seen[@]} > 0)) || fail "$label has no required contexts"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" =~ ^PASS\|[^[:space:]|].*[^[:space:]|]$ ]] || fail "$label evidence line is malformed"
    item=${line#PASS|}
    [[ -n "${required_seen[$item]+x}" ]] || fail "$label evidence is stale or unexpected: $item"
    [[ -z "${evidence_seen[$item]+x}" ]] || fail "$label evidence is duplicated: $item"
    evidence_seen["$item"]=1
  done < "$evidence_file"
  for item in "${!required_seen[@]}"; do
    [[ -n "${evidence_seen[$item]+x}" ]] || fail "$label evidence is missing: $item"
  done
}
validate_exact_evidence "$checks" "$checks.required" checks
validate_exact_evidence "$protection" "$protection.required" protection

declare -A lock_seen=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  case "$line" in
    LOCK=engaged|AUTO_MERGE=disabled|PAYMENTS=disabled|SUPPLIER_FULFILLMENT=disabled|RF_COINS=disabled) ;;
    *) fail 'release lock contains malformed or contradictory text';;
  esac
  [[ -z "${lock_seen[$line]+x}" ]] || fail "release lock entry is duplicated: $line"
  lock_seen["$line"]=1
done < "$lock"
for state in LOCK=engaged AUTO_MERGE=disabled PAYMENTS=disabled SUPPLIER_FULFILLMENT=disabled RF_COINS=disabled; do
  [[ -n "${lock_seen[$state]+x}" ]] || fail "unsafe or unverified release lock: $state"
done

for heading in '## Rollback trigger' '## Rollback procedure' '## Recovery owner'; do
  rg -q --fixed-strings -- "$heading" "$rollback" || fail "rollback documentation missing: $heading"
done
case "$evidence_origin" in
  synthetic)
    rg -Fxq -- 'ORIGIN=synthetic' "$evidence" || fail 'synthetic evidence origin is not declared exactly'
    rg -Fxq -- 'SYNTHETIC_FIXTURE=PASS' "$evidence" || fail 'synthetic fixture marker is missing';;
  hosted-independent)
    rg -Fxq -- 'ORIGIN=hosted-independent' "$evidence" || fail 'hosted evidence origin is not declared exactly'
    rg -Fxq -- 'INDEPENDENT_VERIFICATION=PASS' "$evidence" || fail 'independent hosted verification marker is missing'
    rg -q -- '^HOSTED_EVIDENCE_ID=[^[:space:]].*$' "$evidence" || fail 'hosted evidence identifier is missing';;
esac
echo "PREFLIGHT_PASS sha=$actual_sha branch=$actual_branch manifest_sha=$actual_manifest_sha migrations=$(wc -l < "$tmp/actual") evidence_origin=$evidence_origin"
