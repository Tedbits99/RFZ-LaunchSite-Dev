# Master issue register — current audit

**Canonical current register:** this supplement plus the retained [existing issue register](../roadmap/MASTER_ISSUE_REGISTER.md). Existing IDs P0-001, P1-001–P1-007 and P2-001 through P20-001 remain tracked; no historical issue is discarded. Read the updates below together with their original file/evidence/test fields.

**Status vocabulary:** OPEN, BLOCKED, PENDING VERIFICATION, PARTIAL, PLACEHOLDER / MOCK, FIXED IN SOURCE — VERIFY IN TARGET. Phase completion itself remains only PASS / FAIL / BLOCKED. Current authorization is Phase 0 documentation, not implementation repair.

## Reconciliation of existing issues

- P1-001 through P1-005: prior local fixes are preserved; no hosted migration/deployment was applied. Target checks remain required. P1-003 is additionally qualified by A1-004; a server layout/source contract is not exhaustive runtime data-access proof.
- P1-006: dependency advisory audit is clean, but supported-toolchain gate is reopened by A1-001 and A1-006. Do not equate zero advisories with supported dependencies.
- P1-007: GitHub branch/ruleset metadata is now available; main is unprotected and no rulesets were returned. Hook access remains denied and host deployment identity unknown (A1-002/A0-003).
- P7-001: the legacy mock-only helper has no identified current import/call site; it does not prove PayMongo is mocked in production. Generic providers remain incomplete and external payment behavior unverified.
- P0-001 and database/hosting issues: investigate independent ownership/portability; future Bolt development/deployment is prohibited. Legacy availability must still be preserved.
- The 168 lint warnings remain in the [existing warning inventory](../roadmap/MASTER_ISSUE_REGISTER.md); no warning was suppressed by this audit.

## Current audit issues

### A0-001 — Production/backend identity and portability

- **ISSUE_ID:** A0-001
- **SEVERITY:** High
- **COMPONENT:** Production/backend identity and portability
- **FILE_PATH:** [backend clients](../../lib/supabaseAdmin.ts), [portability](DATABASE_PORTABILITY.md)
- **DESCRIPTION:** No owner-controlled deployed project/schema/export/restore metadata available.
- **EVIDENCE:** Source integrations only; no authorized connector for the owner-selected Cloudflare Worker or retained Supabase project is available.
- **ROOT_CAUSE_IF_KNOWN:** Access and service ownership not established.
- **ASSIGNED_PHASE:** 0
- **REQUIRED_FIX:** Obtain approved read-only ownership/schema/Auth/storage/backup evidence and reconcile source.
- **REQUIRED_TESTS:** Metadata comparison and isolated restore evidence in approved later scope.
- **CURRENT_STATUS:** BLOCKED

### A0-002 — Full disposable database verification

- **ISSUE_ID:** A0-002
- **SEVERITY:** High
- **COMPONENT:** Full disposable database verification
- **FILE_PATH:** [harness](../../scripts/test-github-actions-database-security.sh)
- **DESCRIPTION:** Full database harness cannot reach startup; required engine integration test is skipped in ordinary Vitest.
- **EVIDENCE:** Initial exit 2: CLI missing. The exact RF Coins outbound target is now rewritten only in the disposable copy to loopback and the safety preflight passes. Supabase CLI 2.117.0 then fails even on a migration-free database-only smoke project: the bundled PostgreSQL bootstrap reports a Realtime repository connection timeout after 14.98 seconds and exits 1. No database assertions ran.
- **ROOT_CAUSE_IF_KNOWN:** The remaining blocker is local Supabase/Docker image bootstrap, independently reproduced without Runfazone migrations; no hosted DB may substitute. The source migration and its production URL remain unchanged.
- **ASSIGNED_PHASE:** 0
- **REQUIRED_FIX:** Resolve A1-007 under approved implementation scope, then run the isolated harness and investigate assertions.
- **REQUIRED_TESTS:** Real disposable Postgres role/RLS/RPC/concurrency suite and worker-engine integration.
- **CURRENT_STATUS:** BLOCKED

### A0-003 — Push/deployment safety

- **ISSUE_ID:** A0-003
- **SEVERITY:** High
- **COMPONENT:** Push/deployment safety
- **FILE_PATH:** [Cloudflare target](INFRASTRUCTURE_ARCHITECTURE.md), [legacy Netlify config](../../netlify.toml), GitHub repository hooks
- **DESCRIPTION:** Cannot prove a development-main push has no production effect.
- **EVIDENCE:** Hooks API HTTP 403; deployments list empty (not proof of no Cloudflare/GitHub App/legacy integration).
- **ROOT_CAUSE_IF_KNOWN:** Token cannot inspect hooks; Cloudflare account/Worker mapping unknown.
- **ASSIGNED_PHASE:** 0
- **REQUIRED_FIX:** Owner verifies all hosting/GitHub App/legacy deploy integrations and confirms no production trigger.
- **REQUIRED_TESTS:** Read-only identity/branch/hook configuration evidence before push.
- **CURRENT_STATUS:** BLOCKED — local documentation commit allowed

