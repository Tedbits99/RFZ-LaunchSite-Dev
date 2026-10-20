# Database and migrations

**Verified in source:** Supabase-compatible PostgreSQL, Auth-linked rows, RPCs, RLS, Realtime and Vault/cron dependencies. **Verified by authenticated read-only MCP:** project reference `ketdhcmwowzztcdlmris`, project URL, 13 public tables with RLS enabled, 11 recorded migrations, catalog-level constraints/indexes/routines/policies, extensions, branch status, and zero deployed Edge Functions. **Pending Verification:** organization ownership, region, plan/quota, backups, provider/Auth configuration, storage objects and the exact failed migration behind the `MIGRATIONS_FAILED` branch status. The existing backend must be preserved; no replacement was provisioned.

## Model and invariants

Core entities include games/packages/input fields; orders/timelines; payment configuration, submissions and transactions; vouchers/usages; suppliers/mappings/transactions/test runs; admins/customers/support; receipt outbox/email logs; RF Coins settings/wallets/ledger/top-ups/adjustments/handoffs. The complete lexical declaration inventory is [DATABASE_OBJECT_INVENTORY.md](transformation/DATABASE_OBJECT_INVENTORY.md). Source history is not the effective live schema.

- `create_order` and related RPCs compute prices/discounts from authoritative records using integer cents.
- Payment verification, terminal states and supplier claims must remain atomic/idempotent.
- Preserve order-specific payment and supplier mapping snapshots and voucher usage uniqueness.
- Browser anon credentials rely on effective RLS; service-role callers require explicit server authorization.
- SECURITY DEFINER functions require reviewed ownership, `search_path`, grants including `PUBLIC`, input validation and role behavior.
- RF Coins has append-only movement code and balance projections, but a balanced double-entry journal and live activation state are not proven. Do not enable spending or prepaid top-ups during this audit.

## Migration inventory and risks

The current tree has 115 active migration files, 2 pending SQL files and 13 archived SQL copies. See [active](../supabase/migrations/), [pending](../supabase/migrations-pending/) and [archive](../supabase/migrations-archive/) folders. The hosted ledger currently records only the first 11 active logical versions; 104 active files remain unrecorded candidates. Timestamp/suffixed duplicates and replacement functions require reconciliation with the actual applied ledger. Never rename or replay historical files merely to make a clean reset pass.

The 11 hosted versions are `20260927062024`, `20260927063133`,
`20260927064634`, `20260928042134`, `20260928051223`, `20260928055204`,
`20260928055236`, `20260928060956`, `20260928061342`, `20260928062007` and
`20260928062039`. Their logical names match the first 11 local migrations;
hosted checksums were not exposed, so exact content equality remains
unverified. Receipt/reconciliation, security-hardening, supplier and RF Coins
families are not present in the hosted migration ledger.

Live catalog evidence shows 48 public constraints, 30 public indexes, five
public routines (all `SECURITY DEFINER`), 13 public policies, no public views
or materialized views, no public triggers, and no Realtime publication
members. Security advisors identify policy gaps on `payment_submissions`,
`voucher_usages` and `vouchers`, and public execution of five legacy
`SECURITY DEFINER` routines. These findings are recorded only; this Phase 0
batch made no hosted changes.

The [isolated CI harness](../scripts/test-github-actions-database-security.sh) explicitly excludes four historical files: an outbound reconciliation scheduler, a table/policy ordering defect, an incompatible return-type replacement and a hardcoded game-ID insert. Later corrected copies remain in its filtered baseline. This proves neither full-history replayability nor the production schema. The [existing detailed guide](codebase-analysis/GITHUB_ACTIONS_DATABASE_TESTING.md) explains the exclusions; its old branch-trigger description is superseded by the current workflow.

The prior Phase 1 [archive permission migration](../supabase/migrations/20261019110000_restrict_order_archive_rpc.sql) is present but has not been applied to a hosted database by this session. A passing PGlite grant test is not production deployment evidence.

## Future safe change process — Requires Owner Approval

1. Confirm project ownership and acquire read-only schema/migration metadata. Reconcile extensions, roles, RLS, grants, triggers, indexes, RPC overloads and Realtime publications.
2. Establish a verified backup plus restore point and an approved maintenance/recovery plan. Record RPO/RTO targets with the owner.
3. Prepare a forward migration tied to a current-phase issue. Prefer additive, backward-compatible changes; analyze locks, backfills and application-version compatibility.
4. Test in an isolated disposable database using synthetic data. Run anon/customer/admin/service-role assertions, concurrency and failure tests, fresh and upgrade paths. Disable outbound jobs and real transport.
5. Review the exact SQL, rollback/forward-repair plan and compatibility with the previous app release. Obtain production change approval before applying anything hosted.
6. Record applied migration identity, verification and restore evidence without secrets or customer data. Do not use `db reset` or a generic rollback against production.

**Phase 0 executes no hosted writes and applies no migration.** Authenticated
MCP catalog queries and advisors were read-only. The `main` branch metadata is
`MIGRATIONS_FAILED` while its preview is `ACTIVE_HEALTHY`, but the available
branch and log APIs did not expose the failed version or exact failure message;
therefore no repair or replay is authorized. The first local SQL-harness
attempt lacked Supabase CLI/psql; after temporary tooling setup, its
outbound-migration guard rejected the RF Coins schema migration before DB
startup; see [validation evidence](transformation/VALIDATION_EVIDENCE.md).

## Backup and portability

Existing backup retention and restore capability are unknown. A logical schema/data export is not a complete service backup: Auth users/identities, storage objects, roles, extensions, Edge versions, scheduler definitions and secret/config metadata require separate handling. Database backups do not include Storage API object bytes according to [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups).

Prefer retaining an independently owner-controlled existing project. If legacy Bolt ownership prevents independent operation, investigate an owner-approved export/restore rehearsal before selecting a destination. Preserve user UUIDs and references; validate password/Auth identity portability and reauthentication requirements separately. Never copy production personal data into development. See [DATABASE_PORTABILITY.md](transformation/DATABASE_PORTABILITY.md), [maintenance](MAINTENANCE.md) and [deployment](DEPLOYMENT.md).
