# Fresh Supabase backend manifest

This is a repository-derived preparation artifact for a new development
project. It is not evidence of a deployed Supabase project. The repository
currently exposes no callable Supabase MCP tools in this Codex session, so
remote identity, ownership, quota, region, billing, applied migrations, and
permissions remain unverified.

## MCP and provisioning gate

Current discovery result: GitHub MCP tools are available, but no Supabase
organization/project, database, schema, migration, Edge Function, secrets,
quota, billing, or region tool is callable. No Supabase project was created,
linked, authenticated, or modified.

Provisioning requires owner confirmation of all of the following through an
actual Supabase control-plane connection:

1. project identity, organization, owner, region, and environment label;
2. free-plan eligibility, quota availability, and expected monthly cost;
3. confirmation that the project is independent development infrastructure;
4. confirmation that no production project, billing setting, provider secret,
   webhook, SMTP account, or supplier account will be changed.

Until then, expected monthly cost is **unknown / not quoted**. Do not infer
free-plan eligibility from repository files or from successful MCP login.

## Local migration classification

The local tree contains 115 SQL migration files. All are classified as
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
