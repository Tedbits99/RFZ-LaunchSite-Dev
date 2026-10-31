# Hosted ACL remediation: scoped application and recovery package

**Current status: the postgres-owned ACL migration is applied through the
approved Supabase GitHub deployment on `main`.** The owner confirms its
execution provenance and recorded SQL were reconciled. The trusted metadata
audit after deployment confirms the expected postgres-owned ACL post-state.
Do not reapply migration `20261028113000`. This is development-only state for
project `ketdhcmwowzztcdlmris`; it does not itself authorize merging PR #82.
The owner-approved automatic deployment policy permits the reviewed RF Coins
migrations only after required gates pass and the exact PR merge is approved.

## Evidence and scope

- The trusted metadata-only audit was run on `main` SHA
  `b726746dfd42b0976188cb8e0c731e46cd97f092` (workflow `40639888077`), against
  PostgreSQL 17.11. It found 36 public tables, all RLS-enabled and owned by
  `postgres`; no data rows were exported.
- The pre-application audit identified 204 direct excess privilege entries: `TRUNCATE`,
  `REFERENCES`, `TRIGGER`, and `MAINTAIN` on 24 public tables for `anon` and
  `authenticated`, plus three more tables for `authenticated`. All were
  directly granted by `postgres` and not grantable onward.
- It also identified 16 matching default ACL entries owned by `postgres` in
  `public`/`storage`, and 24 owned by `supabase_admin` in
  `public`/`graphql`/`graphql_public`.
- Owner-provided role verification says hosted `postgres` is not a superuser,
  is not a member of `supabase_admin`, and cannot `SET ROLE` to it. This
  source change treats those as a hard authority boundary. A disposable PG17
  rehearsal independently models that boundary; it does not prove access to
  the hosted project.

## Prepared SQL and hashes

| Operation | File | SHA-256 | Executor scope |
|---|---|---|---|
| Applied ACL migration | `supabase/migrations/20261028113000_revoke_browser_table_ddl_privileges.sql` | `a4e166a9fa808760d3e5da3e96045dbf9e8f3f476a6f45392a5dce20dd58a82d` | Hosted `postgres`; exact audited relation grants and its own two default contexts |

PR #90 introduced the ACL migration without RF Coins SQL. The ACL migration does not
alter SELECT/DML grants, RLS, policies, table contents, `PUBLIC`, or
`service_role`. It fails closed if the audited table ownership,
RLS, grant count/provenance, default-ACL counts, or PostgreSQL version no longer
match. It is retry-safe for the exact all-present or all-removed direct-ACL
states and rejects partial drift. Tests snapshot all provider-owned defaults
before and after execution. The hosted audit baseline is 24 entries in the
three documented schemas; the disposable local Supabase stack also provisions
eight managed defaults in `supabase_functions`, which the rehearsal verifies
remain unchanged. That local fixture detail is not evidence of hosted entries.

## Current verification and remaining boundary

The post-deployment metadata audit is workflow `40659937258` on main SHA
`0fde4cf946c85150fc0a607657e4a9e18f8c4afe`; its sanitized artifact reports 36
public tables (all postgres-owned and RLS-enabled), zero audited direct excess
grants, zero postgres-owned defaults in public/storage, and 24 audited
`supabase_admin` defaults preserved. The migration ledger contains 101
versions, including `20261028113000`; before/after lists for that audit were
identical. The audit exported no rows. The owner reconciled migration
provenance and recorded SQL; no application of this migration occurred in the
audit session.

The 24 hosted `supabase_admin` defaults remain separately tracked and were not
modified. Do not attempt `SET ROLE`, grant membership, or use the ordinary
postgres migration path to change them. Any future provider-owned ACL change
needs a documented Supabase-supported authority and its own review.

Before the proposed wallet schema deployment:

1. Verify exact current main, project identity, hosted migration ledger and
   schema through the protected workflow. Do not repeat the applied ACL
   migration, reset, repair, or blanket-push migration history.
2. Rehearse the exact wallet migration set on disposable PostgreSQL 17 and
   require the full exact-head CI, including RLS/RPC, checkout/payment,
   concurrency and legacy-upgrade regressions.
3. Review deployable SQL and Edge Function changes for data preservation,
   authorization and side effects. Keep wallet funding/spending, financial
   cron, supplier fulfillment, live providers and customer email disabled.
4. Require the owner's approval of the exact PR #82 merge candidate. Only the
   reviewed migrations and function sources in that approved merge may deploy
   through the existing automatic Supabase integration.
5. After deployment, verify migration history, schema, RLS/permissions,
   customer/admin behavior, checkout/payment compatibility, Edge Function
   health and all financial release locks. Stop on unexpected drift.

## Exact-SHA merge and automatic deployment policy

PR #90 has been merged and its ACL migration deployed through the approved
Supabase GitHub integration. This operation is complete; do not dispatch
another ACL `plan` or `apply`. PR #82 remains OPEN/DRAFT. For a future PR #82
release, exact-head security/build checks and migration reviews must pass, and
the owner must approve that exact merge candidate. The existing native
deployment may then apply only the reviewed migration/function sources in the
approved merge, followed immediately by post-deployment verification. No
automatic wallet funding, spending, cron, supplier or live-payment activation
is permitted by schema deployment.

No hosted migration was executed by this audit session. PR #82 wallet SQL
remains pending and separate from the already-applied ACL migration.

## Free-plan recovery and rollback

Supabase Free paid backups/PITR and production-style restore rehearsals are
not required. No paid resource, export, or manual snapshot was created in this
batch. Migration history is not a backup of rows. This ACL migration changes
privileges only and is transaction-wrapped; the inverse grants below provide
a scoped rollback. A manual recovery snapshot is recommended before
substantial or irreversible schema/data changes, but is not a prerequisite
for this ACL-only operation.

The ACL migration does not delete or update rows. Its inverse statements are
retained below for recovery reference only; do not run them without a fresh
metadata check and explicit scoped authorization:

```sql
GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.announcements, public.app_settings, public.email_sent_log,
  public.game_input_fields, public.games, public.global_announcement,
  public.notifications, public.order_notes, public.packages, public.payment_config,
  public.payment_submissions, public.payment_transactions, public.player_cache,
  public.promotions, public.refunds, public.supplier_package_mappings,
  public.supplier_test_runs, public.suppliers, public.support_messages,
  public.support_tickets, public.verification_attempts, public.verified_users,
  public.voucher_usages, public.vouchers TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.admins, public.order_timeline, public.orders TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage
  GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon, authenticated;
```

The provider-owned defaults are not changed by this migration and require a
separate Supabase-supported remediation. Before any future destructive
data/schema operation, a manual recovery snapshot to secure, owner-controlled
storage is recommended; it is not a blanket Free-plan prerequisite.

## Data inventory status

- Pre-migration schema/ACL metadata: run `40639888077` as above (100 hosted
  versions at that time). Post-migration ACL metadata: run `40659937258`
  (101 hosted versions, including the applied ACL migration).
- Counts above are from the sanitized read-only artifacts for runs
  `40639888077` and `40659937258`; no application row values were exported.
- This audit session made no hosted ACL changes, migration applications, row
  writes, exports/restores, payments, supplier actions, email sends or Worker
  activation.
- The three RF Coins migrations are candidates in draft PR #82, not hosted
  schema changes. Wallet funding and spending remain disabled; PayMongo product
  checkout is separate and unchanged.
