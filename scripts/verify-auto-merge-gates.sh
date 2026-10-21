#!/usr/bin/env bash
set -euo pipefail

die() { echo "BLOCKED: $*" >&2; return 1; }

verify_ruleset_json() {
  local ruleset_json="$1"
  jq -e '
    .enforcement == "active" and .target == "branch"
    and (((.conditions.ref_name.include // []) | index("refs/heads/main")) != null or ((.conditions.ref_name.include // []) | index("~DEFAULT_BRANCH")) != null)
    and (([.rules[]?.type] | index("pull_request")) != null)
    and (([.rules[]?.type] | index("required_status_checks")) != null)
    and (([.rules[]?.type] | index("non_fast_forward")) != null)
    and (([.rules[]?.type] | index("deletion")) != null)
    and ((.bypass_actors // []) | length == 0)
    and ([.rules[] | select(.type == "pull_request") | .parameters.required_approving_review_count] | any(. == 0))
    and ([.rules[] | select(.type == "required_status_checks") | .parameters.strict_required_status_checks_policy] | any(. == true))
    and ([.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[]?.context] | contains(["Next.js checks", "Isolated Supabase RPC security tests", "Production release safety"]))
  ' <<<"$ruleset_json" >/dev/null
}

verify_pr_json() {
  local pr_json="$1" expected_sha="$2" repo="$3"
  jq -e --arg expected "$expected_sha" --arg repo "$repo" '.base.ref == "main" and .head.repo.full_name == $repo and (.head.ref | startswith("codex/")) and .draft == false and .head.sha == $expected and .mergeable_state == "clean"' <<<"$pr_json" >/dev/null
}

verify_checks_json() {
  local checks_json="$1" expected_sha="$2"
  for name in "Next.js checks" "Isolated Supabase RPC security tests" "Production release safety"; do
    jq -e --arg name "$name" --arg sha "$expected_sha" '[.check_runs[] | select(.name == $name and .head_sha == $sha and .status == "completed" and .conclusion == "success")] | length > 0' <<<"$checks_json" >/dev/null || return 1
  done
}

self_test() {
  local sha="0123456789012345678901234567890123456789" repo="Tedbits99/RFZ-LaunchSite-Dev"
  local ruleset='{"enforcement":"active","target":"branch","conditions":{"ref_name":{"include":["refs/heads/main"]}},"bypass_actors":[],"rules":[{"type":"pull_request","parameters":{"required_approving_review_count":0}},{"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":true,"required_status_checks":[{"context":"Next.js checks"},{"context":"Isolated Supabase RPC security tests"},{"context":"Production release safety"}]}},{"type":"non_fast_forward"},{"type":"deletion"}]}'
  local pr='{"base":{"ref":"main"},"head":{"repo":{"full_name":"Tedbits99/RFZ-LaunchSite-Dev"},"ref":"codex/test","sha":"0123456789012345678901234567890123456789"},"draft":false,"mergeable_state":"clean"}'
  local checks='{"check_runs":[{"name":"Next.js checks","head_sha":"0123456789012345678901234567890123456789","status":"completed","conclusion":"success"},{"name":"Isolated Supabase RPC security tests","head_sha":"0123456789012345678901234567890123456789","status":"completed","conclusion":"success"},{"name":"Production release safety","head_sha":"0123456789012345678901234567890123456789","status":"completed","conclusion":"success"}]}'
  assert_pass() { "$@" || die "self-test unexpectedly rejected valid fixture"; }
  assert_fail() { if "$@"; then die "self-test unexpectedly accepted invalid fixture"; fi; }
  assert_pass verify_ruleset_json "$ruleset"
  assert_fail verify_ruleset_json "${ruleset/\"enforcement\":\"active\"/\"enforcement\":\"disabled\"}"
  assert_fail verify_ruleset_json "${ruleset/\"refs\/heads\/main\"/\"refs\/heads\/release\"}"
  assert_fail verify_ruleset_json "${ruleset/\"bypass_actors\":\[\]/\"bypass_actors\":[{\"actor_type\":\"OrganizationAdmin\"}]}"
  assert_pass verify_pr_json "$pr" "$sha" "$repo"
  assert_fail verify_pr_json "${pr/\"ref\":\"codex\/test\"/\"ref\":\"feature\/stacked\"}" "$sha" "$repo"
  assert_fail verify_pr_json "${pr/\"draft\":false/\"draft\":true}" "$sha" "$repo"
  assert_fail verify_pr_json "$pr" "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "$repo"
  assert_fail verify_pr_json "${pr/\"full_name\":\"Tedbits99\/RFZ-LaunchSite-Dev\"/\"full_name\":\"untrusted\/fork\"}" "$sha" "$repo"
  assert_pass verify_checks_json "$checks" "$sha"
  assert_fail verify_checks_json "${checks/\"conclusion\":\"success\"/\"conclusion\":\"failure\"}" "$sha"
  assert_fail verify_checks_json "${checks/\"status\":\"completed\"/\"status\":\"in_progress\"}" "$sha"
  assert_fail verify_checks_json "${checks/\"name\":\"Production release safety\"/\"name\":\"Skipped production release safety\"}" "$sha"
  assert_fail verify_checks_json "${checks/\"head_sha\":\"$sha\"/\"head_sha\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}" "$sha"
  echo "AUTO_MERGE_GATE_SELF_TEST_PASS"
}

if [ "${1:-}" = "--self-test" ]; then self_test; exit 0; fi

repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
pr_number="${PR_NUMBER:?PR_NUMBER is required}"
expected_sha="${EXPECTED_SHA:?EXPECTED_SHA is required}"
pr_json="$(gh api "repos/$repo/pulls/$pr_number")"
verify_pr_json "$pr_json" "$expected_sha" "$repo" || die "PR identity, trust, draft, mergeability, or exact-head check failed"

ruleset_ids="$(gh api --paginate "repos/$repo/rulesets?includes_parents=true&per_page=100" | jq -s 'add // [] | .[].id')" || die "cannot read repository rulesets"
matched_ruleset=false
while IFS= read -r ruleset_id; do
  [ -n "$ruleset_id" ] || continue
  ruleset_json="$(gh api "repos/$repo/rulesets/$ruleset_id")" || die "cannot read ruleset $ruleset_id"
  if verify_ruleset_json "$ruleset_json"; then matched_ruleset=true; break; fi
done <<<"$ruleset_ids"
[ "$matched_ruleset" = true ] || die "no active main ruleset enforces PRs, zero reviews, required strict checks, no bypass, no force pushes, and no deletion"

checks_json="$(gh api --paginate "repos/$repo/commits/$expected_sha/check-runs?per_page=100" | jq -s '{check_runs: map(.check_runs[])}')" || die "cannot read exact-head checks"
verify_checks_json "$checks_json" "$expected_sha" || die "required check missing or unsuccessful for exact head SHA"
echo "PASS: effective main ruleset and exact-head auto-merge gates satisfied for $expected_sha"
