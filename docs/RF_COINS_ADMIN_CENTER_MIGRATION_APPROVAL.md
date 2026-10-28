# RF Coins Admin Center — hosted migration review package

Status: **PENDING OWNER REVIEW — DO NOT APPLY AS PART OF PR #82**

The RF Coins wallet tables and reporting RPCs are not present in the hosted
development database according to the latest supplied audit. The Admin Center
therefore reports the feature as unavailable; it does not substitute zeros for
missing schema. This package is a review aid, not approval to migrate or enable
funding/spending.

## Canonical migration order

Apply only after reviewing the exact migration files in the approved PR head:

1. `supabase/migrations-pending/20261018160000_rf_coins_schema.sql` — tables,
   indexes, checks, append-only triggers, customer RLS, grants, a disabled
   `rf_coin_wallet` payment-config row (`ON CONFLICT DO NOTHING`), the nullable
   `payment_transactions.order_id` compatibility change, and the private
   fulfillment handoff queue. It creates (but does not schedule) a cron trigger
   function. It inserts no cron secret and schedules no job.
2. `supabase/migrations-pending/20261018160100_rf_coins_functions.sql` —
   authenticated identity-checked wallet/top-up/order functions, Super Admin
   adjustment/package/settings operations, service-role settlement and handoff
   functions, explicit execute grants, and hard-coded disabled release guards.
3. `supabase/migrations-pending/20261018160200_rf_coin_admin_center_read.sql` —
   bounded, active-Super-Admin-only report and export-audit RPCs, indexes,
   derived exception reporting, and explicit RPC ACLs.

No hosted migration was applied in preparing this package. No live payment,
wallet credit, supplier order, customer email, or cron schedule was run.
The staged fulfillment trigger URL was corrected to the explicitly approved
project ref `ketdhcmwowzztcdlmris`; the former SQL referenced a different
project. A regression contract test pins this destination before any future
activation review. This source migration does not insert the handoff secret or
schedule the job; the current live cron/secret inventory was not re-audited in
this batch.

## Local security and behavior evidence

The disposable PostgreSQL 16 concurrency harness applies the staged migrations
to a local throwaway database and stubs network calls. It verifies customer
RLS, anonymous and ordinary-admin denial, Super Admin reporting, immutable
ledger/audit rows, approval separation, release locks, and concurrent wallet
initialization, top-up idempotency, order settlement, refund/reversal, and
manual adjustment approval. The zero-balance case creates a synthetic Auth
identity, calls the real initializer, confirms exactly one wallet row with
`balance_coins = 0`, confirms repeat initialization is idempotent, and verifies
that another customer sees no row. This is isolated evidence, not hosted
acceptance.

`RF_COINS_FUNDING_RELEASE_ENABLED` and
`RF_COINS_SPENDING_RELEASE_ENABLED` are source constants set to `false`. They
are not environment-controlled. The migration itself does not create a
scheduled job or insert a cron secret. The proposed report RPC is caller-JWT
scoped and independently calls the active `SUPER_ADMIN` assertion; financial
mutations remain RPC-only, never direct balance writes.

## Before any hosted apply

1. Confirm the target is the existing development project `ketdhcmwowzztcdlmris`
   using the protected `runfazone-development-db` workflow. Do not use PR code
   or a caller-selected project reference as the identity source.
2. Review the exact three SQL files and their checksums from the selected source
   commit. Confirm migration ordering and the hosted ledger has no conflicting
   version/name. Stop on any mismatch; do not use migration repair or reset.
3. Produce a protected project export with the approved database workflow and
   verify the artifact is non-empty, access-restricted, and retained according
   to the repository's secret/data retention policy. Restore that export only
   into an isolated disposable database, never over the existing project, and
   verify table counts plus representative order/payment records there.
4. Disable provider credentials/toggles in the isolated test harness and stub
   outbound HTTP. Do not schedule `trigger_fulfillment_handoff`; do not add a
   cron secret. Keep payment, fulfillment, and customer-email integrations
   untouched.
5. Apply in order using the protected workflow after explicit owner approval.
   Stop immediately on an error and preserve the full sanitized failure output
   and migration ledger. Do not mark a failed migration successful.

## Risk and recovery

The schema migration adds new RF Coins tables, policies, indexes, and a disabled
payment-config entry; it also drops `NOT NULL` from the existing
`payment_transactions.order_id` column and adds a nullable FK to top-ups. The
nullable change is backward-compatible for existing order rows, but it is a
shared payment-table change and deserves review against current constraints,
indexes, and consumers before application. `CREATE TABLE IF NOT EXISTS` does
not prove that a pre-existing object has the expected shape, so inspect object
definitions first.

These migrations are not safely reversible by blindly dropping tables: once
used, doing so would destroy wallet and immutable-ledger history. If an apply
fails, stop and inspect the exact transaction/ledger result. Prefer a reviewed
forward-fix while release locks remain off. If an applied schema must be
removed before any feature data exists, prepare a separate rollback script only
after proving zero dependent rows/functions/jobs and taking a fresh protected
export. Never run destructive rollback automatically.

## Post-migration read-only acceptance queries

Run through the protected audit workflow with values and row data sanitized:

```sql
-- Migration versions and expected RF Coins objects
select version, name
from supabase_migrations.schema_migrations
order by version;

select tablename, rowsecurity, forcerowsecurity
from pg_tables
where schemaname = 'public' and tablename like 'rf_coin_%'
order by tablename;

-- Browser roles must have no direct mutation grants; only expected read/RPC
-- privileges are allowed. Review every result, do not infer from RLS alone.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'rf_coin_%'
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

-- Customer RLS and function ACL inventory
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename like 'rf_coin_%'
order by tablename, policyname;

select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'rf_coin_%'
order by p.proname;

-- Safe defaults and no handoff secret
select enabled, topups_enabled, spending_enabled from public.rf_coin_settings where id = 1;
select count(*) as handoff_secrets from public._cron_secrets where key = 'fulfillment_handoff_secret';
```

If `pg_cron` is installed, separately inspect `cron.job` for any command that
calls `trigger_fulfillment_handoff`; the migration intentionally schedules
none. Do not create or enable a job during this acceptance.

Then, using disposable verified test identities only, verify a new wallet is
created exactly once at `0 RF`; its owner can read it; another customer and
anonymous caller cannot; ordinary admins cannot call financial reports or
mutations; active Super Admins can view the bounded console; direct table
writes fail; and no release toggle or RPC can enable funding/spending. Remove
only positively identified synthetic fixtures through the approved cleanup
procedure and verify their absence.

## Separate release prerequisites

Applying schema does not authorize wallet funding, wallet spending, payments,
supplier fulfillment, email, or public launch. Those remain disabled until a
separate reviewed release establishes signed provider verification, exactly
once crediting, idempotent reversals/refunds, replay/race tests, reconciliation,
supplier/email isolation, hosted owner acceptance, and explicit financial
approval. Hosted Admin Center acceptance is also required after schema is
approved; local disposable tests are not a substitute.
