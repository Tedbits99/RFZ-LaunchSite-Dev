# RF Coins Admin Center — hosted migration review package

Status: **HOLD — READ-ONLY PREFLIGHT FOUND A RELEASE-LOCK DEFECT; FIXED IN THE PR, BUT HOSTED CONTRACT/UPGRADED-REHEARSAL EVIDENCE IS INCOMPLETE. DO NOT APPLY.**

The RF Coins wallet tables and reporting RPCs were absent in fresh read-only
audit run `40623744044` against development project `ketdhcmwowzztcdlmris`.
The Admin Center therefore reports the feature as unavailable; it does not
substitute zeros for missing schema. This package is a review aid, not approval
to migrate or enable funding/spending.

## Canonical migration order

Apply only after reviewing the exact migration files in the approved PR head:

1. `supabase/migrations-pending/20261028120000_rf_coins_schema.sql` — tables,
   indexes, checks, append-only triggers, customer RLS, grants, a disabled
   `rf_coin_wallet` payment-config row (`ON CONFLICT DO NOTHING`), the nullable
   `payment_transactions.order_id` compatibility change, and the private
   fulfillment handoff queue. It creates (but does not schedule) a cron trigger
   function. It inserts no cron secret and schedules no job.
2. `supabase/migrations-pending/20261028120100_rf_coins_functions.sql` —
   authenticated identity-checked wallet/top-up/order functions, Super Admin
   adjustment/package/settings operations, service-role settlement and handoff
   functions, explicit execute grants, and hard-coded disabled release guards.
3. `supabase/migrations-pending/20261028120200_rf_coin_admin_center_read.sql` —
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

## Exact source and fresh hosted inventory

- Migration source reviewed: PR #82 code commit
  `01076dfbf59206c1ec6101584ddcd819fb9e931e` (based on owner-accepted Admin
  Center candidate `cc5687f45835c423860ae94c33cc640155f8e96b`). This source
  commit includes the release-lock correction described below.
- Hosted audit workflow: run `40623744044`, operation `audit`, terminal
  SUCCESS; source `main` SHA
  `7f72ba18a6e1641e0a6347895342e365d5a81fcb`; protected project identity
  `ketdhcmwowzztcdlmris`, region `ap-southeast-1`.
- Hosted migration history: 100 source versions and 100 remote versions;
  before/after migration lists matched. The current maximum executable
  migration version was `20261027110000`. No hosted migrations were applied.
- Sanitized metadata summary: 36 public tables; RLS enabled on 36/36; 136
  public policies; 40 public functions; 90 indexes; 7 non-internal triggers.
  No `rf_coin_%` public tables or functions were present. The `payment_transactions`
  relation had RLS enabled, FORCE RLS disabled, and one policy. These are
  metadata counts only; policy expressions, table grants, and data rows were
  not included.
- The workflow's `scheduled_jobs=0` value is not proof that there are no jobs:
  it counts the `cron.job` catalog relation, and returns zero if that relation
  is absent. The artifact did not inventory installed extensions, extension
  versions, actual cron rows, deployed Edge Functions, payment configuration
  values, or the definitions of triggers/policies.
- `supabase db dump --schema-only` ran on the protected runner, but its SQL dump
  was temporary and was not retained as an artifact. The uploaded artifact
  intentionally contained only sanitized counts and function ACL metadata.
  It did not expose `payment_transactions` columns, nullability, constraints,
  indexes, policy expressions, or grants. These hosted contract details remain
  **UNVERIFIED**; no row data or hosted data export was collected.

### Review findings and corrective change

**P1 found and fixed before any hosted apply:** the original pending migration
versions began `2026101816…`, which sorts before later already-deployed
migrations even though the documented plan was to apply the feature after the
current schema. Their version prefixes are now `20261028120000`, `20261028120100`,
and `20261028120200`, strictly after current executable version
`20261027110000`; a regression test compares the pending sequence with the
maximum executable version so a future migration cannot silently overtake it.

The SQL review also found that in the original pending
`rf_coin_set_settings` RPC, an active Super Admin could set `enabled`,
`topups_enabled`, and `spending_enabled` to `true` directly, bypassing the
application API release lock. The new PostgreSQL regression test reproduced
the direct authenticated RPC accepting those values before the fix. Commit
`69921e560a4d4e0420cdd8c052edfcfb80f7969c` makes the RPC reject any true
financial-release flag with `RF_COIN_RELEASE_LOCKED`; a test also verifies an
adjustment cannot be issued while the feature remains disabled and that the
settings remain false. This has only been tested in disposable PostgreSQL; it
is not hosted because the migrations have not been applied.

