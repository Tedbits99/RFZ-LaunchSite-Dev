# Remote Supabase migration audit plan

Phase 0 remote verification is intentionally read-only. No project link,
database connection, service-role key, access token, or hosted SQL execution is
authorized by this repository change.

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
