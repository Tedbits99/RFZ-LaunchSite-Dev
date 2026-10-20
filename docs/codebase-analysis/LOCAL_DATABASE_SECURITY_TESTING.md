# Local Database Security Testing

This workflow tests [20261017090000_security_harden_privileged_rpcs.sql](../../supabase/migrations/20261017090000_security_harden_privileged_rpcs.sql) against a disposable local Supabase stack. It uses synthetic fixtures only and refuses to run when the database URL is not local.

It is not a production deployment workflow. Do not place Bolt, hosted Supabase, customer, payment, supplier, or production authentication settings in the shell environment used for these commands.

## What the test requires

The migration chain is Supabase-specific. Reliable testing requires:

- Docker Desktop or Docker Engine with a working local daemon.
- Supabase CLI.
- PostgreSQL `psql` client.
- This repository and its complete `supabase/migrations/` directory.
- Local Supabase services including Postgres, Auth, PostgREST, and Vault. The migration history uses Supabase roles (`anon`, `authenticated`, and `service_role`), the `auth` schema, Vault tables/functions, RLS, and UUID generation.

Plain PostgreSQL alone is not an adequate substitute for the role and JWT behavior tested here.

## Installation

### Windows

1. Install Docker Desktop and enable its Linux container engine.
2. Install the Supabase CLI using Scoop:

   ```powershell
   scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
   scoop install supabase
   ```

3. Install `psql` with PostgreSQL for Windows, or use WSL with the PostgreSQL client package.
4. Run the repository script from Git Bash or WSL:

   ```bash
   bash scripts/test-local-database-security.sh
   ```

### macOS

```bash
brew install supabase/tap/supabase libpq
brew link --force libpq
brew install --cask docker
```

Start Docker Desktop, then run:

```bash
./scripts/test-local-database-security.sh
```

### Linux

Install Docker Engine using the distribution's official Docker instructions, then install the Supabase CLI from its official release channel. Install the PostgreSQL client with the distribution package manager, for example:

```bash
sudo apt-get update
sudo apt-get install postgresql-client
```

Ensure the current user can access Docker, then run:

```bash
./scripts/test-local-database-security.sh
```

The script requires the `supabase` and `psql` commands on `PATH` and never accepts a remote `DB_URL`.

## Exact execution workflow

From the repository root:

```bash
supabase start
./scripts/test-local-database-security.sh
```

The script:

1. Confirms the Supabase CLI and `psql` are installed.
2. Starts the local stack if it is not running.
3. Reads the local-only database URL from `supabase status`.
4. Refuses non-local hosts.
5. Builds the same reviewed disposable baseline used by GitHub Actions, excluding the known reconciliation scheduler and the incomplete historical fulfillment copy while retaining the corrected duplicate migration.
6. Runs `supabase db reset`, which recreates the disposable database and applies that baseline, including the new migration.
7. Executes [privileged-rpc-security.sql](../../supabase/tests/privileged-rpc-security.sql) using `psql`.
8. Runs a second `supabase db reset` to check clean retry/idempotency of the migration chain.

The SQL test uses `SET ROLE` and synthetic `request.jwt.claims` values to model PostgREST's `anon`, `authenticated`, and `service_role` execution contexts. It creates an isolated admin, game, package, and order fixture and rolls back test assertions at the end.

## Checks performed

The test suite verifies actual database behavior for:

- Anonymous execution denial for privileged game, payment, order-status, and supplier-credential RPCs.
- Authenticated non-admin denial through `is_payment_operator()`.
- Authenticated admin access to game and payment configuration reads.
- `service_role` access for trusted game/payment operations and order status transition.
- Supplier credential execution isolation from `authenticated`.
- Revocation of effective anonymous execution, including the PostgreSQL default `PUBLIC` grant path.
- Public catalog reads through RLS.
- `SECURITY DEFINER` and `search_path = public` on newly hardened functions.
- Reapplication of the migration chain after a clean reset.

The test does not call PayMongo, FazerCards, external webhooks, supplier APIs, or any production endpoint.

## Expected output

A successful run ends with:

```text
PASS: local disposable database security tests completed.
```

The SQL output should include `t` for the `*_ok` assertions. Any unexpected permission result, missing function/table, migration error, or non-local URL causes a non-zero exit.

## Failure and retry testing

`supabase db reset` applies each migration transactionally and the second reset checks that the complete migration set can be reapplied from a clean disposable state. The test intentionally does not provide a rollback that restores `PUBLIC` execution, because that would recreate the security vulnerability.

To investigate a migration failure safely:

```bash
supabase db reset 2>&1 | tee /tmp/runfazone-supabase-reset.log
```

Review the first failing migration and its PostgreSQL error. Do not edit historical migrations to make the test pass. Fix only a new forward migration after confirming the exact function signature and dependency issue, then reset the disposable stack and rerun the full suite.

## Troubleshooting

### Docker permission or daemon errors

Start Docker Desktop or the Docker service and confirm `docker info` works for the current user. Do not work around this by pointing the script at a hosted database.

### `psql` is missing

Install the PostgreSQL client. The client is required because the tests must exercise PostgreSQL roles and `SET ROLE`, not just inspect migration text.

### Migration fails before the security test

The repository contains historical migrations with duplicate `.sql.sql` suffixes and several Supabase/Vault dependencies. Treat a migration failure as an environment or baseline-schema result. Capture the exact migration filename and error; do not skip it or run only the new migration on an incomplete schema.

### Auth claims do not behave as expected

Run the tests through the local Supabase database URL and preserve the `SET ROLE` plus `request.jwt.claims` setup. Do not substitute arbitrary application headers or a production JWT.

### Port conflicts

Stop other local Supabase/Docker projects or configure a separate disposable checkout. Never expose the database port publicly.

## Cleanup

When finished, remove the local Supabase containers and volumes:

```bash
supabase stop --no-backup
```

The test fixtures are synthetic. The cleanup command removes the disposable local stack; it does not contact or alter any hosted database.

## Current execution status in this workspace

The test files were prepared locally but have not executed here. This environment previously lacked `psql` and could not access the Docker daemon, so no database integration result is claimed. Application-level checks remain separate from these PostgreSQL integration tests.
