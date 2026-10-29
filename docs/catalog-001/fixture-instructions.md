# CATALOG-001 disposable integration environment

Run the complete local-only acceptance stack from the repository root:

```sh
npx playwright install chromium
scripts/catalog-001/run-local-acceptance.sh
```

Requirements: Node.js 22, npm dependencies from the lockfile, Docker, and the
Supabase CLI 2.121.0. The runner verifies the canonical migration manifest,
copies only the reviewed migrations into a fresh temporary Supabase project,
allocates distinct loopback ports, starts PostgreSQL 17 + GoTrue + PostgREST +
local Inbucket, resets only that local project, provisions synthetic identities,
and runs the database-backed contract and desktop/mobile browser suites. It
always calls `supabase stop --no-backup` and removes only its uniquely created
`/tmp/rfz-catalog-001.*` directory, including on interruption.

The command intentionally has no persistent `start` mode. Setup, test, and
teardown are one reproducible operation so that a reset cannot accidentally
target an existing or linked project. The script removes inherited
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, project-ref, and DB URL
overrides from every CLI invocation, rejects linked project metadata, and
requires the reported API and PostgreSQL endpoints to be loopback and match the
ports selected for that run. The project ID is unique per run/attempt. No
hosted Supabase project or migration endpoint is used.

The PR #93 GitHub acceptance job creates a temporary integration worktree from
the exact PR #93 candidate SHA and companion acceptance SHA
`3c6c1ba315ff482acd5eefd4f62ab190b813ef3e`. It activates the nine companion
Vitest contracts against the database-backed suite and executes the 16 real
admin/storefront browser scenarios in desktop and mobile projects (32 runs).
The worktree exists only on the CI runner; neither agent branch is changed.
Running this script from the PR #93 checkout alone uses the same real catalog
integration and browser suites, but does not import PR #92's companion files.

Synthetic Auth identities use `admin@example.invalid`, `staff@example.invalid`,
and `customer@example.invalid`. Passwords are random per run, stay in the
temporary test environment, and are not printed. The admin row has role
`ADMIN`, the staff row has role `STAFF`, and the customer receives an active
synthetic customer profile through the admin status RPC. GoTrue email is
confirmed locally and uses only the in-container Inbucket SMTP binding; no
email is delivered externally.

Deterministic seed records are `catalog-001-seed-draft`,
`catalog-001-seed-published`, and `catalog-001-seed-archived`, with matching
synthetic packages. The acceptance fixtures add run-tagged, uniquely keyed
games and offers so desktop/mobile projects cannot collide. Every database
write is to the disposable local stack. A clean reset removes all fixture rows.

The snapshot importer currently supports only the approved Mobile Legends
category `mobile_legends_philippines`; it does not claim general supplier
category importing. It performs no provider request. `/api/admin/sync-offers`
remains release-locked, FazerCards is seeded disabled, payment runs in mock
mode, supplier fulfillment remains disabled in both app and database settings,
and RF Coins flags/payment method remain false. No payment, supplier purchase,
or hosted email operation is part of this suite.

For manual cleanup after a forced machine shutdown, find the exact project ID
and `CATALOG_DISPOSABLE_STACK_PATH` reported by the runner, then run
`supabase --workdir <exact-reported-stack-path> stop --no-backup`; do not use
`supabase stop --all`. A normal run performs this cleanup automatically.
Temporary Auth keys and generated passwords are not production secrets and must
never be copied into repository files or hosted configuration.