All SECURITY DEFINER functions in the two function migrations now pin
`search_path` to `pg_catalog, public, pg_temp` (catalog first, temporary schema
last), with contract coverage. The hosted `CREATE` privilege on `public` was
not included in the audit artifact, so do not infer that ACL from this change.

## Migration checksums

SHA-256 for the exact SQL files in source commit
`01076dfbf59206c1ec6101584ddcd819fb9e931e`:

| Order | File | SHA-256 |
|---|---|---|
| 1 | `supabase/migrations-pending/20261028120000_rf_coins_schema.sql` | `2e8ea07baa07ed7fb6ab766aed7e9983572ccf94e91ed0818aa9407ae2e871d3` |
| 2 | `supabase/migrations-pending/20261028120100_rf_coins_functions.sql` | `8dbc11a82062f0cd1ebdd77ba5500ebae7fca89fa75f2450b0eaec26635efcb8` |
| 3 | `supabase/migrations-pending/20261028120200_rf_coin_admin_center_read.sql` | `1bef2626e079781180336a13990088db6ab7d07af09b144b77508a9a2563d924` |

The same filenames and digests must be rechecked against the final PR head
before any later migration decision. The migration-version regression test
also verifies that all three pending versions sort after the active set.

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
3. No fresh hosted export was created in this preflight. Before an approved
   schema apply, use the protected database workflow to create a restricted
   export, validate non-empty artifact/checksum/retention, and restore only to
   an isolated disposable database. Verify schema/table counts and
   representative sanitized order/payment integrity there; never restore over
   the existing project. This step remains a pre-apply owner/release gate.
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

## Payment compatibility assessment

Source review found no product-checkout consumer that requires nullable order
IDs: the product QRPh creator and product webhook insert their real `order_id`,
and existing order-based reads continue to filter by that key. The staged RF
Coins top-up function instead inserts a `rf_coin_topup_id` without inventing
an order. The `payment_transactions.order_id` nullable change plus top-up FK is
therefore coherent with the repository's intended two record types. The
database migration adds a FK and index, while retaining the existing order
index. This is **source-contract compatibility only**, not hosted-schema
verification: current live column/nullability/constraint/index definitions
and the policy expression were absent from audit evidence. The exact hosted
columns and foreign keys must be inspected before approval. A mismatch or
unexpected partial object is a stop condition; do not use `IF NOT EXISTS` as
proof of shape.

The wallet-top-up Edge Function source is hard-disabled by a literal false
release constant and the application route is also release-locked. That source
does not prove whether any matching function is deployed. The read-only audit
did not inventory deployed Edge Functions or provider secrets, so deployed
payment/webhook and scheduled side-effect isolation remain **UNVERIFIED**.

## Disposable rehearsal evidence and limits

- The PGlite PostgreSQL behavior suite applied all three exact pending SQL
  files over a synthetic existing-schema fixture and passed the full SQL
  authorization/behavior tests.
- The independent PostgreSQL 16 multi-connection harness applied the same
  three SQL files over a disposable synthetic baseline (with outbound HTTP
  stubbed and no provider credentials). It passed: wallet init 20-way, top-up
  create/credit 16-way, order settlement 12-way, refund credit 8-way, refund
  reversal 12-way, and adjustment approval 12-way concurrency checks. The
  exercised zero wallet had one row and exactly 0 balance; synthetic ledgers
  remained non-negative and idempotent.
- These tests do not constitute a rehearsal against the exact current hosted
  schema or a full replay of all 100 current migrations. An attempt to start
  the local Supabase stack for that fuller rehearsal stopped before database
  initialization because Docker image pulls exhausted the execution host's
  root filesystem (83 MB free; Docker reported `no space left on device`). No
  Docker images/volumes were deleted because their ownership/use was not
  established. The full current-schema rehearsal remains **BLOCKED**.
- No actual hosted backup/export or hosted restore was performed. A protected
  sanitized export and disposable restore is still required before a later
  approved schema apply. No hosted migration, data write, payment, supplier,
  email, cron, or financial operation occurred in this preflight.
