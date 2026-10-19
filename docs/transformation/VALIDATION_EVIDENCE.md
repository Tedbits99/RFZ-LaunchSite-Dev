# Phase 0 validation evidence

**Execution date:** 2026-10-19. **Runtime:** Node v24.21.0, npm 11.19.0; CI specifies Node 22.12.0. GitHub Actions run `39318615211` for `058fbed8b5b94390dbb231f9b1be5340220c7e4b` completed successfully with 47 test files and 826 passed tests. Tests operate on the preserved working tree, not solely HEAD. The only current implementation change is the test-harness loopback isolation described below; production migrations and application business logic were not changed.

## Safety review

Reviewed package scripts, [Vitest configuration](../../vite.config.ts), tests' mock/fixture boundaries, [database harness](../../scripts/test-github-actions-database-security.sh) and its loopback guards. The harness now copies the RF Coins migration with only its explicit hosted fulfillment URL rewritten to `http://127.0.0.1:9/blocked/fulfillment-handoff`; the source migration remains unchanged and the copy is rejected if any hosted function URL remains. Removed inherited application/backend/provider/mail variables. No hosted SQL, real mail/payment/supplier operation or production browser mutation was executed. npm registry access installed/audited dependencies; it was not an application integration test.

## Commands and actual results

| Exact command | Exit | Passed | Failed | Skipped | Warnings / actual result |
|---|---:|---:|---:|---:|---|
| `npm ci` | 0 | N/A | 0 command errors | N/A | 310 packages added, 311 audited; ESLint 9.39.5 deprecated/unsupported; esbuild postinstall not covered by allowScripts |
| `npx tsc --noEmit` | 0 | N/A | 0 type errors | N/A | No diagnostic output; app scope excludes Edge Functions |
| `npm run lint` | 0 | N/A | 0 lint errors | N/A | 168 warnings; existing warning inventory retained |
| `npm test` — initial isolation | 1 | 831 | 1 | 1 | Harness set service-role variable to empty string; test requires undefined; first run also emitted multiple GoTrueClient-instance warnings |
| `npm run build` — restricted sandbox | 1 | N/A | 1 environment error | N/A | Next 16.4.2 could not parse empty child-process `--showConfig` output; direct child launch is denied by this sandbox |
| `npm run build` — permitted local rerun | 0 | N/A | 0 | N/A | Next 16.4.2 compiled, completed TypeScript, generated 59/59 static pages and finalized successfully; no deployment |
| `npm audit --audit-level=low` | 0 | N/A | 0 reported advisories | N/A | `found 0 vulnerabilities`; not a full application-security assessment |
| `bash scripts/test-github-actions-database-security.sh --test-db-url-validator` | 0 | Guard suite passed | 0 | 0 | Socket-free positive/negative URL checks; runner does not emit an assertion count |
| `bash scripts/test-github-actions-database-security.sh --test-psql-args` | 0 | Guard suite passed | 0 | 0 | Socket-free invocation checks; runner does not emit an assertion count |
| `bash scripts/test-github-actions-database-security.sh` | 2 | 0 executed | Prerequisite failure | Not started | `ERROR: Supabase CLI is required.` psql also unavailable; no database connection/migration |
| `bash scripts/test-github-actions-database-security.sh` — after tooling setup | 3 | 0 DB assertions executed | Safety preflight rejected migration | Not started | RF Coins schema contains outbound hosted-function helper; no SQL applied |
| `npm test` — corrected isolation | 0 | 832 | 0 | 1 | 50 files passed; private variables removed, not set empty; no source/assertion changes |
| `npm test` — current parallel run | non-zero | 812 | 0 reported test failures | 1 | 48 files passed; 2 Vitest workers received SIGTERM in `lib/archiveSecurityMigration.test.ts` and `lib/rfCoinsPostgres.test.ts` |
| `npx vitest run lib/archiveSecurityMigration.test.ts lib/rfCoinsPostgres.test.ts --pool=threads --no-file-parallelism` | 0 | 20 | 0 | 0 | Both previously terminated files pass when run together without file parallelism |
| `npx vitest run --pool=threads --no-file-parallelism --maxWorkers=1` | 0 | 832 | 0 | 1 | 50 files passed; serialized worker scheduling avoids the parallel worker SIGTERMs |
| `npm exec --yes --package=supabase@2.117.0 -- bash scripts/test-github-actions-database-security.sh` | 1 | 0 DB assertions | Local startup failure | N/A | Outbound preflight passed; debug output identified the bundled Realtime repository connection timeout during PostgreSQL bootstrap; no hosted URL remained in disposable RF Coins copy |
| `npm exec --yes --package=supabase@2.121.0 -- supabase start --debug` — migration-free database-only smoke | 1 | 0 DB assertions | Local startup failure | N/A | Newer PostgreSQL/Realtime images reproduced the same approximately 14.98-second Realtime repository connection timeout; automatic cleanup completed |
| GitHub Actions workflow YAML parse, tracked-file secret scan, harness shell syntax and guard tests | 0 | All local checks passed | 0 | 0 | Workflow remains validation-only; no deploy action, provider credential or hosted database access is configured |

