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
    and ([.rules[] | select(.type == "required_status_checks") | .parameters.strict_required_status_checks_policy] | any(. == true))
    and ([.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[]?.context] | contains(["Next.js checks", "Isolated Supabase RPC security tests", "Production release safety"]))
  ' <<<"$ruleset_json" >/dev/null || return 1

  # GitHub intentionally omits bypass_actors for callers without ruleset
  # write access. Omission is UNKNOWN, never evidence that the list is empty.
  # Reject any explicitly visible bypass actor.
  if jq -e 'has("bypass_actors")' <<<"$ruleset_json" >/dev/null; then
    jq -e '.bypass_actors | type == "array" and length == 0' <<<"$ruleset_json" >/dev/null || return 1
    RULESET_BYPASS_STATUS=EMPTY
  else
    RULESET_BYPASS_STATUS=UNAVAILABLE
  fi
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

verify_independent_review_json() {
  local reviews_json="$1" expected_sha="$2" author_login="$3"
  jq -e --arg sha "$expected_sha" --arg author "$author_login" '
    if type != "array" or length == 0 then false
    else
      [ .[] | select(.user.login != null) ]
      | sort_by(.user.login, .submitted_at)
      | group_by(.user.login)
      | map(last)
      | any(.[];
          .state == "APPROVED"
          and .commit_id == $sha
          and .user.login != $author
          and .user.type == "User"
          and (.author_association as $association
            | (["OWNER", "MEMBER", "COLLABORATOR"] | index($association)) != null)
        )
    end
  ' <<<"$reviews_json" >/dev/null
}

valid_pull_request_files_json() {
  local files_json="$1"
  jq -e '
    type == "array" and length > 0
    and all(.[]; (.filename | type) == "string" and (.filename | length) > 0)
  ' <<<"$files_json" >/dev/null
}

requires_manual_merge_files_json() {
  local files_json="$1"
  jq -e '
    any(.[];
      (.filename | ascii_downcase)
      | (test("^public/([a-z0-9_-]+/)*[a-z0-9_-]+\\.(png|jpe?g|webp|avif|gif)$") | not)
    )
  ' <<<"$files_json" >/dev/null
}

set_auto_merge_output() {
  local allowed="$1"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf 'auto_merge=%s\n' "$allowed" >> "$GITHUB_OUTPUT"
  fi
}

self_test() {
  local sha="0123456789012345678901234567890123456789" repo="Tedbits99/RFZ-LaunchSite-Dev"
  local ruleset='{"enforcement":"active","target":"branch","conditions":{"ref_name":{"include":["refs/heads/main"]}},"bypass_actors":[],"rules":[{"type":"pull_request","parameters":{"required_approving_review_count":0}},{"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":true,"required_status_checks":[{"context":"Next.js checks"},{"context":"Isolated Supabase RPC security tests"},{"context":"Production release safety"}]}},{"type":"non_fast_forward"},{"type":"deletion"}]}'
  local pr='{"base":{"ref":"main"},"head":{"repo":{"full_name":"Tedbits99/RFZ-LaunchSite-Dev"},"ref":"codex/test","sha":"0123456789012345678901234567890123456789"},"draft":false,"mergeable_state":"clean"}'
  local reviews='[{"user":{"login":"owner","type":"User"},"author_association":"OWNER","state":"APPROVED","commit_id":"0123456789012345678901234567890123456789","submitted_at":"2026-10-27T00:00:00Z"}]'
  local cosmetic_files='[{"filename":"public/banners/banner.webp"}]'
  local sensitive_files='[{"filename":".github/workflows/auto-merge-codex.yml"}]'
  local checks='{"check_runs":[{"name":"Next.js checks","head_sha":"0123456789012345678901234567890123456789","status":"completed","conclusion":"success"},{"name":"Isolated Supabase RPC security tests","head_sha":"0123456789012345678901234567890123456789","status":"completed","conclusion":"success"},{"name":"Production release safety","head_sha":"0123456789012345678901234567890123456789","status":"completed","conclusion":"success"}]}'
  local ruleset_without_bypass
  ruleset_without_bypass="$(jq 'del(.bypass_actors)' <<<"$ruleset")"
  assert_pass() { "$@" || die "self-test unexpectedly rejected valid fixture"; }
  assert_fail() { if "$@"; then die "self-test unexpectedly accepted invalid fixture"; fi; }
  assert_pass verify_ruleset_json "$ruleset"
  assert_fail verify_ruleset_json '{}'
  assert_pass verify_ruleset_json "$ruleset_without_bypass"
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
  assert_pass verify_independent_review_json "$reviews" "$sha" "codex-bot"
  assert_fail verify_independent_review_json '[]' "$sha" "codex-bot"
  assert_fail verify_independent_review_json "$reviews" "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "codex-bot"
  assert_fail verify_independent_review_json "$reviews" "$sha" "owner"
  assert_fail verify_independent_review_json "${reviews/\"type\":\"User\"/\"type\":\"Bot\"}" "$sha" "codex-bot"
  assert_fail verify_independent_review_json "${reviews/\"APPROVED\"/\"CHANGES_REQUESTED\"}" "$sha" "codex-bot"
  local approval_then_comment
  approval_then_comment="$(jq '. + [{user:{login:"owner",type:"User"},author_association:"OWNER",state:"COMMENTED",commit_id:"'"$sha"'",submitted_at:"2026-10-28T00:00:00Z"}]' <<<"$reviews")"
  assert_fail verify_independent_review_json "$approval_then_comment" "$sha" "codex-bot"
  assert_pass valid_pull_request_files_json "$cosmetic_files"
  assert_pass requires_manual_merge_files_json "$sensitive_files"
  assert_fail requires_manual_merge_files_json "$cosmetic_files"
  assert_pass requires_manual_merge_files_json '[{"filename":"public/logo.svg"}]'
  assert_pass requires_manual_merge_files_json '[{"filename":"public/../app/exploit.png"}]'
  assert_fail valid_pull_request_files_json '[]'
  assert_fail valid_pull_request_files_json '[{}]'
  echo "AUTO_MERGE_GATE_SELF_TEST_PASS"
}