- Reporting RPC bounds (50-row pages, 90-day range, at most 1,000 export rows)
  and KPI/alert assertions are covered by code/tests, but query latency and
  index plans have not been benchmarked against production-scale synthetic
  volume; performance acceptance remains pending.

## Backup, restore, and incident-recovery readiness

**Status: NOT VERIFIED; no hosted row data was exported in this preflight.**
The successful `audit` run above captured migration history and sanitized
catalog metadata only. The separate `gate-b-audit` path invokes
`scripts/audit-hosted-integrations.sh`, which creates both a schema dump and a
`--data-only` dump of the hosted `public` schema in the protected runner's
temporary directory. That is a real hosted data export, even though the script
deletes its temporary files on exit. It was not run because this task does not
authorize a hosted data export. Do not treat the metadata audit as a backup or
restore test.

The checked-in disposable restore helper is only a partial smoke test: it
restores into a vanilla PostgreSQL container with minimal `auth` stubs, checks
that public tables exist, and compares row counts for six selected tables
(`games`, `packages`, `payment_config`, `customer_profiles`, `orders`, and
`payment_submissions`). It does not verify every table's row contents, fully
recreate the Supabase extension/Auth/Edge Function environment, or prove
application-level recovery. The full local Supabase replay was not completed
because the available Docker host ran out of disk during image pulls. Thus the
current helper and synthetic SQL tests are not sufficient evidence for
full-upgrade or restore readiness.

Before a separately authorized hosted apply, the recovery procedure must:

1. Verify the project identity, exact source SHA, migration checksums, and
   unchanged pre-apply migration ledger in the protected workflow.
2. Obtain a one-time owner-authorized backup/export or verify the project's
   actual provider backup/PITR capability and retention. Any row-bearing
   artifact must remain encrypted, restricted to the minimum named operators,
   excluded from logs and ordinary CI artifacts, checksum-verified, and given
   an explicit short retention/deletion deadline. Never place customer data in
   source control or a general-access artifact.
3. Restore only into an isolated disposable Supabase-compatible environment
   with external network calls disabled and no provider credentials. Compare
   the complete public table inventory and per-table row counts, validate the
   schema/constraints and representative synthetic or approved integrity
   checks, then verify cleanup of the disposable environment and its backup.
   Never restore over the existing development project.
4. If an apply stops part-way, do not reset, repair the migration ledger, or
   blindly rerun. Preserve sanitized logs, re-read the hosted ledger, identify
   exactly which files committed, and prepare a reviewed forward-fix while
   funding/spending remain locked. A rollback that drops wallet objects is
   prohibited once dependent or ledger data exists; any pre-data rollback
   requires a separate impact review and verified recovery point.
5. The owner remains responsible for authorizing the row-data export and the
   eventual apply, confirming the recovery point/retention, and deciding any
   incident response that could affect existing customer or order records.

These are future prerequisites, not actions performed here. No hosted export,
restore, migration, row change, payment, supplier action, or Worker activation
occurred in this preflight.

## Recommendation and owner boundary

**Current recommendation: NO-GO for hosted migration.** Before a future
decision, the protected audit must expose sanitized exact metadata for
`payment_transactions` columns/nullability/defaults/constraints/indexes and
effective grants/policy expressions; inventory extension names/versions,
actual scheduler jobs, deployed Edge Functions and relevant secret-presence
flags without values; confirm the hosted `public` schema ACL; and complete the
full current-schema disposable rehearsal plus protected backup/restore check.
Do not resolve these gaps by assuming the migration matches or by running
`plan`/`apply` against the hosted project.

After those independent checks pass and the exact source SHA/checksums are
reviewed, the next decision may be `READY_FOR_OWNER_MIGRATION_REVIEW`. That is
not migration approval. Any hosted apply remains a separate, explicit owner
decision through the protected workflow; funding, spending, provider calls,
supplier fulfillment, cron scheduling, and public release remain separately
disabled and gated.

## Separate release prerequisites

Applying schema does not authorize wallet funding, wallet spending, payments,
supplier fulfillment, email, or public launch. Those remain disabled until a
separate reviewed release establishes signed provider verification, exactly
once crediting, idempotent reversals/refunds, replay/race tests, reconciliation,
supplier/email isolation, hosted owner acceptance, and explicit financial
approval. Hosted Admin Center acceptance is also required after schema is
approved; local disposable tests are not a substitute.
