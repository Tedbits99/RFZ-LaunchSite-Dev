# Remote Supabase migration audit plan and evidence

Phase 0 remote verification is intentionally read-only. The authenticated
project-scoped MCP connection for `ketdhcmwowzztcdlmris` is now verified, and
catalog metadata was read without retrieving customer rows or secret values.
No service-role key, database password, export, provisioning, or hosted SQL
write is authorized by this repository change.

## Verified live evidence

The MCP returned project URL `https://ketdhcmwowzztcdlmris.supabase.co`, 13
public tables with RLS enabled, 11 recorded migration versions, 48 public
constraints, 30 public indexes, five public `SECURITY DEFINER` routines, 13
public policies, zero public views/materialized views, zero Realtime members,
zero deployed Edge Functions, and a `main` branch status of
`MIGRATIONS_FAILED` with an `ACTIVE_HEALTHY` preview status. Organization,
ownership, region, plan/quota, backup/restore and the exact failed migration
diagnostic were not exposed.

The effective Codex MCP URL is project-scoped but does not contain
`read_only=true`; write-capable tools are visible. This audit used only
read-only metadata, catalog, log and advisor operations, so read-only behavior
is an operating restriction rather than a server-enforced permission claim.

The hosted ledger matches only the first 11 logical local migrations. The
active local tree has 115 files, with 104 unrecorded candidates, two pending
RF Coins files and 13 archived duplicate copies. No receipt/reconciliation,
security-hardening, supplier or RF Coins migration is recorded remotely.

## Required owner-authorized evidence

Obtain a time-stamped metadata export from the intended Supabase project using
an owner-approved read-only path. Redact credentials, tokens, connection URLs,
customer data, and provider payloads before storing or sharing the evidence.

Compare the evidence with the local repository, in chronological order, rather
than inferring deployment from migration filenames:

- applied migration versions from the project's migration history;
- local active, pending, and archived migrations, including duplicate and
  suffixed filenames;
- tables, columns, defaults, indexes, foreign keys, check constraints, and
  unique constraints;
- function/procedure definitions, owners, `SECURITY DEFINER` settings,
  `search_path`, and grants/revokes;
- RLS enabled/forced state and every policy's command, role, `USING`, and
  `WITH CHECK` expressions;
- Realtime publication membership and replica-identity settings;
- installed extensions and versions;
- scheduled jobs, job SQL, Edge Function targets, and all outbound HTTP
  destinations;
- backup retention, point-in-time recovery, export, restore, and last-known
  restore-test evidence.

## Comparison output

The audit should produce a three-way result for each item: local expectation,
remote observed state, and disposition (`match`, `remote-only`, `local-only`,
or `requires owner decision`). In particular, verify the effective final
definition and privileges of `finalize_supplier_reconciliation`, the
`order_email_outbox` constraints, and the completion-receipt worker RPCs.

Do not apply, repair, or rollback migrations during this audit. Any mismatch
that could affect payment, fulfillment, receipt delivery, RLS, or outbound
traffic remains a Phase 0 blocker until the owner supplies evidence and
approves a separately reviewed change.
