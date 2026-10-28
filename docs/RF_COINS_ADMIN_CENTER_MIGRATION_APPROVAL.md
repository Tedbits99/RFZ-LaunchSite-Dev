# RF Coins Admin Center — hosted migration review package

Status: **PREPARED, NOT APPLIED — paid backup/PITR and a production-style restore rehearsal are not prerequisites for this unreleased Supabase Free development project. The remaining apply gates are trusted-main source/ledger verification and hosted authority for the audited default ACL owners.**

## Current owner policy — Supabase Free development

This section supersedes earlier backup, PITR, export, and restore requirements
in the historical review notes below. Do not upgrade the project or require a
paid backup feature to continue routine development. A manual recovery snapshot
is recommended when practical, but is not a mandatory gate for these additive,
forward-only development migrations. Migration history tracks schema versions;
it is not a backup of database rows. Do not export customer/order data merely
to satisfy a prior checklist.

The protected audit on main `b726746dfd42b0976188cb8e0c731e46cd97f092`
verified the existing project and ACL metadata; the hosted ledger matched 100
repository migration versions. The four proposed SQL files remain under
`supabase/migrations-pending/` on draft PR #82, not in the trusted main
migration source, so the main-only workflow cannot apply them yet. The exact
PR-head PostgreSQL 17 rehearsal and security/build CI passed, but do not
substitute for a hosted workflow `plan` or a matching hosted-ledger check.

Before considering a narrowly scoped development apply: verify the exact
trusted main SHA contains the reviewed files; confirm the hosted ledger and
schema still match the expected preconditions; verify the database execution
role can alter the five audited default-ACL contexts (a disposable runner
previously returned SQLSTATE `42501` for `supabase_admin`); run the protected
workflow plan and review its exact migration list; then use the protected
apply operation only for those reviewed files. Do not use reset or migration
repair. Existing data must be preserved. The RF Coins funding/spending release
constants remain false, and the migration does not enable payments, suppliers,
emails, or a Worker. No hosted change is authorized by this preparation note.

## 2026-10-28 hosted ACL follow-up — source-only, still NO-GO

The protected metadata-only ACL audit (`40639888077`, artifact
`hosted-acl-metadata.json`, SHA-256
`1c53092074c39e8330dd3287b61452678ae3c70fc1f8b58aa5f8482de10ee321`)
identified excessive `TRUNCATE`, `REFERENCES`, `TRIGGER`, and PostgreSQL 17
`MAINTAIN` grants to `anon` and `authenticated` on 24 public tables, plus the
same four grants to `authenticated` on `admins`, `order_timeline`, and `orders`.
It also identified those browser-role defaults in five audited creator/schema
contexts: `postgres/public`, `supabase_admin/public`, `supabase_admin/graphql`,
`supabase_admin/graphql_public`, and `postgres/storage`. The audit did not
report PUBLIC or `service_role` grants for those privileges. This finding is
not proof that the grants were exploitable through PostgREST; the migration is
limited to reducing the recorded ACL surface without changing RLS, policies,
or ordinary data privileges.

Staged migration candidate `supabase/migrations-pending/20261028113000_revoke_browser_table_ddl_privileges.sql`
has SHA-256 `596add41d9fbded5dd4370c0952d751506d2267cedaf7b17f93337c0d23b5d5f`.
It fails closed on missing execution authority, an unexpected PUBLIC grant,
missing audited object/role, disabled RLS, wrong PostgreSQL major version,
unexpected PUBLIC defaults, or global browser-role defaults that a
schema-scoped revoke could not cancel. It revokes only the four audited
privileges for the recorded role/table pairs and five scoped default ACLs. The
protected Development run `40643841253` attempted the migration using the
standard local Supabase `postgres` role and returned SQLSTATE `42501` on
`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin`; that role cannot modify
another role's defaults in this runner. The migration is therefore staged
outside `supabase/migrations/` and is not part of normal `db reset` or deployment
until an authorized execution context is verified. The disposable rehearsal
`supabase/tests/database/hosted-acl-remediation-rehearsal.sql` reconstructs
the audited grants in a transaction, applies the migration, and verifies
ordinary SELECT/DML grants, RLS and policies, PUBLIC/service-role ACLs,
unrelated default ACLs, and the `payment_transactions` access contract remain
unchanged. It must run in a dedicated disposable PostgreSQL 17 superuser
fixture, never against the hosted project; the transaction rolls back. This is
source/test preparation only:
the migration has **not** been applied to the hosted project, no ACL has been
changed, and the migration recommendation remains **NO-GO for apply** until
the trusted-main source/ledger preconditions and hosted execution authority for
all audited default-ACL owners are verified. Paid backup/PITR or a full restore
rehearsal is not a prerequisite under the current development policy. The
disposable PostgreSQL 17
rehearsal passed as recorded below; that isolated superuser result does not
prove the hosted migration role has authority over `supabase_admin` defaults.

The RF Coins wallet tables and reporting RPCs were absent in fresh read-only
audit run `40623744044` against development project `ketdhcmwowzztcdlmris`.
The Admin Center therefore reports the feature as unavailable; it does not
substitute zeros for missing schema. This package is a review aid, not approval
to migrate or enable funding/spending.

## Canonical migration order

Apply only after reviewing the exact migration files in the approved PR head:

1. `supabase/migrations-pending/20261028113000_revoke_browser_table_ddl_privileges.sql` —
   remove only the audited excess browser-role DDL privileges and matching
   default ACLs; fail closed if hosted authority or audit assumptions differ.
2. `supabase/migrations-pending/20261028120000_rf_coins_schema.sql` — tables,
   indexes, checks, append-only triggers, customer RLS, grants, a disabled
   `rf_coin_wallet` payment-config row (`ON CONFLICT DO NOTHING`), the nullable
   `payment_transactions.order_id` compatibility change, and the private
   fulfillment handoff queue. It creates no outbound dispatcher or cron job.
   The shared cron-secret table is created empty and inaccessible.
