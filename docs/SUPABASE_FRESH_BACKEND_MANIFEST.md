# Fresh Supabase backend manifest

This is a repository-derived preparation artifact for a new development
project. It is not evidence of a deployed Supabase project. A later
authenticated, project-scoped Supabase MCP inspection verified database
metadata for project reference `ketdhcmwowzztcdlmris`; control-plane
ownership, organization, region, quota and billing remain unexposed by the
available MCP tools.

## MCP and provisioning gate

Current discovery result: the Supabase MCP server is registered and OAuth
authenticated with the project-scoped URL for `ketdhcmwowzztcdlmris`.
Read-only calls successfully returned the project URL, tables, migrations,
extensions, branches, Edge Function list, catalog metadata and advisors. The
MCP tool set also exposes write-capable operations; this batch used none of
them, so read-only handling is procedural rather than a claim that the server
enforces a read-only token.

Verified project URL: `https://ketdhcmwowzztcdlmris.supabase.co`.
The project is identifiable as an existing RunFazone backend because its
schema contains the RunFazone catalog tables and its applied migration names
are `runfazone_*`. Ownership, organization, region, plan, quota and
environment designation were not returned by the available project-scoped
tools and must not be inferred from the reference or names.

The effective Codex registration is a project-scoped streamable HTTP server
with the URL above and feature flags for docs, account, database, debugging,
development, functions and branching. It contains no `read_only=true`
parameter, bearer-token environment variable, or HTTP-header restriction.
Therefore this evidence proves project scope and successful read-only use, but
does not prove server-enforced read-only permissions. The safe operating rule
for Phase 0 is to call only metadata/catalog/advisor tools and never invoke the
exposed write-capable tools.

Provisioning requires owner confirmation of all of the following through an
actual Supabase control-plane connection:

1. project identity, organization, owner, region, and environment label;
2. free-plan eligibility, quota availability, and expected monthly cost;
3. confirmation that the project is independent development infrastructure;
4. confirmation that no production project, billing setting, provider secret,
   webhook, SMTP account, or supplier account will be changed.

Until then, expected monthly cost is **unknown / not quoted**. Do not infer
free-plan eligibility from repository files or from successful MCP login.

## Live hosted inventory and migration reconciliation

The authenticated read-only inspection returned 13 public tables, all with
RLS enabled; 48 public constraints; 30 public indexes; no public views or
materialized views; five public routines; 13 public policies; no public
triggers; no Realtime publication members; and no deployed Edge Functions.
The `auth`, `storage` and `vault` schemas exist. No storage bucket or storage
policy metadata was returned. The database catalog did not expose Auth
provider configuration, backup/PITR settings, or organization/project
ownership metadata.

The hosted migration ledger contains exactly these 11 versions, all matching
the first 11 logical migrations in the active local tree:

`20260927062024`, `20260927063133`, `20260927064634`, `20260928042134`,
`20260928051223`, `20260928055204`, `20260928055236`, `20260928060956`,
`20260928061342`, `20260928062007`, `20260928062039`.

The remote tool returned version/name metadata but not checksums, so content
identity is not proven. The active local tree contains 115 SQL files: 11
applied matches and 104 locally defined, unrecorded candidates. It also has
two pending RF Coins files and 13 archived duplicate copies. The unrecorded
set includes the receipt/reconciliation, supplier, security, and RF Coins
families; their absence from the hosted ledger is not permission to apply
them. No remote-only version was identified from the returned ledger.

The default `main` branch is reported as `MIGRATIONS_FAILED`; its preview
status is `ACTIVE_HEALTHY`. The available branch metadata and read-only logs
did not identify a failed migration version or machine-readable failure
message. The primary database answered catalog queries, but complete branch
health and partial-application state remain unverified. No reset, repair or
hosted migration was attempted.

Security advisors reported three RLS-enabled public tables without policies:
`payment_submissions`, `voucher_usages` and `vouchers`. They also reported
five public `SECURITY DEFINER` routines executable by `anon` and
`authenticated`, including the legacy admin status/game routines and
`rls_auto_enable`, plus disabled leaked-password protection. These are live
findings, not fixes applied by this audit.

