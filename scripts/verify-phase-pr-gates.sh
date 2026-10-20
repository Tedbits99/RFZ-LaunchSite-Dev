#!/usr/bin/env bash
set -euo pipefail

# Verify a phase PR's release gate against one exact head SHA. The caller must
# perform a final PR re-read immediately before merging with that same SHA.

required_check_names=("Isolated Supabase RPC security tests")

die() { echo "ERROR: $*" >&2; exit 1; }

verify_check_runs_json() {
  local check_runs_json="$1" expected_sha="$2" required_name count invalid latest
  command -v jq >/dev/null 2>&1 || die "jq is required"
  for required_name in "${required_check_names[@]}"; do
    count="$(jq --arg name "$required_name" --arg sha "$expected_sha" '[.check_runs[] | select(.name == $name and .head_sha == $sha)] | length' <<<"$check_runs_json")"
    [ "$count" -gt 0 ] || die "required check has no result for exact head SHA: $required_name"
    invalid="$(jq --arg name "$required_name" --arg sha "$expected_sha" '[.check_runs[] | select(.name == $name and .head_sha == $sha) | select(.status != "completed" or .conclusion != "success" or (.completed_at // "") == "")] | length' <<<"$check_runs_json")"
    [ "$invalid" -eq 0 ] || die "required check is pending or unsuccessful for exact head SHA: $required_name"
    latest="$(jq -r --arg name "$required_name" --arg sha "$expected_sha" '[.check_runs[] | select(.name == $name and .head_sha == $sha)] | sort_by(.completed_at // .started_at) | last | [.status, .conclusion, (.completed_at // "")] | @tsv' <<<"$check_runs_json")"
    [ "$latest" = $'completed\tsuccess\t'"$(cut -f3 <<<"$latest")" ] || die "required check latest result is not successful: $required_name"
  done
}

verify_pr_json() {
  local pr_json="$1" expected_sha="$2" base head_repo head_ref head_sha mergeable has_label gate
  command -v jq >/dev/null 2>&1 || die "jq is required"
  base="$(jq -r '.base.ref // ""' <<<"$pr_json")"
  head_repo="$(jq -r '.head.repo.full_name // ""' <<<"$pr_json")"
  head_ref="$(jq -r '.head.ref // ""' <<<"$pr_json")"
  head_sha="$(jq -r '.head.sha // ""' <<<"$pr_json")"
  mergeable="$(jq -r '.mergeable_state // ""' <<<"$pr_json")"
  has_label="$(jq '[.labels[]?.name | select(. == "phase-ready")] | length' <<<"$pr_json")"
  gate="${PHASE0_PRODUCTION_GATE_CLEARED:-}"
  [ "$base" = "main" ] || die "pull request does not target main"
  [ "$head_repo" = "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}" ] || die "pull request head is not in the same repository"
  case "$head_ref" in codex/*|feature/*) ;; *) die "head is not a phase branch" ;; esac
  [ "$head_sha" = "$expected_sha" ] || die "pull request head changed during verification"
  [ "$mergeable" = "clean" ] || die "pull request is not cleanly mergeable: $mergeable"
  [ "$has_label" -gt 0 ] || die "phase-ready label is required"
  [ "$gate" = "true" ] || die "production migration safety gate is not cleared"
}

self_test() {
  local sha="0123456789012345678901234567890123456789" base_pr checks_pr
  export GITHUB_REPOSITORY="Tedbits99/RFZ-LaunchSite-Dev"
  base_pr='{"base":{"ref":"main"},"head":{"repo":{"full_name":"Tedbits99/RFZ-LaunchSite-Dev"},"ref":"feature/test","sha":"0123456789012345678901234567890123456789"},"mergeable_state":"clean","labels":[{"name":"phase-ready"}]}'
  checks_pr='{"check_runs":[{"name":"Isolated Supabase RPC security tests","head_sha":"0123456789012345678901234567890123456789","status":"completed","conclusion":"success","started_at":"2026-10-20T00:00:00Z","completed_at":"2026-10-20T00:01:00Z"}]}'
  PHASE0_PRODUCTION_GATE_CLEARED=true verify_pr_json "$base_pr" "$sha"
  verify_check_runs_json "$checks_pr" "$sha"
  if (verify_check_runs_json "{\"check_runs\":[]}" "$sha"); then die "self-test accepted missing checks"; fi
  if (verify_pr_json "${base_pr/phase-ready/missing-label}" "$sha"); then die "self-test accepted missing phase label"; fi
  if (verify_pr_json "$base_pr" "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); then die "self-test accepted changed head"; fi
  if (verify_pr_json "${base_pr/\"mergeable_state\":\"clean\"/\"mergeable_state\":\"dirty\"}" "$sha"); then die "self-test accepted merge conflict"; fi
  echo "PHASE_PR_GATE_SELF_TEST_PASS"
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit 0
fi

require_command() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }
require_command gh
require_command jq
[ -n "${GITHUB_REPOSITORY:-}" ] || die "GITHUB_REPOSITORY is required"
[ -n "${PR_NUMBER:-}" ] || die "PR_NUMBER is required"
[ -n "${EXPECTED_SHA:-}" ] || die "EXPECTED_SHA is required"

pr_json="$(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER")"
verify_pr_json "$pr_json" "$EXPECTED_SHA"
checks_json="$(gh api --paginate "repos/$GITHUB_REPOSITORY/commits/$EXPECTED_SHA/check-runs?per_page=100" | jq -s '{check_runs: map(.check_runs[]) }')"
verify_check_runs_json "$checks_json" "$EXPECTED_SHA"
echo "PHASE_PR_GATE_PASS sha=$EXPECTED_SHA"