3. `supabase/migrations-pending/20261028120100_rf_coins_functions.sql` —
   authenticated identity-checked wallet/top-up/order functions, Super Admin
   adjustment/package/settings operations, service-role settlement and handoff
   functions, explicit execute grants, and hard-coded disabled release guards.
4. `supabase/migrations-pending/20261028120200_rf_coin_admin_center_read.sql` —
   bounded, active-Super-Admin-only report and export-audit RPCs, indexes,
   derived exception reporting, and explicit RPC ACLs.

No hosted migration was applied in preparing this package. No live payment,
wallet credit, supplier order, customer email, or cron schedule was run.
An earlier draft contained a SQL HTTP fulfillment trigger and a hard-coded
function URL. That dispatcher and URL were removed from the current pending
schema migration; regression tests now require no network URL, HTTP call, or
cron schedule in that migration. The queue and inert secret-store contract do
not dispatch work. No secret is inserted and no job is scheduled.

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
| 1 | `supabase/migrations-pending/20261028120000_rf_coins_schema.sql` | `ac535120b08f3f76ebf9ea986f51fa1df492730fc2dbf12fae17480c1c9852b6` |
| 2 | `supabase/migrations-pending/20261028120100_rf_coins_functions.sql` | `8dbc11a82062f0cd1ebdd77ba5500ebae7fca89fa75f2450b0eaec26635efcb8` |
| 3 | `supabase/migrations-pending/20261028120200_rf_coin_admin_center_read.sql` | `1bef2626e079781180336a13990088db6ab7d07af09b144b77508a9a2563d924` |

The first digest reflects the later SECURITY DEFINER search-path hardening
recorded in the 2026-10-28 review. The original digest belongs to historical
source commit `01076dfbf59206c1ec6101584ddcd819fb9e931e` and is superseded for
the current candidate.

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
2. Review the exact four SQL files and their checksums from the selected source
   commit. Confirm migration ordering and the hosted ledger has no conflicting
   version/name. Stop on any mismatch; do not use migration repair or reset.
3. A manual, appropriately restricted recovery snapshot is recommended when
   practical, but is not required for routine forward-only development changes
   on the Free plan. Do not create a row-bearing export or restore solely to
   satisfy superseded production-style backup requirements. Migration history
   is not a substitute for a data backup.
4. Keep provider credentials/toggles disabled in the isolated test harness
   and stub outbound HTTP. These migrations install no outbound handoff
   dispatcher or schedule; do not add a cron secret or activate fulfillment.
   Keep payment and customer-email integrations untouched.
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

If `pg_cron` is installed, inspect `cron.job` for relevant existing jobs; the
migrations intentionally install no dispatcher and schedule nothing. Do not
create or enable a job during this acceptance.

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
- No hosted backup/export or restore was performed. Under the current
  Supabase-Free development policy, a paid backup/PITR product or a
  production-style restore rehearsal is not a routine migration prerequisite.
  No hosted migration, data write, payment, supplier, email, cron, or financial
  operation occurred in this preflight.
- Reporting RPC bounds (50-row pages, 90-day range, at most 1,000 export rows)
  and KPI/alert assertions are covered by code/tests, but query latency and
  index plans have not been benchmarked against production-scale synthetic
  volume; performance acceptance remains pending.

## Recovery information (not a Free-plan development blocker)

The metadata audit captured schema and ACL metadata, not row data, and is not
a database backup. No hosted export or restore was performed. The separate
`gate-b-audit` operation can create a row-bearing data dump; do not run it just
to satisfy an obsolete backup gate. Any such export requires its own narrow
purpose, restricted handling, retention/deletion plan, and authorization.

For this unreleased development project, an isolated PostgreSQL 17 upgrade
rehearsal, exact migration checksums, a clean hosted-ledger precheck, preserved
existing identities/orders, transaction-safe forward-only SQL, and disabled
financial release locks are proportionate safeguards. A manual snapshot is
recommended if readily available. A paid backup plan, PITR, or full
production-style restore rehearsal is not mandatory. If a migration fails,
do not reset or repair history; retain sanitized logs, re-read the ledger, and
prepare a reviewed forward fix. Never drop wallet objects or existing customer
data as a rollback shortcut.

## Recommendation and owner boundary

**Current recommendation: NO-GO for hosted apply, not because of backup/PITR.**
Before a future decision, the protected workflow must verify the exact trusted
main migration source and hosted ledger, confirm execution authority over each
audited default-ACL owner, and review any newly detected schema mismatch. The
existing audit already captured sanitized metadata for
`payment_transactions` columns/nullability/defaults/constraints/indexes and
effective grants/policy expressions; it also recorded the extension inventory,
scheduler catalog availability, function metadata, and the hosted `public`
ACL. The exact PR-head disposable PostgreSQL 17 rehearsal passed. Do not
resolve the remaining source/authority gates by assuming they match.

After those checks pass and the exact source SHA/checksums are reviewed, a
protected `plan` may be run on the exact trusted main SHA. A plan is read-only
and does not authorize apply. The protected `apply` operation remains a
separate, explicitly scoped development action; funding, spending, provider calls,
supplier fulfillment, cron scheduling, and public release remain separately
disabled and gated.

## New ACL finding and compatibility review (2026-10-28)

**Evidence provenance:** The following live privilege and payment-schema facts
were supplied by the owner from a direct read-only inspection of development
project `ketdhcmwowzztcdlmris`. They are treated as current owner-provided
metadata, not as independently re-queried by this session. The protected
`audit` artifact from run `40623744044` does not include effective table ACLs,
grantors, role memberships, default ACLs, full constraints, or policy
expressions. No hosted data or schema was changed.

### Excessive database privileges

Owner-provided effective privilege counts: `anon` can TRUNCATE 24 of 36 public
tables, and `authenticated` can TRUNCATE 27 of 36. The same inspection reports
explicit TRUNCATE, TRIGGER, and REFERENCES grants to both roles on
`payment_transactions`; effective SELECT/INSERT/UPDATE/DELETE for those roles
on that relation are false at the inspected scope. RLS is enabled there and a
separate authenticated administrator SELECT policy exists; the policy does
not grant table access on its own. PostgreSQL TRUNCATE is not filtered by
row-level security.