if [ "${1:-}" = "--self-test" ]; then self_test; exit 0; fi

repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
pr_number="${PR_NUMBER:?PR_NUMBER is required}"
expected_sha="${EXPECTED_SHA:?EXPECTED_SHA is required}"
pr_json="$(gh api "repos/$repo/pulls/$pr_number")"
verify_pr_json "$pr_json" "$expected_sha" "$repo" || die "PR identity, trust, draft, mergeability, or exact-head check failed"

# The default GITHUB_TOKEN is deliberately the only credential used here.
# Ruleset responses may omit bypass_actors for this caller; verify_ruleset_json
# records that limitation and never treats omission as an empty list.
ruleset_ids="$(gh api --paginate "repos/$repo/rulesets?includes_parents=true&per_page=100" | jq -s 'add // [] | .[].id')" || die "cannot read repository rulesets with the workflow token"
matched_ruleset=false
while IFS= read -r ruleset_id; do
  [ -n "$ruleset_id" ] || continue
  ruleset_json="$(gh api "repos/$repo/rulesets/$ruleset_id")" || die "cannot read ruleset $ruleset_id with the workflow token"
  if verify_ruleset_json "$ruleset_json"; then
    matched_ruleset=true
    matched_bypass_status="$RULESET_BYPASS_STATUS"
    break
  fi
done <<<"$ruleset_ids"
[ "$matched_ruleset" = true ] || die "no active main ruleset with the required visible rules was inspectable"

checks_json="$(gh api --paginate "repos/$repo/commits/$expected_sha/check-runs?per_page=100" | jq -s '{check_runs: map(.check_runs[])}')" || die "cannot read exact-head checks"
verify_checks_json "$checks_json" "$expected_sha" || die "required check missing or unsuccessful for exact head SHA"

author_login="$(jq -r '.user.login // empty' <<<"$pr_json")"
[ -n "$author_login" ] || die "cannot identify the pull request author"
reviews_json="$(gh api --paginate "repos/$repo/pulls/$pr_number/reviews" | jq -s 'add // []')" || die "cannot read pull request reviews"
if ! verify_independent_review_json "$reviews_json" "$expected_sha" "$author_login"; then
  echo 'AUTO_MERGE_NOT_REQUESTED reason=independent_approval_for_exact_head_required'
  set_auto_merge_output false
  exit 0
fi

files_json="$(gh api --paginate "repos/$repo/pulls/$pr_number/files" | jq -s 'add // []')" || die "cannot read changed file inventory"
jq -e 'type == "array" and length > 0 and all(.[]; (.filename | type) == "string" and (.filename | length) > 0)' <<<"$files_json" >/dev/null || die "pull request changed-file inventory is empty or malformed"
if requires_manual_merge_files_json "$files_json"; then
  echo 'AUTO_MERGE_NOT_REQUESTED reason=non_asset_or_security_sensitive_changes_require_manual_merge'
  set_auto_merge_output false
  exit 0
fi

echo "PASS: exact-head independent approval and required checks verified for $expected_sha (bypass_actors=$matched_bypass_status; omitted means unknown, not empty)"
echo 'AUTO_MERGE_ALLOWED reason=reviewed_public_raster_assets_only'
set_auto_merge_output true