The five hosted public routines are owned by `postgres` and use fixed
`search_path` values: `admin_change_order_status(uuid,text,text,text)` uses
`search_path=public`; `admin_get_all_games()`;
`admin_get_games_with_package_counts()`; and
`admin_set_game_active(uuid,boolean)` use `search_path=public`; and
`rls_auto_enable()` uses `search_path=pg_catalog`. The first four are
`SECURITY DEFINER` and currently grant `EXECUTE` to `anon` and
`authenticated`; `rls_auto_enable` has no explicit ACL returned. The function
bodies contain no `auth.uid()`/admin-row authorization checks. The status
routine validates state transitions but not caller identity; the game routines
read or update catalog state without caller authorization. These are confirmed
privilege-boundary exposures, not merely hypothetical risks. Application call
sites include the admin games page/API and admin order status/refund routes;
the payment webhook also calls the status routine. The repository contains a
later source migration that revokes public grants and adds authorization
checks, but that migration is not present in the hosted 11-version ledger.
The safe mitigation is to apply and verify the reviewed security migration in
an isolated development project first, then separately approve any hosted
change; this audit made no fix.

No `cron` or `net` schema was present in the catalog, no Realtime members were
reported, and the Edge Function list was empty. The installed extension
metadata included `supabase_vault`, `pgcrypto`, `pg_stat_statements`,
`uuid-ossp` and `plpgsql`; `pg_cron` and `pg_net` were listed as available but
not installed. No outbound target or secret value was retrieved.

## Local migration classification

The local tree contains 115 active SQL migration files. All beyond the 11
verified hosted matches are classified as
`local-candidate` only; none is classified as remotely applied or pending
without Supabase migration-history evidence.

### Canonical installation groups

Install only from a reviewed, normalized manifest in this order:

1. **Core catalog and commerce primitives** — the 20260927 core catalog,
   vouchers/promotions, games/package policies, order/payment/fulfillment
   foundations, supplier management, and payment configuration.
2. **Admin and customer security** — admin identity, player verification,
   order lockdown, voucher uniqueness/deduplication, SECURITY DEFINER checkout
   functions, customer profiles, guest-order access, ownership lockdown, and
   customer confirmation rate limits.
3. **Payment and fulfillment invariants** — payment status separation,
   terminal-state protections, advisory/atomic fulfillment claims, payment
   proof, supplier mapping capture, and direct-completion restrictions.
4. **Receipt and reconciliation** — atomic supplier reconciliation, durable
   completion-receipt outbox, authoritative snapshot data, worker claim/ack/
   fail RPCs, and the final legacy quarantine contract.
5. **Realtime and operations** — orders and order-timeline publication,
   email-sent logging, archive RPC restrictions, and reviewed operational
   policies.
6. **RF Coins** — schema, functions, admin adjustments, settings/package
   handoff, grants, and security remediation. This is a separate dependency
   group and must not be enabled until its payment/fulfillment contract is
   approved for the new project.

### Duplicate and replacement families

The tree contains duplicated or suffixed migration families, including the
original 20260928 order-fulfillment, payment-enhancement, RLS, supplier,
player-verification, and RPC migrations followed by 20260929 copies. The
canonical manifest must select one reviewed version per logical change and
record every excluded predecessor; it must not execute both copies blindly.

Known reviewed disposable-baseline exclusions are the historical incomplete
fulfillment schema, ambiguous RPC, hard-coded Honor of Kings UID migration,
and the scheduler migration. The corrected Honor of Kings migration is the
required replacement in the current isolated harness.

### Deterministic fresh-install procedure