### A0-004 — Full behavioral inventory

- **ISSUE_ID:** A0-004
- **SEVERITY:** Medium
- **COMPONENT:** Full behavioral inventory
- **FILE_PATH:** [source/control inventory](SOURCE_INVENTORY.md)
- **DESCRIPTION:** Every source/control location is indexed, but target behavior and every admin action are unverified.
- **EVIDENCE:** 52 pages, 32 admin pages; no approved staging browser/backend access.
- **ROOT_CAUSE_IF_KNOWN:** Source/static checks cannot establish real action outcomes.
- **ASSIGNED_PHASE:** 0
- **REQUIRED_FIX:** Obtain read-only target inventory and safe staging access; classify remaining behavior with evidence.
- **REQUIRED_TESTS:** Staged action/role/failure matrix without real financial/mail side effects.
- **CURRENT_STATUS:** BLOCKED

### A1-001 — Unsupported lint toolchain

- **ISSUE_ID:** A1-001
- **SEVERITY:** Medium
- **COMPONENT:** Unsupported lint toolchain
- **FILE_PATH:** [package.json](../../package.json), [ESLint config](../../eslint.config.mjs)
- **DESCRIPTION:** ESLint 9.39.5 is end-of-life despite clean npm advisory audit.
- **EVIDENCE:** npm ci deprecation warning; official ESLint support policy confirms v9 EOL 2026-08-06.
- **ROOT_CAUSE_IF_KNOWN:** Prior upgrade selected an unsupported lint major.
- **ASSIGNED_PHASE:** 1
- **REQUIRED_FIX:** Plan supported ESLint/plugin migration without weakening checks; no paid extended support adopted.
- **REQUIRED_TESTS:** Compatibility, lint, type checks, tests/build and dependency audit.
- **CURRENT_STATUS:** OPEN — no Phase 0 code change

### A1-002 — Development release controls

- **ISSUE_ID:** A1-002
- **SEVERITY:** High
- **COMPONENT:** Development release controls
- **FILE_PATH:** [workflow](../../.github/workflows/database-security-tests.yml), GitHub main
- **DESCRIPTION:** main reports protected:false; repository rulesets endpoint returned [].
- **EVIDENCE:** Read-only GitHub API on 2026-10-19.
- **ROOT_CAUSE_IF_KNOWN:** Required-check enforcement not configured/evidenced.
- **ASSIGNED_PHASE:** 1
- **REQUIRED_FIX:** Owner reviews intended direct-to-main protections, required CI and deployment isolation.
- **REQUIRED_TESTS:** Failing-check/unauthorized-change prevention in safe approved configuration.
- **CURRENT_STATUS:** OPEN — settings unchanged

### A1-003 — Secret-file prevention

- **ISSUE_ID:** A1-003
- **SEVERITY:** Medium
- **COMPONENT:** Secret-file prevention
- **FILE_PATH:** [.gitignore](../../.gitignore)
- **DESCRIPTION:** Only .env*.local is ignored; .env and .env.production are not ignored by current rules.
- **EVIDENCE:** git check-ignore identifies .env.local only; only .env.example is tracked.
- **ROOT_CAUSE_IF_KNOWN:** Incomplete generic secret-file ignore coverage.
- **ASSIGNED_PHASE:** 1
- **REQUIRED_FIX:** Review safe ignore patterns and secret scanning while retaining placeholder example.
- **REQUIRED_TESTS:** Verify private filenames excluded and example tracked; scan historical/current source safely.
- **CURRENT_STATUS:** OPEN — no evidence of exposed real secret

### A1-004 — Admin data-access boundary verification

- **ISSUE_ID:** A1-004
- **SEVERITY:** High
- **COMPONENT:** Admin data-access boundary verification
- **FILE_PATH:** [admin layout](../../app/admin/layout.tsx), [analytics page](../../app/admin/analytics/page.tsx)
- **DESCRIPTION:** Layout-level gate and static tests do not establish per-data-access authorization across privileged server pages.
- **EVIDENCE:** Some pages call adminSupabase directly; response/render concurrency and role matrix not browser-tested.
- **ROOT_CAUSE_IF_KNOWN:** Authorization placement and effective data-layer coverage require verification.
- **ASSIGNED_PHASE:** 1
- **REQUIRED_FIX:** Review every privileged read/action and prove denial at the appropriate server/data boundary; fix any verified gap.
- **REQUIRED_TESTS:** Anonymous/non-admin/inactive-admin requests, direct navigation/RSC paths and no unauthorized side effects.
- **CURRENT_STATUS:** PENDING VERIFICATION — not a proven live exploit