Classification: **confirmed excessive-privilege / high-risk P1 hardening
finding; application exploitability is not demonstrated**. The effective
TRUNCATE privilege is sufficient to clear a table for any execution context
that can issue SQL as the affected role. It does not establish that the
PostgREST Data API exposes arbitrary SQL or that an existing application route
can invoke TRUNCATE. The hosted `rls_auto_enable()` function definition and
complete deployed function bodies were not in the sanitized artifact, so no
claim is made that every possible SQL execution path has been excluded.

The explicit grant on `payment_transactions` is consistent with a direct ACL
entry, but the grantor and whether an equivalent privilege is inherited from
PUBLIC or a role membership have not been independently observed. The
24/27-table counts do not identify all affected names or distinguish direct
grants, inherited grants, PUBLIC ACLs, or creator-specific default ACLs. A
source scan of the tracked executable migrations found no matching blanket
TRUNCATE grant or `ALTER DEFAULT PRIVILEGES` grant to `anon`/
`authenticated`; this source result does not identify which live mechanism
created the privileges.

Static application review found that product payment creation/webhook records
use their actual order IDs, wallet top-up reservations use
`rf_coin_topup_id` without manufacturing an order ID, and order payment,
refund, and reporting reads retain their order filters. The webhook and
payment Edge Functions use server-side Supabase clients. This is a source
review only; the deployed Edge Function inventory and live function bodies
were not independently re-read in this session. The temporary PostgreSQL test
fixture confirms that an explicit role TRUNCATE grant succeeds even with RLS
enabled and SELECT absent, while transaction rollback preserves the fixture
row. It demonstrates PostgreSQL semantics only, not hosted application
reachability.

A text scan of tracked executable migrations, application routes, libraries,
and Edge Function sources found no `TRUNCATE` statement or application route
that exposes arbitrary SQL; the migration matches were ACL revoke statements
and tests/comments. This reduces evidence for a direct source-level destructive
path but cannot rule out SQL injection, deployed code drift, or behavior in the
unavailable hosted `rls_auto_enable()` definition. The pending RF Coins schema
does revoke client mutation privileges on its own feature tables and revokes
all table privileges on the handoff queue, but it does not correct excessive
ACLs on the existing public tables. No live mitigation is implied.

**Hardening plan — not executed:** first collect the affected table names and
`pg_class.relacl`/`aclexplode` grantor-grantee entries, effective
`has_table_privilege` values, role memberships, PUBLIC privileges, and
`pg_default_acl` grouped by object creator. Then remove only the demonstrated
TRUNCATE/TRIGGER/REFERENCES paths for `anon` and `authenticated` from the exact
affected relations and correct only the implicated default ACLs. Preserve
owner/service-role privileges and required DML/RLS policies. Re-read effective
privileges after the change and run Data API, checkout, admin, and security
regressions. Do not apply a blanket live revoke until inheritance, default
ACL, and object-owner provenance are known. No GRANT/REVOKE was run on the
hosted database.

### Hosted payment table contract

Owner-provided current contract for `public.payment_transactions`:
`order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE`, unique
idempotency key, primary key, status check, provider-reference/order indexes,
RLS enabled, one authenticated admin SELECT policy; the reported effective
browser-role DML privileges are false. These exact definitions have not been
independently exported or queried by this session, and no row data was
accessed.

The pending migration only drops `NOT NULL` on `order_id`, adds nullable
`rf_coin_topup_id REFERENCES rf_coin_topups(id) ON DELETE SET NULL`, and adds
its index. It does not drop or replace the existing order FK, primary key,
idempotency uniqueness, status constraint, provider indexes, RLS, or policy.
The disposable test baseline now starts with the owner-reported NOT NULL
order-FK/status/index/RLS contract, then asserts the order cascade remains and
both order-linked and top-up-linked payment rows can coexist after the exact
pending migration. The full-canonical-upgrade CI path now applies all three
pending RF Coins migrations after the canonical current schema and runs
`rf-coins-current-schema-upgrade.sql`; that test requires all eight expected
RF Coins tables, enabled RLS, the preserved order FK and new top-up FK, disabled
release flags, no wallet payment method enabled, no handoff cron job/secret,
and restricted privileged RPC ACLs. This rehearsal is synthetic and is not
proof of hosted schema compatibility or compatibility with existing hosted
rows.

### Extension inventory and deferred fulfillment processing

The ACL metadata artifact records the extension inventory and reports no
`cron` or `net` schema. The pending schema migration installs no extension,
HTTP dispatcher, or scheduled job. It creates the durable handoff queue plus
an empty, RLS-protected `_cron_secrets` store with browser and service-role
table privileges revoked. The migration aborts if that table unexpectedly
already exists, preserving any existing credentials and policies for separate
review. No secret is inserted.

Queue processing and supplier/network dispatch are intentionally deferred to
a separately reviewed integration change after supplier isolation and
financial gates pass. Applying this schema cannot invoke `net.http_post`,
create a job, or contact a provider. Funding and spending release locks remain
literal false.

### Rehearsal, CI, and recovery evidence

