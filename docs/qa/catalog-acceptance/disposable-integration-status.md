# CATALOG-001 disposable integration status

Integration branch: `codex/rfz-catalog-001-integration-disposable`.

## Exact inputs

- Agent A / PR #82 implementation head: `e131e4ef0eef86785c7eeade4717ccbd049588a6`.
- Companion acceptance head integrated locally: `3c6c1ba315ff482acd5eefd4f62ab190b813ef3e`.
- Local integration merge commit: `a541c9f`.

## Reproducible blocker

PR #82's current baseline does not implement the required catalog workflow:

- `app/admin/games/page.tsx` renders an `Add Game` button without an action.
- No database-backed game create/edit/archive/restore/publish API or UI exists.
- Existing visibility uses `is_active` only; archive/restore state and historical
  catalog lifecycle contracts are not available.
- No disposable Supabase Auth/PostgreSQL fixture, synthetic storage state, or
  deterministic catalog seed command is configured in the repository.

These are implementation dependencies owned by Agent A. They are not converted
into fabricated test passes on this integration branch.

## Verification on the integration branch

- Contract suite: 11 passing, 9 explicit `todo` contracts.
- Browser suite: 32 desktop/mobile cases explicitly skipped as
  `PENDING_IMPLEMENTATION`.
- TypeScript: PASS.
- Lint: PASS with existing repository warnings only.
- Production build: PASS.
- Hosted database, Auth, supplier, payment, email, migration, and deployment
  operations: NOT RUN.

## Activation gate

When Agent A supplies a new exact implementation SHA and local fixture
instructions, rebase is prohibited. Create a fresh disposable integration
branch from that SHA, apply the companion tests, replace only applicable
`fixme` cases with real authenticated flows, capture sanitized evidence, and
require every mandatory matrix row to report PASS before phase advancement.
