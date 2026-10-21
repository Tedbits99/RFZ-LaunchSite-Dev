# GitHub Actions Database Security Testing

This workflow runs the privileged RPC tests against a disposable local Supabase stack on a GitHub-hosted Ubuntu runner. It does not link a project, use hosted Supabase credentials, push migrations, deploy Edge Functions, publish Bolt, or access the Bolt Database.

## Files

- [database-security-tests.yml](../../.github/workflows/database-security-tests.yml) — branch-scoped GitHub Actions workflow.
- [test-github-actions-database-security.sh](../../scripts/test-github-actions-database-security.sh) — creates the isolated temporary Supabase project, filters unsafe migrations, runs the stack, and cleans it up.
- [database/privileged-rpc-security.sql](../../supabase/tests/database/privileged-rpc-security.sql) — CI entry point for real PostgreSQL assertions.
- [privileged-rpc-security.sql](../../supabase/tests/privileged-rpc-security.sql) — shared assertion body used by local and CI workflows.
- [20261017090000_security_harden_privileged_rpcs.sql](../../supabase/migrations/20261017090000_security_harden_privileged_rpcs.sql) — migration under test.

## Workflow behavior

The workflow:

1. Runs only on pushes to `security/authorization-hardening`.
2. Uses `ubuntu-latest` and `actions/checkout@v4`.
3. Grants the workflow only `contents: read` access.
4. Installs the Supabase CLI with `supabase/setup-cli`.
5. Installs only the PostgreSQL client needed for assertions.
6. Copies the repository migrations into a temporary test project.
7. Scans every migration for cron or outbound HTTP SQL before copying it.
8. Excludes the reviewed scheduler, superseded, and duplicate migrations recorded by the canonical sequence, then fails closed if any other migration contains a matching outbound/scheduled pattern.
9. Starts a local Supabase stack using Docker on the runner.
10. Applies the complete remaining migration baseline with `supabase db reset`.
11. Executes real PostgreSQL role, privilege, RPC, SECURITY DEFINER, search-path, RLS, and public-catalog assertions.
12. Resets the disposable database a second time to check clean reapplication.
13. Stops the local stack and removes the temporary project directory even after failure.

## Historical side-effect isolation

The migration [20261008142813_20261008150000_schedule_auto_reconciliation.sql.sql](../../supabase/migrations/20261008142813_20261008150000_schedule_auto_reconciliation.sql.sql) creates a `pg_cron` job, reads `_cron_secrets`, and calls `net.http_post` against a hosted Edge Function URL. It is intentionally excluded from this test baseline.

The migration [20260928071820_20260928_order_fulfillment_schema.sql](../../supabase/migrations/20260928071820_20260928_order_fulfillment_schema.sql) was repaired in place after the hosted baseline evidence showed that version `20260928062039` is the latest applied migration. It now creates `public.order_timeline`, `public.refunds`, and `public.order_notes` before applying policies. The later duplicate [20260929131301_20260928071820_20260928_order_fulfillment_schema.sql.sql](../../supabase/migrations/20260929131301_20260928071820_20260928_order_fulfillment_schema.sql.sql) is excluded from the canonical disposable sequence so the logical change is applied once in migration order.

The migration [20260928072329_20260928_fix_rpc_ambiguous_column.sql](../../supabase/migrations/20260928072329_20260928_fix_rpc_ambiguous_column.sql) is also excluded. It uses `CREATE OR REPLACE` to change `admin_change_order_status(uuid, text, text, text)` from `RETURNS TABLE (id uuid, status text)` to `RETURNS TABLE (id uuid, status text, updated_at timestamptz)`, which fails with PostgreSQL SQLSTATE 42P13. The repaired fulfillment migration now performs the required drop/recreate for the hosted baseline; the historical predecessor, its v3 duplicate, and later duplicate copies are excluded from the canonical sequence.

This is a test-only baseline reconstruction. It does not rewrite or delete any historical migration. The excluded fulfillment copy is superseded by the corrected duplicate, and the excluded ambiguous-column copy is superseded by the explicit drop/recreate migration immediately after it. The retained migrations therefore provide the complete later schema and security behavior without replaying a known-invalid historical replacement.

The migration [20260928124803_honor_of_kings_uid_input_field.sql](../../supabase/migrations/20260928124803_honor_of_kings_uid_input_field.sql) is excluded because it inserts a hardcoded game UUID that is not created by the catalog seed. The catalog migration [20260927062024_runfazone_core_catalog.sql](../../supabase/migrations/20260927062024_runfazone_core_catalog.sql) creates Honor of Kings by slug with `gen_random_uuid()`. The later corrected migration [20260929131902_20260928124803_honor_of_kings_uid_input_field.sql.sql](../../supabase/migrations/20260929131902_20260928124803_honor_of_kings_uid_input_field.sql.sql) resolves the game ID by slug, raises if the catalog record is absent, and remains included. A test fixture for the hardcoded UUID would conflict with the generated catalog identity and could alter catalog semantics, so the superseded historical copy is excluded instead.

