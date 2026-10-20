# Development workflow

**Verified source baseline:** 2026-10-20. **Current authorization:** the owner has permanently approved phase-based development, routine verified merges, and automatic integration of eligible phase branches. [Phase status](transformation/PHASE_STATUS.md) remains authoritative; the unresolved production migration safety gate still holds merges that could trigger hosted migrations.

## Before work

Run `pwd`, `git rev-parse --show-toplevel`, `git branch --show-current`, `git status --short --branch`, `git remote -v`, `git rev-parse HEAD` and, when network is available, `git ls-remote --heads origin main`. Expected repository is `Tedbits99/RFZ-LaunchSite-Dev`, branch `main`. Stop on mismatch. Never use the original repository as a work/deployment destination.

Read the current issue register, [technology guide](TECH_STACK.md), [database guide](DATABASE_AND_MIGRATIONS.md), and legacy [change-impact guide](codebase-analysis/CHANGE_IMPACT_GUIDE.md). Historical absolute links and framework details may be stale; use current source and the new audit to reconcile them. Do not run Bolt tooling.

## Develop within the authorized phase

1. Identify an issue ID, acceptance criteria and affected API/database/admin/customer paths.
2. Reuse existing functions/components. Keep money in integer cents, prices authoritative on the server, supplier orders behind verified payment, and financial transitions idempotent.
3. Use strict TypeScript and `@/*` imports; use server reads and client components according to established patterns. Preserve loading, error and empty states.
4. Review `auth.getUser`, active-admin/role checks, request origin, ownership and effective RLS; service-role access bypasses ordinary RLS.
5. For database changes, read chronological replacements and grants, then use an explicitly isolated database. Never run an unreviewed historical reset against production.
6. Add meaningful regression tests for implementation fixes in their authorized phases. Documentation updates need path/script/content validation, not fabricated application test coverage.

## Install and validate

[package.json](../package.json) and the npm lockfile are the command authority. CI pins Node 22.12.0; the current local run used Node 24.21.0. npm is confirmed; there is no `packageManager` or `engines` pin in the package manifest.

```bash
npm ci
npx tsc --noEmit
npm run lint
npm test
npm run build
npm audit --audit-level=low
```

These commands do not deploy, but builds/tests must not inherit production connections. Inspect tests/config first, remove live payment/supplier/mail/database credentials, and use synthetic fixtures or approved local endpoints. Keep secrets out of terminal logs. Tests assert that the service-role variable is **absent**, not just an empty string; unset it for ordinary mocked tests. A build may use empty overrides to prevent local env files supplying real backend configuration. Do not weaken tests to accommodate the audit harness.

[CI workflow](../.github/workflows/database-security-tests.yml) defines application checks, Deno checks and an isolated Supabase harness. Configuration on disk does not prove CI is active or passing on GitHub. The application type checker excludes Edge Functions; Deno checks are separate. See [validation evidence](transformation/VALIDATION_EVIDENCE.md) for actual results and skips.

Socket-free harness checks:

```bash
bash scripts/test-github-actions-database-security.sh --test-db-url-validator
bash scripts/test-github-actions-database-security.sh --test-psql-args
```

Full isolated DB tests require Docker, Supabase CLI and `psql`; the audit temporarily installed the missing tools, then the harness rejected an unreviewed outbound RF Coins migration before DB startup. Read [the harness](../scripts/test-github-actions-database-security.sh) and [existing test guide](codebase-analysis/GITHUB_ACTIONS_DATABASE_TESTING.md) first. Do not substitute a production DB when local prerequisites are missing. No hosted SQL, migration, scheduler or Edge deployment is part of this audit.

## Phase branches and automatic merge

Create one dedicated branch for each phase or substantial workstream. Keep the
phase branch focused, run the complete applicable release gate on that branch,
and reconcile it with current `main` before merge. The required gate covers
TypeScript, lint, unit/integration tests, production build, migration
compatibility, RLS/RPC security, and order/payment/receipt/reconciliation tests
when those areas are affected. A check must run against the phase branch or its
pull request; an earlier main-branch result does not qualify.

The owner has granted standing authorization for routine, non-destructive,
fully verified merges. The repository workflow
[`phase-auto-merge.yml`](../.github/workflows/phase-auto-merge.yml) is
deliberately fail-closed: it requires the `phase-ready` label, a green pull
request, a phase branch name, and the owner-controlled repository variable
`PHASE0_PRODUCTION_GATE_CLEARED=true`. Until the production safety gate is
cleared, it performs no merge. The verifier is loaded from the PR base SHA,
not the proposed branch, and the merge request is pinned to the verified head
SHA. Do not bypass required checks or use this path
for resets, destructive migrations, irreversible data operations, or other
exceptional production changes.

The current GitHub connector cannot administer branch protection (`403`) and
the repository has no rulesets. The owner must add a `main` ruleset or branch
protection rule requiring the `Isolated Supabase RPC security tests` check and
restricting direct pushes before enabling `PHASE0_PRODUCTION_GATE_CLEARED`.
Until that control-plane action is complete, the base-SHA verifier remains the
independent enforcement layer and missing or stale results fail the workflow.

The existing `codex/phase0-migration-compatibility` and
`feature/customer-auth-phase1` branches retain their unique work. Reconcile
overlaps explicitly and do not overwrite, force-push, reset, or delete
unfinished work.

## Review, commit and push

Review `git diff`, untracked documentation and `git diff --check`. Review the index separately with `git diff --cached`; it can contain unrelated pre-existing changes. Stage only explicit task files. Avoid `git add .`, history rewrites and force pushes. Record completed documentation and evidence in the phase status; preserve previous source edits and staged deletion of the old Tailwind config.

The owner has intentionally kept the existing GitHub-to-Supabase automatic deployment integration enabled. **Before a main-branch push or merge that could trigger hosted migrations, require verified origin/main, a passing full isolated migration/security runner on the phase branch/PR, review of hosted migration effects and backup/recovery readiness, and the production safety variable described above.** Repository config alone cannot establish the exact hosting mapping, environments, integrations or webhooks. Do not disable or replace the integration to avoid a demonstrated conflict. No production credentials, data, DNS, email or payment settings may change.

## Handoff

Update [phase status](transformation/PHASE_STATUS.md), [master roadmap](transformation/MASTER_ROADMAP_2026.md) and [issue register](transformation/MASTER_ISSUE_REGISTER.md) with the scope, command results, remaining blockers and commit. Keep all 21 phases sequential. PASS requires evidence for every mandatory gate. After a verified routine merge, confirm main CI and record the resulting main commit and deployment outcome before starting the next phase.
