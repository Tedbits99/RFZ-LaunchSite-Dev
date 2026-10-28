# Trusted hosted ACL metadata audit

This operation is a manually dispatched, main-only extension of the existing
`runfazone-development-db.yml` workflow. It uses the protected
`runfazone-development-db` environment and the workflow's fixed identity check
for development project `ketdhcmwowzztcdlmris`. It does not use SQL or scripts
from an unmerged pull request. The run's source SHA is the exact trusted main
commit, recorded with workflow run ID, UTC capture time, workflow ref, and
project reference in the uploaded JSON artifact.

The `metadata-acl-audit` operation runs only the trusted
`supabase/tests/hosted-acl-metadata-audit.sql` SELECT-only catalog report and
`scripts/audit-hosted-acl-metadata.sh`. It does not invoke the general
`audit-hosted-integrations.sh`, schema/data dump, migration `plan`/`apply`,
restore, deploy, payment, supplier, or email paths. The audit step uses a
single PostgreSQL connection string and keeps the database password in the
process environment; the password is not printed, placed in arguments, or
included in the artifact.

The bounded artifact contains only database/version/extension metadata,
public relation names and RLS flags, effective browser table privileges,
`relacl`/`aclexplode()` grantor and grantee metadata, `pg_default_acl` entries,
role membership paths, payment table constraints/index/policy metadata,
public function security/execute metadata, scheduled-job count, and RF Coins
object names. It contains no application rows or function bodies. The wrapper
asserts that all nine report sections were captured, all public tables have
both browser-role effective privilege records and direct ACL provenance, all
required Supabase roles are present, the payment relation exists, and the
result stays within a 4 MiB limit. Migration history is captured before and
after and must be byte-identical for this operation.

## Approval and dispatch gate

This workflow change is **prepared for review only**. It must be reviewed and
merged to `main` through the repository's normal protected-PR process before
the audit can run. Do not dispatch from the feature branch. Before dispatch,
select:

- Workflow: `Runfazone development database synchronization`
- Branch: `main`
- `source_sha`: the exact current `main` SHA shown by GitHub
- `operation`: `metadata-acl-audit`
- `apply_confirmation`: empty

Review the job and the `runfazone-development-db-<run_id>` artifact. A passing
audit establishes metadata provenance only; it does not prove a PostgREST or
application path can exploit an ACL. Any later hosted ACL change requires a
separate reviewed, exact-table remediation and a separate explicit approval.
