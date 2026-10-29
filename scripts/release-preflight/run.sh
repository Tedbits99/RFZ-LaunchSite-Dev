#!/usr/bin/env bash
set -euo pipefail
usage(){ echo 'usage: run.sh --repo DIR --expected-sha SHA --expected-branch BRANCH --config FILE --migration-manifest FILE --checks FILE --protection FILE --release-lock FILE --rollback FILE --evidence FILE' >&2; exit 2; }
repo= expected_sha= expected_branch= config= manifest= checks= protection= lock= rollback= evidence=
while (($#)); do case "$1" in
  --repo) repo=${2-}; shift 2;; --expected-sha) expected_sha=${2-}; shift 2;; --expected-branch) expected_branch=${2-}; shift 2;;
  --config) config=${2-}; shift 2;; --migration-manifest) manifest=${2-}; shift 2;; --checks) checks=${2-}; shift 2;;
  --protection) protection=${2-}; shift 2;; --release-lock) lock=${2-}; shift 2;; --rollback) rollback=${2-}; shift 2;;
  --evidence) evidence=${2-}; shift 2;; *) usage;; esac; done
[[ -n "$repo" && -n "$expected_sha" && -n "$expected_branch" && -n "$config" && -n "$manifest" && -n "$checks" && -n "$protection" && -n "$lock" && -n "$rollback" && -n "$evidence" ]] || usage
cd -- "$repo"; fail(){ echo "BLOCKED: $*" >&2; exit 1; }
for f in "$config" "$manifest" "$checks" "$protection" "$lock" "$rollback" "$evidence" "$checks.required" "$protection.required"; do [[ -s "$f" ]] || fail "required evidence is missing or empty: $f"; done
actual_sha=$(git rev-parse HEAD 2>/dev/null) || fail 'not a Git checkout'
[[ "$expected_sha" =~ ^[0-9a-fA-F]{40}$ ]] || fail 'expected SHA is not a full commit SHA'
[[ "$actual_sha" == "$expected_sha" ]] || fail "HEAD SHA mismatch (expected $expected_sha, got $actual_sha)"
actual_branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null) || fail 'detached HEAD is not releasable'
[[ "$actual_branch" == "$expected_branch" ]] || fail "branch mismatch (expected $expected_branch, got $actual_branch)"
while IFS= read -r name || [[ -n "$name" ]]; do
  [[ -z "$name" || "$name" == \#* ]] && continue
  [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || fail "invalid configuration name in $config"
  rg -l --hidden --glob '!.git/**' --glob '!node_modules/**' -F -- "$name" . >/dev/null || fail "configuration name is undocumented: $name"
done < "$config"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
awk -F'|' '/\| (INCLUDE|EXCLUDE) \|/ { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $3); gsub(/^[[:space:]]+|[[:space:]]+$/, "", $4); gsub(/^[[:space:]]+|[[:space:]]+$/, "", $5); gsub(/`/, "", $4); gsub(/`/, "", $5); print $3 "\t" $4 "\t" $5 }' "$manifest" > "$tmp/entries"
[[ -s "$tmp/entries" ]] || fail 'migration manifest has no entries'
awk -F '\t' '$1=="INCLUDE" {print $2}' "$tmp/entries" | sort -u > "$tmp/included"
find supabase/migrations -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sort -u > "$tmp/actual"
diff -u "$tmp/included" "$tmp/actual" >/dev/null || fail 'migration manifest and supabase/migrations differ'
while IFS=$'\t' read -r action filename digest _; do
  [[ "$action" == INCLUDE ]] || continue
  [[ "$filename" =~ ^[A-Za-z0-9_.-]+\.sql$ && "$digest" =~ ^[0-9a-fA-F]{64}$ ]] || fail "invalid migration manifest row: $filename"
  [[ "$(sha256sum -- "supabase/migrations/$filename" | awk '{print $1}')" == "$digest" ]] || fail "migration checksum mismatch: $filename"
done < "$tmp/entries"
check_passes(){ rg -q --fixed-strings -- "PASS|$1" "$2" || fail "required evidence is not PASS: $1"; }
while IFS= read -r item || [[ -n "$item" ]]; do [[ -z "$item" || "$item" == \#* ]] || check_passes "$item" "$checks"; done < "$checks.required"
while IFS= read -r item || [[ -n "$item" ]]; do [[ -z "$item" || "$item" == \#* ]] || check_passes "$item" "$protection"; done < "$protection.required"
for state in 'LOCK=engaged' 'AUTO_MERGE=disabled' 'PAYMENTS=disabled' 'SUPPLIER_FULFILLMENT=disabled' 'RF_COINS=disabled'; do rg -q --fixed-strings -- "$state" "$lock" || fail "unsafe or unverified release lock: $state"; done
for heading in '## Rollback trigger' '## Rollback procedure' '## Recovery owner'; do rg -q --fixed-strings -- "$heading" "$rollback" || fail "rollback documentation missing: $heading"; done
rg -q --fixed-strings -- 'evidence/' "$evidence" || fail 'evidence index does not identify an evidence location'
echo "PREFLIGHT_PASS sha=$actual_sha branch=$actual_branch migrations=$(wc -l < "$tmp/actual")"