The new source tests cover the reported payment-table shape, the RLS/TRUNCATE
semantic distinction, absence of `cron`/`net`, absence of an outbound
dispatcher, and the empty inaccessible secret store. The legacy-upgrade script
applies the three RF Coins schema/function/admin migrations after all
canonical migrations and runs the current-schema
assertion file. That assertion requires all eight wallet tables with RLS, the
preserved payment order FK and administrator-only SELECT policy, all three
existing payment indexes plus the new top-up index, the nullable top-up FK,
preservation of a synthetic product payment seeded before the RF Coins
migrations, disabled release flags, no wallet payment method, no handoff
job/secret, and restricted privileged RPC ACLs. After these edits, local unit
tests completed with 1,035 passed and 1 skipped; TypeScript and lint completed
with no errors (existing
lint warnings remain). The isolated PostgreSQL 16 concurrency harness passed
after a serial rerun, including wallet initialization (20), top-up
creation/credit (16 each), order settlement (12), refund credit/reversal
(8/12), and adjustment approval (12). Its initial attempt during parallel
test startup failed to connect to a not-yet-ready PostgreSQL socket; the serial
rerun reached terminal PASS. Exact-candidate CI for source SHA
`0a5ccfc083b300405742b4f50b93bdd331cb6260` completed successfully:
Frontend run `40630894509` passed unit tests, TypeScript, lint, Next.js,
OpenNext, and compiled Tailwind checks; Development run `40630894561` passed
application tests, PostgreSQL concurrency, isolated database/RLS security,
the 89-file canonical migration selection and application, the three pending
RF Coins migrations, and the current-schema assertions. The rehearsal seeded a
synthetic product order/payment before the pending migrations and emitted
`RF_COINS_FULL_CURRENT_SCHEMA_UPGRADE_PASS`, including preservation of that
payment, the original order FK, RLS/admin policy and indexes, disabled release
locks, and absent handoff job/secret. Production-release-safety run
`40630894561` also passed. An earlier run on `e00efbfc` failed because that
synthetic order omitted the required guest-order capability hash; the fixture
was corrected on `0a5ccfc` and the exact-head rerun passed. This synthetic
rehearsal is not a restored copy of the hosted database and cannot prove live
ACL provenance or hosted-row compatibility.

No provider backup/PITR metadata or row-data export was collected. This is
recorded as recovery metadata **UNVERIFIED**, not as a blocker under the current
Supabase-Free development policy. Paid backup/PITR and a full restore rehearsal
are not prerequisites for routine reversible development migrations. Prefer
transaction-safe forward-only SQL; a manual snapshot is recommended when
practical. No hosted migration has been applied.

### PostgreSQL 17 ACL rehearsal update (2026-10-28)

The pending RF Coins schema now explicitly revokes all table privileges from
`PUBLIC`, `anon`, and `authenticated` on the seven intended read surfaces,
then restores only `SELECT`. The internal fulfillment queue remains fully
revoked from browser and service roles. The newly created `_cron_secrets`
table now explicitly revokes all privileges from `PUBLIC`, both browser roles,
and `service_role`, so project default ACLs cannot silently expose it. These
are changes to the pending source migration only; **nothing was applied to the
hosted project**.

The disposable security harness pins its local Supabase database to
PostgreSQL 17. Its existing-schema rehearsal installs a temporary,
postgres-owned default ACL granting all table privileges to `anon` and
`authenticated`, confirms the fixture probe receives `MAINTAIN` and the other
PostgreSQL 17 table privileges, removes the probe, applies the exact pending
RF Coins migrations, then checks effective privileges on all eight feature
tables and `_cron_secrets`. Expected read grants remain limited to the seven
documented SELECT surfaces. Browser INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
TRIGGER/MAINTAIN are denied; the handoff queue and cron-secret table have no
browser SELECT, and neither internal table is directly available to
`service_role`. This only models the owner-reported default-ACL condition in a
disposable database; it does not independently reproduce live ACL provenance
or establish the full scope of hosted excessive grants.

The owner-provided 36-table privilege counts, `postgres` grantor, and
`pg_default_acl` observations remain provenance-labeled owner evidence. The
existing trusted GitHub metadata artifact does not contain `relacl`,
`aclexplode()`, role inheritance, or default-ACL rows, and no authorized live
connection was available to this session. No hosted grants or defaults were
changed. The broader exact-table hardening plan therefore remains a separate
reviewed operation; do not infer an application/API exploit from the ACL
metadata alone.

The migration script also requires the disposable PostgreSQL 17 rehearsal to
pass on exact PR HEAD. This is not a substitute for a live hosted audit. No
export or restore was performed, and the hosted RF Coins migrations remain
pending. Under the current Free-plan policy, the lack of paid recovery features
does not determine the migration recommendation.

## Separate release prerequisites

Applying schema does not authorize wallet funding, wallet spending, payments,
supplier fulfillment, email, or public launch. Those remain disabled until a
separate reviewed release establishes signed provider verification, exactly
once crediting, idempotent reversals/refunds, replay/race tests, reconciliation,
supplier/email isolation, hosted owner acceptance, and explicit financial
approval. Hosted Admin Center acceptance is also required after schema is
approved; local disposable tests are not a substitute.

## Trusted ACL audit and recovery evidence status (2026-10-28)

This is an append-only status update. Earlier audit counts and checksums above
remain historical evidence for their stated source/run and are not silently
replaced.

### Current candidate and exact-head validation

- PR #82 source SHA: `220de8744e069f0670a42aebfab3a807e8421a42`; PR remains
  OPEN/DRAFT and unmerged, based on main SHA
  `7f72ba18a6e1641e0a6347895342e365d5a81fcb`.
- Frontend validation run `40633394678`: terminal SUCCESS on the exact source
  SHA.
- Development validation run `40633394635`: terminal SUCCESS on the exact
  source SHA. Its `Isolated Supabase RPC security tests` and `Production
  release safety` jobs both completed SUCCESS.
- The Development logs include
  `RF_COINS_POSTGRES17_DEFAULT_ACL_FIXTURE_PASS` and
  `RF_COINS_FULL_CURRENT_SCHEMA_UPGRADE_PASS pg=17`, with browser write,
  TRUNCATE, TRIGGER, REFERENCES, and MAINTAIN denied on the candidate wallet
  surfaces; existing product-payment/order-FK/RLS/index contracts preserved;
  and release locks, handoff job, and handoff secret remaining disabled/absent.
  This is a disposable PostgreSQL 17 rehearsal, not a hosted ACL audit or
  hosted migration.

### Current migration checksums

These SHA-256 values were recalculated from the three pending migration files
at PR #82 SHA `220de8744e069f0670a42aebfab3a807e8421a42`. They supersede the
earlier table only for this candidate; the prior table remains historical.

| Order | File | SHA-256 at `220de874` |
|---|---|---|
| 1 | `supabase/migrations-pending/20261028120000_rf_coins_schema.sql` | `b217e2715eece27bb2cf781e55a132c68d1d218e383c3378d0b0e777afb8eb25` |
| 2 | `supabase/migrations-pending/20261028120100_rf_coins_functions.sql` | `8dbc11a82062f0cd1ebdd77ba5500ebae7fca89fa75f2450b0eaec26635efcb8` |
| 3 | `supabase/migrations-pending/20261028120200_rf_coin_admin_center_read.sql` | `1bef2626e079781180336a13990088db6ab7d07af09b144b77508a9a2563d924` |

