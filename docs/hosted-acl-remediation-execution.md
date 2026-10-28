# Hosted ACL remediation: scoped application and recovery package

**Status: prepared, NOT applied.** This is a development-only operation for
Supabase project `ketdhcmwowzztcdlmris`. It is not a production release gate,
does not authorize a hosted SQL write, and does not change PR #82's DRAFT hold.

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
| Supported ACL migration | `supabase/migrations-pending/20261028113000_revoke_browser_table_ddl_privileges.sql` | `3e14097751cea54dbe0d7eece91275751484ab310a31bc48e9382f211e3c0ed4` | Hosted `postgres`; exact audited relation grants and its own two default contexts |
| Provider-owned default ACL operation | `supabase/migrations-pending-provider/20261028113100_revoke_supabase_admin_browser_defaults.sql` | `d9f9333a7efc1aced5ae73de802dec40337bd3fa4911f0a1f10492df06a34d1c` | Supabase-authorized `supabase_admin` context only; explicitly excluded from ordinary `db push` |
| Read-only row-count inventory query | `supabase/tests/hosted-development-row-count-inventory.sql` | `edcf24936bc516348cafb9db382e7eb1298c7ee950f549d635983fc10ecf1cbb` | Protected PostgreSQL session; output is relation names/counts only |

The migration does not alter SELECT/DML grants, RLS, policies, table contents,
`PUBLIC`, or `service_role`. It fails closed if the audited table ownership,
RLS, grant count/provenance, default-ACL counts, or PostgreSQL version no longer
match. It is retry-safe for the exact all-present or all-removed direct-ACL
states and rejects partial drift. The provider-only operation has a separate
authority precondition and does not touch current table grants.

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
3. Record relation row counts using the read-only query above. It uses a
   `READ ONLY` transaction, covers `auth.users` and the 36 audited public
   tables, and returns no UUID, email, order detail, payment payload, or other
   row contents. This query is prepared only; it has not been run in this
   session because no authorized live connection is mounted here.
4. In a separately authorized main workflow, apply only the supported
   `postgres`-owned ACL migration. Do not include pending RF Coins migrations
   in that operation. Confirm the supported migration was successful before
   considering provider-owned defaults.
5. Resolve the remaining 24 defaults through a Supabase-supported operation
   that has `supabase_admin` authority. The current `postgres` connection
   must not set role, add membership, or attempt the provider SQL. If the
   provider cannot expose an approved execution path, leave these defaults
   unchanged and record that portion as blocked; never broaden privileges to
   work around the restriction.
6. Re-run metadata-only ACL assertions, customer/admin RLS and privileged-RPC
   security tests, checkout/order/payment regressions, and the full required
   exact-head CI. Funding/spending remains disabled regardless of migration
   success.

## Free-plan recovery and rollback

Supabase Free paid backups/PITR and production-style restore rehearsals are
not required. No paid resource was created. No export or manual snapshot was
created in this batch. Migration history is not a backup of rows.

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

The provider-owned defaults require a separate inverse operation under the
same authorized `supabase_admin` context. Do not restore them merely to
reverse an unrelated schema change. Before any future destructive data/schema
operation, separately authorize a manual recovery snapshot to secure,
owner-controlled storage and verify its restore method; this is recommended
when practical, not a blanket Free-plan prerequisite.

## Data inventory status

- Current schema/migration metadata: last verified by run `40639888077` as
  above (100 hosted migration versions matched the 100-file reviewed manifest
  at that point).
- Current exact per-table and `auth.users` row counts: **NOT RUN / UNVERIFIED**.
- Hosted ACL changes, migrations, row writes, exports/restores, payments,
  supplier actions, email sends, Worker activation: **NONE** in this work.
- RF Coins schema remains pending. Wallet funding and spending remain
  disabled; PayMongo product checkout is separate and unchanged.
