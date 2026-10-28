# Hosted ACL remediation: scoped application and recovery package

**Status: migration-only PR candidate, NOT applied.** This is a development-only
operation for Supabase project `ketdhcmwowzztcdlmris`. The migration is being
prepared for the trusted main-only workflow; merging it and applying it are
separate owner decisions. It does not change PR #82's DRAFT hold.

## Evidence and scope

- The trusted metadata-only audit was run on `main` SHA
  `b726746dfd42b0976188cb8e0c731e46cd97f092` (workflow `40639888077`), against
  PostgreSQL 17.11. It found 36 public tables, all RLS-enabled and owned by
  `postgres`; no data rows were exported.
- The audit identified 204 direct excess privilege entries: `TRUNCATE`,
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
| Supported ACL migration | `supabase/migrations/20261028113000_revoke_browser_table_ddl_privileges.sql` | `1f2e15394eded12511e86db5217c8bc534b5846e8de73659ca3fe3fb3a590b4f` | Hosted `postgres`; exact audited relation grants and its own two default contexts |

The migration-only PR contains no RF Coins SQL. The ACL migration does not
alter SELECT/DML grants, RLS, policies, table contents, `PUBLIC`, or
`service_role`. It fails closed if the audited table ownership,
RLS, grant count/provenance, default-ACL counts, or PostgreSQL version no longer
match. It is retry-safe for the exact all-present or all-removed direct-ACL
states and rejects partial drift. Tests snapshot all provider-owned defaults
before and after execution and require the same 24 entries.

## Application order and preconditions

No operation is authorized by this package alone. Before any future application:

1. Confirm the exact current project ref and PostgreSQL version through the
   protected main-only workflow. Compare the hosted migration ledger and
   schema inventory against the reviewed source; do not reset, repair, or
   blanket-push migrations.
2. Re-run the sanitized ACL metadata query. Require all 36 expected public
   tables to remain `postgres`-owned and RLS-enabled; require the exact 204
   direct grants, 16 `postgres` defaults, 24 provider defaults, no unexpected
   PUBLIC/browser grants, and no new role memberships. Stop on drift.
3. The owner-provided fresh read-only inventory is 5 Auth users, 1 admin,
   5 customer profiles, 44 packages, and 6 payment configurations; orders,
   payment transactions, and refunds are zero. This batch did not reconnect
   to re-count them or export row contents.
4. After this migration-only PR is manually approved and merged, verify the
   exact trusted `main` source SHA and all mandatory exact-head CI. The
   protected database workflow must re-check project identity, migration
   ledger, table ownership/RLS, and ACL preconditions before applying only the
   supported migration. It must not include RF Coins pending SQL.
5. Apply only the supported `postgres`-owned ACL migration and verify its
   migration-ledger entry plus read-only ACL metadata after application.
6. The 24 `supabase_admin` defaults remain unresolved. Ask Supabase through
   its supported support channel or documented managed-database process for
   an authorized remediation path. Do not `SET ROLE`, add role membership, or
   attempt to change provider-owned ACLs from `postgres`.
7. Re-run metadata-only ACL assertions, customer/admin RLS and privileged-RPC
   security tests, checkout/order/payment regressions, and the full required
   exact-head CI. Funding/spending remains disabled regardless of migration
   success.

## Exact-SHA owner approval sequence

1. Manually review and merge only the migration-only PR after its exact-head
   frontend, database/security, migration-upgrade, and production-safety checks
   pass. Keep PR #82 DRAFT and PR #89 separate. This PR is opened as DRAFT and
   no auto-merge request is issued.
2. Record the exact resulting `main` merge SHA. On `main`, dispatch
   `runfazone-development-db.yml` with that SHA and
   `operation=metadata-acl-audit`; leave `apply_confirmation` empty. Review the
   sanitized artifact and require the audited baseline (204 direct entries,
   16 postgres defaults, 24 provider defaults, 36 postgres-owned RLS tables).
3. Only after a separate owner authorization, dispatch the same trusted
   main-only workflow from `main` using the same current main SHA,
   `operation=apply`, and `apply_confirmation=APPLY_DEVELOPMENT_MIGRATIONS`.
   The workflow requires exact-head CI, exact project identity, the canonical
   migration set and each SHA-256. The migration itself repeats atomic role,
   ownership, RLS, grant-provenance, and ACL-count checks before any revoke.
4. Confirm exactly the ACL migration is newly recorded and run a fresh
   metadata-only audit. Expected post-state: direct excessive entries `0`,
   postgres-owned defaults `0`, provider-owned defaults still `24`, RLS and
   application CRUD grants unchanged. Stop on any drift or extra migration.

The owner merge decision and hosted apply authorization are separate and both
remain pending. No workflow dispatch or hosted SQL change is part of this PR.

## Free-plan recovery and rollback

Supabase Free paid backups/PITR and production-style restore rehearsals are
not required. No paid resource, export, or manual snapshot was created in this
batch. Migration history is not a backup of rows. This ACL migration changes
privileges only and is transaction-wrapped; the inverse grants below provide
a scoped rollback. A manual recovery snapshot is recommended before
substantial or irreversible schema/data changes, but is not a prerequisite
for this ACL-only operation.

These ACL operations do not delete or update rows, so their direct rollback is
the exact inverse ACL change, after a fresh metadata check and only if the
current ACL matches the post-state:

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

- Current schema/migration metadata: last verified by run `40639888077` as
  above (100 hosted migration versions matched the 100-file reviewed manifest
  at that point).
- Current counts above are owner-provided fresh read-only evidence; no new count
  query was run by this batch.
- Hosted ACL changes, migrations, row writes, exports/restores, payments,
  supplier actions, email sends, Worker activation: **NONE** in this work.
- RF Coins schema remains pending. Wallet funding and spending remain
  disabled; PayMongo product checkout is separate and unchanged.