The checksums must be recalculated again for any later candidate before a
migration decision.

### Trusted hosted ACL audit: pending review; no hosted run

The separate infrastructure-only change is PR #88, source commit
`9914d0c` (`codex/trusted-acl-metadata-audit`), based on the same verified
main SHA above. It adds a distinct main-only, manual `metadata-acl-audit`
operation to the existing protected database workflow and a bounded,
SELECT-only catalog artifact. It is not merged; its mandatory GitHub checks
are pending at the time of this update. No hosted audit was dispatched, no
artifact exists, no ACL was changed, and no hosted migration was applied.

Accordingly, the owner-provided current findings remain provenance-labeled
but are not independently artifact-verified in this session: 36 public tables;
`anon` TRUNCATE/TRIGGER privileges on 24 tables; `authenticated`
TRUNCATE/TRIGGER privileges on 27 tables; direct `payment_transactions`
TRUNCATE/TRIGGER/REFERENCES/MAINTAIN grants to both roles with grantor
`postgres`; and future-table default ACL grants attributed to `postgres` and
`supabase_admin`. The owner reported no direct role-membership entries for
`anon`/`authenticated` in their inspected query. This candidate does not claim
that a public/PostgREST route can execute those SQL privileges; application
exploitability remains **NOT ESTABLISHED**.

### ACL remediation plan — not executed

After the trusted artifact identifies exact relations and grant/default-ACL
provenance, prepare a separately reviewed, idempotent migration for only the
demonstrated `anon`/`authenticated` TRUNCATE, TRIGGER, REFERENCES, and MAINTAIN
privileges on affected relations. Correct only the specific creator/schema
default ACL entries shown to reintroduce those grants. Preserve owner and
service-role privileges, required browser DML/RLS behavior, and the existing
administrator SELECT path. Verify effective privileges and ACL provenance
afterward, then run customer isolation, payment/order, admin, and privileged
RPC regressions. Do not generate blanket revokes or execute this plan before
the artifact and compatibility review. **No hosted ACL remediation has been
applied.**

### Provider recovery metadata (not a Free-plan gate)

The metadata audit did not collect provider backup/PITR settings, and no
row-data export or restore was performed. This remains **UNVERIFIED** and is
not a requirement to purchase a plan or perform a production-style restore
rehearsal for this unreleased Free-plan development database. A manual snapshot
is recommended when readily available. Before an irreversible change, inspect
the exact affected data and choose a proportionate recovery method; do not
reset or overwrite this project.

### Owner acceptance history and release decision

The owner-reported `28/28 PASS` remains preserved as historical,
candidate-bound acceptance: 13/13 authentication/account checks on
`33824059569886944e4c8ac98eca22f425a1526a`, 8/8 wallet-header checks on
`259467d31d0b6fb56d7ed711a35f41fb37580c1a`, and 7/7 Admin Center checks on
`cc5687f45835c423860ae94c33cc640155f8e96b`. It is not acceptance of later
source SHA `220de8744e069f0670a42aebfab3a807e8421a42` or of a hosted wallet
schema.

**Decision at this historical checkpoint: NO-GO.** The hosted schema/ACL
changes had not been applied, and wallet funding/spending remained
unapplied/disabled. Backup/PITR evidence was not collected, but is not required
by the current Free-plan development policy. No hosted data export, backup,
restore, payment, supplier activity, or Worker activation occurred.

## Supplemental trusted-audit and main-line status (2026-10-28)

This section supersedes earlier statements about PR #88 and the current main
SHA only from the timestamped evidence below. Earlier run results and hashes
remain historical and candidate-bound.

### Infrastructure workflow and CI

- PR #88 source commit `873af01ab81a14a986cad6ff661ec4a44baa480d` passed
  Frontend validation run `40636301347` and Development validation run
  `40636301329`; both runs have terminal SUCCESS on that exact SHA. The
  Development run emitted
  `HOSTED_ACL_METADATA_POSTGRES17_FIXTURE_PASS tables=36 sections=9` in both
  the isolated database-security and legacy-upgrade steps. This verifies the
  query/validator against a disposable PostgreSQL 17 fixture only; it is not
  hosted-project evidence.
- The PR #88 change was subsequently merged by `github-actions[bot]` through
  the pre-existing `Trusted Codex auto-merge` workflow. Workflow run
  `40636873664` completed SUCCESS; merge commit/current main is
  `b726746dfd42b0976188cb8e0c731e46cd97f092`. The PR had no recorded review.
  The workflow's verifier accepted the repository rule set with zero required
  approvals and then requested native auto-merge. No hosted metadata audit was
  dispatched as part of that merge. This is recorded as an automation event,
  not as owner review or approval of hosted execution.
- The exact merged-main SHA passed Frontend validation run `40637177407` and
  Development validation run `40637180208`, both terminal SUCCESS. The
  Development run's `Production release safety`, isolated Supabase RPC
  security, and legacy-to-current upgrade jobs all completed SUCCESS.
- The protected `runfazone-development-db` environment's persisted deployment
  branch policy was read back: selected branches, exactly one allowed branch,
  `main`. No hosted database operation was launched.
- The three pending RF Coins migration files were re-hashed from the PR #82
  tree at `6f145b0094752697ee04b222932643528a036ba7`; they match the earlier
  recorded values. The following evidence-only commit does not alter those
  SQL files:

  | File | SHA-256 |
  |---|---|
  | `supabase/migrations-pending/20261028120000_rf_coins_schema.sql` | `b217e2715eece27bb2cf781e55a132c68d1d218e383c3378d0b0e777afb8eb25` |
  | `supabase/migrations-pending/20261028120100_rf_coins_functions.sql` | `8dbc11a82062f0cd1ebdd77ba5500ebae7fca89fa75f2450b0eaec26635efcb8` |
  | `supabase/migrations-pending/20261028120200_rf_coin_admin_center_read.sql` | `1bef2626e079781180336a13990088db6ab7d07af09b144b77508a9a2563d924` |
