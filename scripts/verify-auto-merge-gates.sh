#!/usr/bin/env bash
set -euo pipefail
die() { echo "BLOCKED: $*" >&2; exit 1; }
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
pr_number="${PR_NUMBER:?PR_NUMBER is required}"
expected_sha="${EXPECTED_SHA:?EXPECTED_SHA is required}"
pr_json="$(gh api "repos/$repo/pulls/$pr_number")"
[ "$(jq -r .base.ref <<<"$pr_json")" = main ] || die 'PR must target main'
[ "$(jq -r .head.repo.full_name <<<"$pr_json")" = "$repo" ] || die 'PR head must be trusted repository'
[[ "$(jq -r .head.ref <<<"$pr_json")" == codex/* ]] || die 'PR is not a Codex branch'
[ "$(jq -r .draft <<<"$pr_json")" = false ] || die 'draft PR'
[ "$(jq -r .head.sha <<<"$pr_json")" = "$expected_sha" ] || die 'head changed during verification'
[ "$(jq -r .mergeable_state <<<"$pr_json")" = clean ] || die 'PR is not cleanly mergeable'
protection="$(gh api "repos/$repo/branches/main/protection")" || die 'main protection unavailable'
jq -e '.required_status_checks.strict == true and (.required_status_checks.contexts | index("Next.js checks")) and (.required_status_checks.contexts | index("Isolated Supabase RPC security tests")) and (.required_status_checks.contexts | index("Production release safety")) and .required_pull_request_reviews.required_approving_review_count == 0 and .enforce_admins.enabled == true and .allow_force_pushes.enabled == false' <<<"$protection" >/dev/null || die 'main protection is not the required zero-approval CI policy'
checks="$(gh api --paginate "repos/$repo/commits/$expected_sha/check-runs?per_page=100" | jq -s '{check_runs: map(.check_runs[])}')"
for name in "Next.js checks" "Isolated Supabase RPC security tests" "Production release safety"; do
  jq -e --arg name "$name" --arg sha "$expected_sha" '[.check_runs[] | select(.name == $name and .head_sha == $sha and .status == "completed" and .conclusion == "success")] | length > 0' <<<"$checks" >/dev/null || die "required check missing or unsuccessful for $name"
done
echo "PASS: exact-head gates satisfied for $expected_sha"