### A1-005 — Development/runtime compatibility

- **ISSUE_ID:** A1-005
- **SEVERITY:** Medium
- **COMPONENT:** Development/runtime compatibility
- **FILE_PATH:** [package.json](../../package.json), [Next config](../../next.config.js)
- **DESCRIPTION:** Build explicitly selects webpack; dev does not, despite custom webpack config; CI Node differs from audit runtime.
- **EVIDENCE:** next dev script inspected but not launched; CI 22.12.0 vs local 24.21.0.
- **ROOT_CAUSE_IF_KNOWN:** Framework migration lacks interactive dev/CI-runtime smoke evidence.
- **ASSIGNED_PHASE:** 1
- **REQUIRED_FIX:** Verify dev startup and matching CI runtime; correct verified incompatibilities in Phase 1.
- **REQUIRED_TESTS:** Start/stop dev safely, smoke local pages, and repeat checks on CI runtime.
- **CURRENT_STATUS:** PENDING VERIFICATION

### A1-006 — Install-script review

- **ISSUE_ID:** A1-006
- **SEVERITY:** Medium
- **COMPONENT:** Install-script review
- **FILE_PATH:** [lockfile](../../package-lock.json)
- **DESCRIPTION:** npm reports esbuild postinstall not covered by allowScripts.
- **EVIDENCE:** npm ci exit 0 with warning; build/tests subsequently run.
- **ROOT_CAUSE_IF_KNOWN:** Current npm install-script policy has an unreviewed dependency script.
- **ASSIGNED_PHASE:** 1
- **REQUIRED_FIX:** Review lockfile provenance and script need under the existing package policy; do not auto-approve.
- **REQUIRED_TESTS:** Reproducible clean install and relevant build/test behavior.
- **CURRENT_STATUS:** OPEN — no policy changed

### A2-001 — Completion-receipt delivery worker

- **ISSUE_ID:** A2-001
- **SEVERITY:** High
- **COMPONENT:** Completion-receipt delivery worker
- **FILE_PATH:** [handler](../../supabase/functions/completion-receipt-email-worker/handler.ts)
- **DESCRIPTION:** Production handler cannot claim or deliver receipts and returns not_implemented when enabled.
- **EVIDENCE:** Source explicitly returns 503; separate testing engine exists.
- **ROOT_CAUSE_IF_KNOWN:** Intentional staged stub, not production transport wiring.
- **ASSIGNED_PHASE:** 2
- **REQUIRED_FIX:** Complete authenticated durable worker/transport within approved phase, with bounded retries and dedupe.
- **REQUIRED_TESTS:** Isolated DB concurrency/failure tests, fake transport then approved SMTP integration.
- **CURRENT_STATUS:** PARTIAL — activation not authorized

### A2-002 — Operational monitoring

- **ISSUE_ID:** A2-002
- **SEVERITY:** High
- **COMPONENT:** Operational monitoring
- **FILE_PATH:** [system health](../../app/admin/system-health/page.tsx)
- **DESCRIPTION:** Health labels are hardcoded, including database Operational and inaccurate Resend/mock claims.
- **EVIDENCE:** Static services array; no real health probes.
- **ROOT_CAUSE_IF_KNOWN:** Presentation placeholders substitute for measured status.
- **ASSIGNED_PHASE:** 2
- **REQUIRED_FIX:** Implement real safe health evidence and unknown/degraded states; integrate admin controls in Phase 14.
- **REQUIRED_TESTS:** Unavailable/degraded provider/db and permission tests; no unintended sends/payments.
- **CURRENT_STATUS:** PLACEHOLDER / MOCK

### A3-001 — Staff administration

- **ISSUE_ID:** A3-001
- **SEVERITY:** High
- **COMPONENT:** Staff administration
- **FILE_PATH:** [staff page](../../app/admin/staff/page.tsx)
- **DESCRIPTION:** Staff list is a hardcoded sample; Invite Staff button has no action.
- **EVIDENCE:** Static rows and button without handler.
- **ROOT_CAUSE_IF_KNOWN:** Staff lifecycle not implemented on this page.
- **ASSIGNED_PHASE:** 3
- **REQUIRED_FIX:** Implement real authorized staff lifecycle; preserve roles/audit and approval separation.
- **REQUIRED_TESTS:** Invite, revoke, inactive denial, role escalation and audit tests in staging.
- **CURRENT_STATUS:** PLACEHOLDER / MOCK

