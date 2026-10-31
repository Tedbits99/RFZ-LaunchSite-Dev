# Integration plan for Agent A / PR #82

1. Keep this branch based on the verified `main` SHA recorded in the audit.
2. Keep PR #82's branch and commits untouched; do not cherry-pick, rebase, or
   merge either branch from this workstream.
3. Open this branch as a separate draft PR targeting `main`, with the audit,
   checklist, runbook, environment-name inventory, and preflight script only.
4. After both PRs are reviewed, compare each PR's final file list. If Agent A
   changes any file under either allowed directory, stop and request an owner
   decision; do not resolve the overlap automatically.
5. On the eventual merged `main` SHA, regenerate names-only evidence and rerun
   the preflight. Application CI, hosted Supabase evidence, Cloudflare identity,
   and owner approvals remain independent gates.