The canonical fresh install is a generated, reviewed selection—not a replay
of every filename. Build it from the lexicographically sorted active tree,
then apply these deterministic dispositions: retain one reviewed core
version per logical object; retain the later security/replacement migration
only after its predecessor and dependencies are recorded; exclude every
archived duplicate; keep the two pending RF Coins files outside the baseline
until their handoff contract is approved; and quarantine all scheduler,
provider-URL, Vault-secret and Edge-target SQL behind mock/loopback guards.
Record for every active file its local path, timestamp, logical family,
disposition, dependency predecessor and outbound classification. A fresh
install is reproducible only when this manifest, a schema/object inventory,
and a clean disposable run all agree.

The disposable gate must: start an unlinked local Supabase instance; reject
non-loopback provider, email, supplier, payment and Edge URLs before startup;
assert no real credential variables are inherited; run migrations in manifest
order; verify tables, constraints, RLS, grants, RPC authorization, receipt
outbox/reconciliation idempotency and transaction boundaries; run the worker
engine against synthetic fixtures; and stop/clean up in a trap. The existing
GitHub workflow and loopback rewrite guard provide this safety pattern, but
local image startup remains blocked and a clean full disposable installation
has not yet completed.

### Archived and pending state

No repository directory is authoritative for archived migrations. “Archived”
and “pending” are remote states that require the project's migration-history
table/export. Local filenames alone cannot establish either state.

## Outbound and automation quarantine

The local history contains two outbound/scheduled behaviors that must be
excluded or rewritten for a fresh development install:

- the auto-reconciliation `pg_cron`/`pg_net` migration targets a hosted
  `auto-reconciliation` function and reads `_cron_secrets`;
- the RF Coins handoff migration contains a hosted `fulfillment-handoff`
  target and a corresponding secret pattern.

For development, schedules remain disabled and both destinations are replaced
with a loopback sink or mock adapter in the disposable harness. Never seed real
PayMongo, FazerCards, Titan SMTP, webhook, or historical provider credentials.

## Required remote reconciliation evidence

After owner-authorized read-only access exists, capture and compare:

- migration history and checksums;
- tables, columns, indexes, foreign keys, checks, extensions, and replica
  identity;
- RPC bodies, owners, `SECURITY DEFINER`, `search_path`, and grants;
- RLS enabled/forced state and every policy expression;
- Realtime publication membership;
- cron jobs, `pg_net` requests, Edge Function routes, and outbound URLs;
- backup/PITR/export/restore settings and restore-test evidence;
- Edge Function deployment list and non-secret configuration metadata.

Do not fetch secret values. Record only secret names, storage location, and
whether a synthetic development value is present.

## Backend automation plan

The target development automation is:

1. `create_order` validates catalog/package/input data server-side and persists
   integer-cent pricing, voucher snapshots, ownership capability, and an
   idempotent order reference.
2. Payment webhooks verify provider signatures, event IDs, order identity,
   amount, currency, and state transitions before calling secure RPCs.
3. Fulfillment may start only after verified payment and an atomic claim. The
   supplier idempotency key and captured mapping prevent duplicate top-ups.
4. Reconciliation polls only synthetic/mock providers in development and
   finalizes supplier outcomes transactionally.
5. Completion receipts use the outbox claim/lease/ack/fail protocol; malformed
   or historical data is dead-lettered without reversing supplier completion.
6. Notifications run through a private Edge Function with bounded retries,
   sanitized errors, and no browser-visible credentials.
7. Admin overrides require authenticated admin RPC boundaries, explicit
   approval/audit entries, terminal-state protections, and no direct table
   bypass.
8. Recovery covers duplicate webhooks, provider timeouts, expired leases,
   supplier retries, dead letters, reconciliation replay, and restore drills.

These are preparation boundaries for later roadmap phases, not a claim that a
fresh backend is operational.

## Fresh-install validation gate

Before calling the backend reproducible, run the isolated database suite,
customer/auth/RLS assertions, reconciliation concurrency tests, receipt/outbox
tests, TypeScript/lint/build checks, Edge Function checks, and a synthetic
provider integration test. Record the exact migration manifest, project ref,
region, schema hash, and test commit. Hosted payment, supplier, and email
operations remain prohibited until separately approved.