### A14-001 — Task management

- **ISSUE_ID:** A14-001
- **SEVERITY:** Medium
- **COMPONENT:** Task management
- **FILE_PATH:** [task page](../../app/admin/tasks/page.tsx)
- **DESCRIPTION:** Task reads exist but Add Task is an unbound button.
- **EVIDENCE:** Server page button without action/handler.
- **ROOT_CAUSE_IF_KNOWN:** Create workflow missing.
- **ASSIGNED_PHASE:** 14
- **REQUIRED_FIX:** Wire authorized creation and lifecycle/error states; preserve auditability.
- **REQUIRED_TESTS:** Create/update/close, authorization and persistence tests.
- **CURRENT_STATUS:** PARTIAL

### A17-001 — Security status reporting

- **ISSUE_ID:** A17-001
- **SEVERITY:** High
- **COMPONENT:** Security status reporting
- **FILE_PATH:** [security page](../../app/admin/security/page.tsx)
- **DESCRIPTION:** Claims all tables enforce RLS and all API inputs are validated without performing checks.
- **EVIDENCE:** Static items array.
- **ROOT_CAUSE_IF_KNOWN:** Security status presentation is not backed by measured evidence.
- **ASSIGNED_PHASE:** 17
- **REQUIRED_FIX:** Replace assertions with verified evidence/state and expose unresolved checks.
- **REQUIRED_TESTS:** Permission/RLS probe coverage and unknown/failure reporting tests.
- **CURRENT_STATUS:** PLACEHOLDER / MOCK

### A2-003 — Email authentication and quota

- **ISSUE_ID:** A2-003
- **SEVERITY:** Medium
- **COMPONENT:** Email authentication and quota
- **FILE_PATH:** [mail function](../../supabase/functions/send-transactional-email/index.ts), public DNS
- **DESCRIPTION:** No DMARC TXT found; exact Titan Business reseller quota and Auth SMTP configuration unknown.
- **EVIDENCE:** DNS NXDOMAIN; unauthenticated TLS greeting only; published quotas vary.
- **ROOT_CAUSE_IF_KNOWN:** Account settings and full zone unavailable.
- **ASSIGNED_PHASE:** 2
- **REQUIRED_FIX:** Verify full zone and provider quota, then propose separately approved sender/auth controls.
- **REQUIRED_TESTS:** Approved send/receive headers, Auth confirmation/recovery and hourly/daily volume tests.
- **CURRENT_STATUS:** PENDING VERIFICATION — mail settings unchanged

## Maintenance rule

Add exact source/system evidence and a phase for every new issue. Update verification date, test command/result and commit when repaired. Future-phase gaps do not automatically fail the audit; missing mandatory audit evidence does. Do not mark source-only corrections as deployed or treat unavailable tests as passed.

### A1-007 — Database harness / RF Coins migration isolation conflict

- **ISSUE_ID:** A1-007
- **SEVERITY:** High
- **COMPONENT:** Isolated database safety gate
- **FILE_PATH:** [harness](../../scripts/test-github-actions-database-security.sh), [RF Coins schema migration](../../supabase/migrations/20261019014625_20261018160000_rf_coins_schema.sql.sql)
- **DESCRIPTION:** The full security harness now isolates the RF Coins outbound helper but cannot complete local Supabase startup.
- **EVIDENCE:** The source migration remains unchanged. The harness copies it with the exact hosted fulfillment URL rewritten to an unused loopback port and rejects any remaining hosted function URL. Debug output shows the bundled database image's `Elixir.Realtime.Repo` connection timeout after 14.98 seconds; a migration-free database-only smoke project reproduces it. No database assertions or SQL application completed.
- **ROOT_CAUSE_IF_KNOWN:** The original blocker was a real outbound dependency in the RF Coins SQL, not a false scanner match. The current blocker is local Supabase/Docker image bootstrap, independently reproduced without Runfazone migrations. Automatic cleanup remains enabled; no hosted DB may substitute.
- **ASSIGNED_PHASE:** 1 for safe validation infrastructure; RF Coins business implementation remains Phase 9.
- **REQUIRED_FIX:** Retain the test-only loopback isolation, diagnose the local Supabase container startup failure, then run the full disposable suite. Do not weaken the hosted-endpoint assertion, skip the migration or invoke hosted SQL.
- **REQUIRED_TESTS:** Socket-free safety guards, full isolated migration/RPC/RLS/concurrency tests and worker-engine integration; prove no hosted network target can execute.
- **CURRENT_STATUS:** PARTIALLY RESOLVED IN TEST INFRASTRUCTURE / BLOCKED ON LOCAL STARTUP; production migration unchanged.
