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

The catalog importer exercises three synthetic game top-up categories:
`mobile_legends_philippines`, `pubg_mobile_global`, and
`genshin_impact_global`. The paginated fixture also exposes a Steam gift-card
category marked unsupported, to prove code-delivery products cannot enter the
game top-up flow. Categories, offers, region/currency data, player fields, and
costs are synthetic; the disposable seed creates a disabled FazerCards row with
empty credentials. The browser and integration suites call only loopback app and
Supabase endpoints. Live catalog access requires independent upstream-key
revocation verification, a separate owner authorization, server-only credential
configuration, and explicit release gates; no such gates or credentials are set
to an enabling value by this fixture. `/api/admin/sync-offers` remains release-locked, payment runs
in mock mode, supplier fulfillment remains disabled in both app and database
settings, and RF Coins flags/payment method remain false. No payment, supplier
purchase, hosted migration, or external email operation is part of this suite.

No hosted supplier configuration was created or verified. Before any separately
approved live catalog access, the owner must verify upstream revocation of the
historically exposed FazerCards key, authorize catalog access, verify the current
provider's catalog endpoint/response contract, and provision any new credential
only as a server-side secret. No live `/topups` or `/offers` request was made in
this batch. The source gate uses these names only:
`RUNFAZONE_SUPPLIER_CATALOG_RELEASE`,
`FAZERCARDS_CREDENTIAL_REVOCATION_VERIFIED`,
`FAZERCARDS_CATALOG_ACCESS_AUTHORIZED`, and `FAZERCARDS_API_KEY`; the existing
`fazercards` supplier row must also be explicitly enabled. No enabling
production values are configured here; local tests set only explicit
disabled/fixture values. Catalog
visibility/import authorization is not fulfillment authorization: supplier
ordering remains separately gated by
`RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE`,
`app_settings.supplier_fulfillment_release_enabled`, and the individual mapping
state. Do not enable payment or fulfillment as part of catalog review.

The admin catalog screen supports category/offer pagination, choosing an
existing game or creating a draft game, selected-offer preview, draft import,
and a database-backed storefront preview. Imported offers are not published or
saleable by default. Use the existing game/package admin pages to configure
buyer fields, prices, margins, and catalog visibility. Supplier fulfillment
must remain independently disabled until its separate production approval.

For manual cleanup after a forced machine shutdown, find the exact project ID
and `CATALOG_DISPOSABLE_STACK_PATH` reported by the runner, then run
`supabase --workdir <exact-reported-stack-path> stop --no-backup`; do not use
`supabase stop --all`. A normal run performs this cleanup automatically.
Temporary Auth keys and generated passwords are not production secrets and must
never be copied into repository files or hosted configuration.