- Before this supplemental document-only update, PR #82 was OPEN/DRAFT at
  `1f81165151b8b22065d97af13faa3485dba640d9` and reported
  `CONFLICTING` against main. A read-only merge-tree comparison identifies one
  content conflict in `scripts/test-github-actions-database-security.sh`,
  where PR #82 and PR #88 independently added harness changes. The conflict
  has not been resolved or pushed in this update.

### Hosted ACL audit remains unverified

The trusted `metadata-acl-audit` operation is now present on main, but there
is still no run, artifact, or fresh hosted catalog capture after the merge.
Accordingly, the 36-table counts, effective privilege counts, direct grantors,
default ACL grantors, and role-inheritance observations above remain
owner-provided evidence only. Exact affected relations and post-default-ACL
provenance are not yet independently verified. Public SQL/PostgREST
exploitability remains **NOT ESTABLISHED**. No ACL remediation is prepared at
relation-level precision and no hosted ACL was changed.

The current request requires approval before hosted execution; therefore no
`metadata-acl-audit` dispatch was made. Before a future run, the owner must
review the PR #88 merge/automation event and explicitly authorize a read-only
dispatch from `main` using the new `metadata-acl-audit` operation. The run
must use the fixed project reference, produce its bounded metadata-only
artifact, and be checked for successful completion and unchanged migration
history. This does not authorize `plan`, `apply`, migration, or ACL writes.

### Provider recovery metadata (historical; not a Free-plan blocker)

No provider backup/PITR metadata was obtained, and no export or restore was
attempted. This is not a mandatory gate for this unreleased Free-plan
development project. A manual recovery snapshot is recommended when practical;
before an irreversible operation, choose a proportionate method based on the
specific affected data. Never restore over the existing project.

### Current decision

At that historical checkpoint, the PostgreSQL 17 rehearsal and exact-main CI
were verified PASS, while ACL provenance still needed a trusted hosted audit.
Backup/PITR and isolated restore metadata were not collected; they are not
mandatory Free-plan development gates. The migration recommendation was
**NO-GO** because hosted compatibility/authority remained unresolved. Hosted
data export, migrations, ACL changes, wallet funding/spending,
payment/supplier activity, and Worker activation remained **NONE / DISABLED**.

## Authorized hosted ACL metadata audit result (2026-10-28)

This is the terminal result of the explicitly authorized read-only audit. It
supersedes the owner-provided ACL counts above, but does not authorize a
remediation or migration.

- Workflow run `40639888077` completed **SUCCESS** on exact trusted main SHA
  `b726746dfd42b0976188cb8e0c731e46cd97f092`, project
  `ketdhcmwowzztcdlmris`, captured at `2026-10-28T05:46:39Z`. PostgreSQL
  authentication (`SELECT 1`), project identity, exact-head CI, source scan,
  metadata query, and before/after migration-history comparison passed.