The initial test failure was investigated at [authSessionClients.test.ts](../../lib/authSessionClients.test.ts):133: `process.env.SUPABASE_SERVICE_ROLE_KEY` must be absent. The audit harness caused the discrepancy. The full suite was rerun after fixing the harness and passed. This is recorded rather than erased.

The skipped case is [engine.integration.test.ts](../../supabase/functions/completion-receipt-email-worker/testing/engine.integration.test.ts), guarded by `describe.skipIf(!integrationRequested)`. It needs the explicitly isolated local Supabase test API/service role supplied by the reviewed harness; the database harness safety gate prevents creating its required test environment; that is not a successful integration. This test was already conditional; no skip was added.

## Database-harness investigation

Docker availability check `docker info --format '{{.ServerVersion}}'` exited 0 (29.8.0-1); no containers were running. The audit installed local test prerequisites using `sudo -n apt-get update` (0), `sudo -n apt-get install -y postgresql-client` (0), and `npm install --prefix /tmp/rfz-audit-tools --no-save supabase@2.117.0` (0). Supabase CLI 2.117.0 and psql 16.15 were available for the rerun; the CLI noted a newer release, but the audit used the workflow's pinned version. These are local tool installations, not app dependency/configuration changes or new hosted services.

The initial harness exited 3 because the RF Coins schema contains a reviewed outbound helper. The test-only harness correction now copies that migration with the exact hosted URL rewritten to an unused loopback port and verifies no hosted function URL remains; the source migration was not edited. The debug reruns showed the precise service failure: during the bundled database image's `migrate` step, `Elixir.Realtime.Repo` could not obtain a connection and dropped the request after approximately 14.98 seconds, after which Supabase reported `error running container: exit 1` and cleaned up the container, volume and network. A migration-free database-only smoke project reproduced the failure with CLI 2.117.0 and again with CLI 2.121.0/newer PostgreSQL/Realtime images, so Runfazone migrations are not the cause. Docker has 2 CPUs, approximately 7.7 GiB memory and 7.7 GiB free disk in this environment. No SQL was applied.

Compatible-runner procedure: use a GitHub Actions Linux runner or owner-managed Docker host with current Docker resources, pin a reviewed Supabase CLI version, create an unlinked temporary project with a clean HOME and no inherited environment, copy migrations through the same exact loopback rewrite, run the URL/psql guards, run `supabase start --debug`, verify `DB_URL`/`API_URL` are literal loopback values, run the full database assertions and isolated worker engine, then always run `supabase stop --no-backup` in cleanup. If startup still fails there, retain sanitized container/PostgreSQL logs and stop; never substitute hosted Supabase.

## Additional read-only checks

- Repository/top-level/main/origin identity and matching remote HEAD verified at `995556e5ec1b8573b0032e1fcc96c0e3126db6a1`.
- Documentation-only push validation: GitHub Actions run `39318615211` completed successfully for `058fbed`; the isolated job reported 47 passing test files and 826 passing tests. The workflow also ran the serialized application suite, TypeScript, lint, production build, Edge Function checks, and isolated database security tests. This does not establish hosted Supabase deployment or production readiness.
- GitHub branch endpoint: protected=false; rulesets: []; deployments: []; hooks: HTTP 403. The last result blocks proof of safe push side effects.
- All 396 source/config inventory files read for structural/risk markers; source hashes and routes/admin controls recorded.
- 914 reachable Git text blobs scanned heuristically for selected token/private-key patterns; zero candidates, with explicit limits in [security findings](SECURITY_FINDINGS.md).
- Public DNS read-only observations and SMTP TLS certificate/greeting recorded in [deployment dependencies](DEPLOYMENT_DEPENDENCIES.md). No AUTH or email command sent.
- Prior Phase 1 Deno checks and two authorization tests are recorded in [historical progress](../roadmap/PHASE_PROGRESS.md). They were not rerun during this Phase 0 task; no Deno binary is installed directly.

## Latest authenticated Supabase evidence

The project-scoped Supabase MCP returned, without invoking any write-capable tool:

- project URL `https://ketdhcmwowzztcdlmris.supabase.co`;
- 13 public tables, all reported with RLS enabled;
- 11 hosted migration versions, matching the first 11 logical local migrations; checksums were not exposed;
- default branch status `MIGRATIONS_FAILED` with preview status `ACTIVE_HEALTHY`;
- zero deployed Edge Functions;
- security advisors reporting no policies on `payment_submissions`, `voucher_usages` and `vouchers`, five publicly executable `SECURITY DEFINER` routines, and disabled leaked-password protection;
- performance advisors reporting six unindexed foreign keys and nine unused indexes.

The MCP registration has no `read_only=true` parameter and exposes write-capable operations. Therefore this is evidence of disciplined read-only use, not server-enforced read-only authorization. Organization ownership, region, billing/plan, quota, backup/PITR, export/restore rights, Auth configuration, Storage objects, Realtime membership and the failed migration detail remain unavailable through the inspected project-scoped tools. No hosted SQL, migration, reset, branch creation, export, deployment, provider call or secret retrieval occurred.

## Documentation checks

Final local link/script/config, phase-section, placeholder-secret, source-preservation and whitespace checks are recorded in [phase status](PHASE_STATUS.md) after completion. No application test was added for documentation. Local pass does not establish live integration, data portability, backup restoration or launch readiness.