The canonical baseline has thirteen explicit historical/duplicate exclusions: the reconciliation scheduler, superseded fulfillment and RPC copies, duplicate 20260929 copies, and hardcoded Honor of Kings UID migration. RF Coins migrations remain handled by the existing loopback-only rewrite path for compatibility testing. The wrapper also fails closed before database startup if the corrected slug-based Honor of Kings migration is missing. The expected count check fails closed if an exclusion is missing or the filter is changed.

The wrapper scans all other migrations for `cron.schedule`, `net.http`, `http_post`, `http_get`, and hardcoded function URLs. If a new matching migration is added without being explicitly reviewed and added to the exclusion policy, or if any expected baseline exclusion disappears, the workflow exits before starting the database.

This prevents the known reconciliation scheduler from being created and prevents an accidental new outbound SQL integration from silently entering the test baseline. The historical production migration is not edited.

The test does not execute Edge Functions, payment webhooks, supplier adapters, reconciliation jobs, or external HTTP services. Those production integrations remain outside this database-only test's coverage.

## Database assertions

The shared SQL test uses synthetic UUIDs and temporary transaction-scoped fixtures. It simulates Supabase execution contexts with `SET ROLE` and `request.jwt.claims`:

- `anon` cannot execute privileged RPCs.
- An authenticated non-admin cannot pass `is_payment_operator()`.
- An authenticated synthetic admin can read and mutate authorized game/payment configuration RPCs.
- `service_role` can perform trusted server-side operations.
- Supplier credential RPCs are not executable by public or authenticated roles.
- `admin_change_order_status` rejects non-admin access and preserves trusted service access.
- Effective anonymous execution is denied, including the PostgreSQL default `PUBLIC` path.
- Newly hardened functions are SECURITY DEFINER with `search_path = public` and trusted ownership.
- Public active game catalog reads remain available.

These are database behavior checks, not migration-text assertions.

## Activation and execution

The workflow file is prepared locally but is not active on GitHub until the branch containing it is pushed. After review and approval, push the branch containing these files. The push starts the workflow automatically.

The run appears under the repository's GitHub Actions tab. A green run means the filtered local migration baseline and assertions passed on that runner; it does not prove that the Bolt Database has the same schema or that production configuration is safe.

## Failure interpretation

- Failure before `supabase start`: runner tooling or Docker problem.
- Failure during migration filtering: a new outbound/scheduled migration requires explicit security review.
- Failure during `supabase db reset`: baseline migration ordering, extension, duplicate-version, or Supabase compatibility issue.
- Failure in SQL assertions: an actual role, grant, function, RLS, authorization, or fixture regression.
- Failure during the second reset: migration retry/idempotency problem.

Do not bypass a failing migration by connecting to a hosted database or by adding production secrets. Preserve the full error log and investigate the named migration in a disposable environment.

## Security guarantees and limitations

Guaranteed by the workflow:

- No GitHub production secrets are referenced.
- No Supabase project reference or remote database URL is configured.
- No `supabase db push`, remote link, Edge Function deployment, or Bolt publishing command exists.
- The database URL is checked to be loopback before `psql` runs.
- The reviewed scheduler, superseded historical migrations, duplicate copies, and hardcoded Honor of Kings UID migration are explicitly excluded.
- Temporary Docker services and files are cleaned up on exit.

Limitations:

- The excluded scheduler migration is not integration-tested here.
- The excluded historical RPC replacement is not integration-tested as a standalone migration; its corrected drop/recreate successor and final hardened definition are tested.
- The excluded hardcoded Honor of Kings migration is not integration-tested as a standalone migration; its slug-based corrected successor is tested.
- The actual Bolt Database schema, roles, deployed functions, Vault contents, schedules, and secrets are not verified.
- GitHub runner Docker isolation prevents normal access to the internet from the test SQL path, but this workflow is additionally protected by migration filtering; it is not a substitute for production network policy.
- Database tests do not prove payment-provider or supplier-provider behavior.
- No production migration approval is implied by a green Actions run.

## Billing and removal

GitHub-hosted runners consume Actions minutes according to the repository plan. Docker startup and the full migration reset can take several minutes per push. The concurrency setting cancels obsolete in-progress runs for this branch.

To stop future runs, disable or remove the workflow from the branch after review. To remove it permanently, delete [database-security-tests.yml](../../.github/workflows/database-security-tests.yml) and the associated test script/documentation in a reviewed commit. No production resources need cleanup because the workflow uses only ephemeral runner-local containers.

## Historical migration limitation

The repository contains duplicate `.sql.sql` migrations and superseded migrations whose execution order or replacement semantics are not valid on a clean database. The former `order_timeline` policy error occurred in the earlier fulfillment copy because its table was created only later in the duplicate; the copy is now repaired for the observed hosted baseline, while the duplicate is excluded from the canonical sequence. The repaired fulfillment migration also drops the earlier two-column `admin_change_order_status` signature before creating its three-column return shape. The older ambiguous-column copy remains excluded because it attempts the same incompatible replacement without a drop. These defects can affect a clean installation that applies the raw history without the existing production schema. The workflow tests the corrected forward schema while preserving historical files for production-state investigation.

## Current status

The workflow and test files have been prepared and statically checked in Codex Cloud. The GitHub-hosted Docker/Supabase integration run has not executed yet. No database integration result is claimed until GitHub Actions completes successfully.