- Sanitized artifact: `runfazone-development-db-40639888077`,
  `hosted-acl-metadata.json` (210,907 bytes, SHA-256
  `1c53092074c39e8330dd3287b61452678ae3c70fc1f8b58aa5f8482de10ee321`).
  [Run and artifact](https://github.com/Tedbits99/RFZ-LaunchSite-Dev/actions/runs/40639888077).
  Artifact declares `data_rows_exported: false`; no customer or transaction
  rows were exported. Migration history before/after is byte-identical: 100
  hosted migration records; source scan found 100 files matching the reviewed
  manifest. No migrations were applied. All non-selected workflow operations,
  including plan/apply, were skipped.
- Database metadata: PostgreSQL 17.11, 36 public tables, all 36 with RLS
  enabled; `customer_confirmation_resend_reservations` is the only table with
  FORCE RLS. Required Supabase roles were present. Direct browser-role
  membership paths were empty.

### Verified excess table privileges

The audit confirms effective `TRUNCATE`, `TRIGGER`, `REFERENCES`, and
`MAINTAIN` on every table listed below. Each listed role/table has all four
privileges; the corresponding direct ACL entries are granted by `postgres`
and are not grantable onward.

- `anon` (24 tables): `announcements`, `app_settings`, `email_sent_log`,
  `game_input_fields`, `games`, `global_announcement`, `notifications`,
  `order_notes`, `packages`, `payment_config`, `payment_submissions`,
  `payment_transactions`, `player_cache`, `promotions`, `refunds`,
  `supplier_package_mappings`, `supplier_test_runs`, `suppliers`,
  `support_messages`, `support_tickets`, `verification_attempts`,
  `verified_users`, `voucher_usages`, `vouchers`.
- `authenticated` (27 tables): all 24 above, plus `admins`, `order_timeline`,
  and `orders`.
- No direct `PUBLIC` grant for those four privileges was found. These are
  SQL-level grants; this artifact alone does **not** establish that a public
  PostgREST route can invoke them or that data was exposed/deleted.

### Future default ACL provenance

The audit found the same four default table privileges for `anon` and
`authenticated` in these creator/schema contexts:

| Creator | Schema | Direct creator/grantor |
|---|---|---|
| `postgres` | `public` | `postgres` |
| `supabase_admin` | `public` | `supabase_admin` |
| `supabase_admin` | `graphql` | `supabase_admin` |
| `supabase_admin` | `graphql_public` | `supabase_admin` |
| `postgres` | `storage` | `postgres` |

Other captured defaults in `auth`, `extensions`, and `realtime` target
`postgres`/`dashboard_user`, not the browser roles for these four privileges;
those entries are outside the proposed browser-role cleanup and must not be
changed by it. `service_role` defaults are likewise preserved. The precise
default ACL inventory is in the artifact.

### Payment, function, and wallet metadata

- `payment_transactions` is owned by `postgres`, has RLS enabled but not
  forced, and has the `admin_select_payment_transactions` SELECT policy for
  `authenticated`. The captured effective table privileges show neither
  `anon` nor `authenticated` has table-level SELECT/DML; both have the four
  excess privileges above. A policy does not itself grant SELECT. Do not add a
  grant blindly: verify the intended admin read path (for example, a guarded
  server API) and preserve payment/order behavior before any separate ACL
  migration. Captured constraints include primary key, unique idempotency key,
  `order_id` FK with `ON DELETE CASCADE`, and the payment-status check.
- The report contains 40 public function signatures; 39 are `SECURITY
  DEFINER`. It omits function bodies. `claim_first_admin()` has EXECUTE false
  for `anon`, `authenticated`, and `service_role`. `create_order()` and one
  `submit_payment()` overload have anonymous EXECUTE. These metadata facts do
  not substitute for behavioral RPC authorization tests; no exploitability
  conclusion is made here.
- No RF Coins tables/functions were deployed. The `cron.job` relation was
  absent, so this audit found no `pg_cron` scheduled-job inventory to report.

### Separately reviewable remediation proposal — NOT EXECUTED

Prepare a transaction-scoped migration that revokes only
`TRUNCATE, TRIGGER, REFERENCES, MAINTAIN` from `anon` and `authenticated` on
the exact 27 affected tables above, and revokes only those four default table
privileges from those two browser roles for the five creator/schema pairs in
the table above. Do not revoke SELECT/INSERT/UPDATE/DELETE, alter RLS, touch
`PUBLIC`, `service_role`, or the internal `auth`/`extensions`/`realtime`
defaults. Capture before/after privilege and policy metadata and assert that
SELECT/DML grants and RLS configuration remain unchanged. Test the migration
on disposable PostgreSQL 17 with the captured default-ACL fixtures, then run
checkout, customer isolation, admin, payment/order, and privileged-RPC
behavioral regressions before a separate review and explicit apply
authorization. This proposal has **not** been applied to the hosted project.

### Recovery and historical gate

The ACL artifact does not include provider backup/PITR metadata and provides
no restore evidence. This is **UNVERIFIED**, not a Free-plan blocker. The
hosted migration recommendation remained **NO-GO** pending source/ledger and
execution-authority checks. The test-harness conflict with current main was resolved at merge commit
`67c5a5ae155708c400e228835f65904252d52d9b`, preserving both the hosted ACL
metadata audit tests and RF Coins PostgreSQL 17 fixtures. PR #82 remains
OPEN/DRAFT and unmerged.

### Latest source-only verification (2026-10-28)

- Exact PR #82 source head `f99763e26599bd0672efe0ab95f24d52c9bdb746` passed
  Frontend run `40645458108` and Development run `40645458010`. The latter
  emitted `HOSTED_ACL_REMEDIATION_POSTGRES17_REHEARSAL_PASS` and
  `RF_COINS_FULL_CURRENT_SCHEMA_UPGRADE_PASS`; it used disposable databases
  only. No hosted migrations or ACL changes were made.
- The migration safety job previously printed `rg: command not found` while
  returning success. The verifier now uses an explicit fail-closed grep scan
  and self-tests clean SQL, detected external operations, a missing scanner,
  and scanner execution failure. The exact-head release-safety check emitted
  `DEPLOYABLE_MIGRATION_SAFETY_SCANNER_SELF_TEST_PASS` and
  `DEPLOYABLE_MIGRATION_MANIFEST_PASS count=100`.
- The ACL candidate remains only at
  `supabase/migrations-pending/20261028113000_revoke_browser_table_ddl_privileges.sql`;
  it is excluded from the active migration sequence and normal `db reset`.
  The disposable PG17 superuser rehearsal does not prove that the hosted
  migration role can alter `supabase_admin` defaults. A prior standard local
  Supabase run returned SQLSTATE `42501` for that operation, so hosted role
  authority still must be verified before any separately authorized apply.
- Provider backup/PITR metadata and isolated restore evidence remain
  **UNVERIFIED**, but are not prerequisites under the current Supabase Free
  development policy. `MIGRATION_RECOMMENDATION=NO-GO` remains for source and
  hosted execution-authority reasons; no hosted export, restore, ACL change,
  or migration has been performed.

## Current Supabase Free development status (2026-10-28)

This entry is the current policy/status summary and supersedes any older
checklist in this historical evidence file that demanded paid backup/PITR or a
production-style restore rehearsal. Runfazone is unreleased and the existing
Supabase project is on Free. A manual snapshot is recommended when practical,
but is not a gate for these reviewed development migrations. Migration
history is schema-version evidence, not a backup of database rows.

### Verified current baseline

- Target project: `ketdhcmwowzztcdlmris`.
- Trusted main at the last metadata audit: `b726746dfd42b0976188cb8e0c731e46cd97f092`.
- Read-only hosted ACL audit: workflow `40639888077`, terminal SUCCESS, exact
  main SHA above. It verified 100 hosted migration versions matched 100
  repository versions, PostgreSQL 17.11, 36 public tables with RLS enabled,
  and the recorded ACL metadata. No hosted migration or ACL change occurred.
- No `rf_coin_%` hosted tables/functions appeared in that audit. Its bounded
  metadata does not constitute a current row-data backup or full function-body
  review. `cron.job` was absent; no job inventory was inferred from a zero
  count when the catalog relation was absent.
- The audit recorded the four excess browser-role table privileges and five
  specific default-ACL contexts. The proposed ACL migration intentionally
  fails closed unless the expected owner roles and execution authority are
  present. A disposable run previously returned SQLSTATE `42501` when the
  standard `postgres` role attempted to alter `supabase_admin` defaults. That
  hosted execution authority remains **UNVERIFIED** and must be resolved by a
  protected plan before apply.

### Prepared migration set — not applied

The exact reviewed order is:

1. `20261028113000_revoke_browser_table_ddl_privileges.sql` — revoke only the
   audited `TRUNCATE`, `REFERENCES`, `TRIGGER`, and `MAINTAIN` grants/defaults;
   preserve SELECT/DML, RLS, PUBLIC, and `service_role`.
2. `20261028120000_rf_coins_schema.sql` — additive wallet/ledger/config tables,
   RLS/grants, disabled payment-config row, nullable payment compatibility
   column, and durable handoff queue. No outbound dispatcher or schedule.
3. `20261028120100_rf_coins_functions.sql` — identity-checked and
   role-restricted wallet/order/admin RPCs; literal funding and spending
   release locks remain false.
4. `20261028120200_rf_coin_admin_center_read.sql` — bounded Super-Admin report
   and audit RPCs.

Current SHA-256 values (recompute against the final selected source before any
plan/apply):

| File | SHA-256 |
|---|---|
| `20261028113000_revoke_browser_table_ddl_privileges.sql` | `596add41d9fbded5dd4370c0952d751506d2267cedaf7b17f93337c0d23b5d5f` |
| `20261028120000_rf_coins_schema.sql` | `cc84905de9578f550131532256d12d28812af5182fa49c9ece76a7d09e207b37` |
| `20261028120100_rf_coins_functions.sql` | `8dbc11a82062f0cd1ebdd77ba5500ebae7fca89fa75f2450b0eaec26635efcb8` |
| `20261028120200_rf_coin_admin_center_read.sql` | `1bef2626e079781180336a13990088db6ab7d07af09b144b77508a9a2563d924` |

The pending schema now defaults top-up provider metadata to `disabled` and
permits only the future direct owner e-wallet/crypto provider identifiers;
PayMongo is excluded from RF Coins funding and remains reserved for direct
product checkout. The legacy PayMongo wallet-funding Edge Function is still
source-locked off. Funding and spending remain unavailable even if settings
are manipulated, because the RPC release guards are literal false. The
regression test rejects a PayMongo-tagged RF Coins top-up row. No top-up
endpoint can create a provider transaction while the source release lock is
false.

The database-security runner now scans all four pending SQL files before its
disposable upgrade checks. It fails closed if `grep` is missing, if a scanner
execution fails, or if any pending SQL contains the guarded outbound HTTP or
scheduler patterns. The current run of the scanner-only entry point emitted
`PENDING_MIGRATION_SAFETY_PASS count=4`.

### Decision and controlled next step

No hosted changes were made: no migration, ACL update, row write, export,
payment, supplier fulfillment, email, cron schedule, or Worker activation.
No paid backup feature or full restore rehearsal is required. The migration
set is prepared but **NOT READY FOR APPLY** because these files remain pending
on draft PR #82 rather than in the protected main workflow's source, and the
hosted executor's ability to alter `supabase_admin` default ACLs has not been
verified. Keep the set pending until those checks are resolved. Once the exact
reviewed files are present on trusted main, run the protected `plan` operation
against the expected project, inspect the exact migration list and SQL hashes,
and stop on any ledger/schema/authority mismatch. Any later `apply` requires
its separately scoped authorization; do not run `db reset` or migration
repair. Wallet funding/spending, PayMongo wallet top-ups, supplier fulfillment,
live payment, public access, and normal Worker activation remain disabled.

## Latest ACL authority split and Free-plan handoff (2026-10-28)

This section supersedes the earlier single-file proposal above that attempted
to change all five default-ACL contexts through the standard hosted
`postgres` role. The metadata audit found all 36 public tables owned by
`postgres`, and the owner confirmed the hosted role is not superuser, has no
`supabase_admin` membership, and cannot `SET ROLE` to it. No permission
escalation is attempted.

- Supported, transaction-wrapped pending migration:
  `supabase/migrations-pending/20261028113000_revoke_browser_table_ddl_privileges.sql`
  SHA-256 `3e14097751cea54dbe0d7eece91275751484ab310a31bc48e9382f211e3c0ed4`.
  It targets the exact 204 direct relation privilege entries plus the 16
  `postgres`-owned defaults in `public` and `storage`. It preserves SELECT/DML,
  RLS, policies, PUBLIC, and `service_role`; it validates PG17, relation
  ownership, RLS, audit counts, grant provenance, and absence of unexpected
  browser-role memberships/grants.
- Separately staged provider-authorized operation:
  `supabase/migrations-pending-provider/20261028113100_revoke_supabase_admin_browser_defaults.sql`
  SHA-256 `d9f9333a7efc1aced5ae73de802dec40337bd3fa4911f0a1f10492df06a34d1c`.
  It targets only the 24 `supabase_admin`-owned defaults across
  `public`/`graphql`/`graphql_public`; it is not in the ordinary migration
  directory and refuses to run without that role's authority. If Supabase
  cannot provide an approved execution path, that residual scope stays
  blocked—not escalated.
- New authority fixture runs a non-superuser `postgres` role separately from
  the bootstrap user, asserts `42501` for that role's provider-ACL attempt,
  applies the two scopes independently/idempotently, and compares safe grants,
  RLS, policies, PUBLIC, and `service_role`. The provider SQL is scanned by
  both fail-closed pending-SQL scanners. The scan reports five pending SQL
  files. A supplemental PGlite 17.5 authority-split execution passed with an
  aliased non-superuser role; the native Docker PostgreSQL 17 harness could
  not run in this local environment because Docker storage was full. The
  exact-head GitHub native PostgreSQL 17 check remains required.
- Read-only exact row-count query is prepared at
  `supabase/tests/hosted-development-row-count-inventory.sql`
  (SHA-256 `edcf24936bc516348cafb9db382e7eb1298c7ee950f549d635983fc10ecf1cbb`).
  It returns only counts for `auth.users` and 36 public relations inside a
  read-only transaction. It was not run here; current row counts are
  UNVERIFIED. It exports no row values.
- No migration, ACL change, row write, export/snapshot, restore, payment,
  supplier/email activity, or Worker activation occurred. Supabase Free
  paid-backup/PITR and full restore rehearsal remain nonrequirements; no paid
  resources were created. The supported SQL rollback is the exact inverse
  grant/default statements in
  `docs/hosted-acl-remediation-execution.md`.

The current exact-scope execution package is
`docs/hosted-acl-remediation-execution.md`. PR #82 stays OPEN/DRAFT. These SQL
files remain pending and do not authorize `plan`, `apply`, migration repair,
or an ACL write. Wallet funding/spending remain disabled.
