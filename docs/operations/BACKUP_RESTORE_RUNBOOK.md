# Backup and disposable restore runbook

The repository includes [`backup-restore-disposable.sh`](../../scripts/backup-restore-disposable.sh),
which performs a manual PostgreSQL logical export and a checksum-verified
restore rehearsal. It does not contact Supabase until an operator supplies a
database URL at invocation time. Never put a URL, password, dump, manifest, or
service token in Git, chat, CI logs, or this document.

Run the local safety checks first:

```bash
bash scripts/test-backup-restore-workflow.sh
```

For an owner-approved export, use an output path outside the repository. A
remote source requires `RFZ_REMOTE_EXPORT_APPROVED=YES`:

```bash
DATABASE_URL='postgresql://…' \
  BACKUP_OUTPUT_DIR=/secure/operator/path \
  RFZ_REMOTE_EXPORT_APPROVED=YES \
  bash scripts/backup-restore-disposable.sh export
```

The command creates a custom-format dump and a mode-600 checksum manifest. The
source host, port, database name, timestamp and SHA-256 are recorded; the URL
and credentials are not.

Restore only into a freshly provisioned disposable loopback PostgreSQL database.
The restore command requires an operator-generated proof file naming the
ephemeral instance, target database, purpose and expiry; a loopback host or a
database named `postgres` alone is never sufficient. It also requires
`RFZ_DISPOSABLE_RESTORE_CONFIRM=YES`:

```bash
RFZ_DISPOSABLE_RESTORE_CONFIRM=YES \
  RESTORE_DATABASE_URL='postgresql://…@127.0.0.1:54322/runfazone_restore_<id>' \
  RESTORE_PROOF_FILE=/secure/operator/path/disposable-restore-proof.json \
  BACKUP_FILE=/secure/operator/path/runfazone-<timestamp>.dump \
  bash scripts/backup-restore-disposable.sh restore-verify
```

The CI rehearsal in [`test-disposable-backup-restore.sh`](../../scripts/test-disposable-backup-restore.sh)
creates two uniquely named PostgreSQL 16 containers, seeds a synthetic schema
with tables, foreign keys, checks, RLS policy, function and migration ledger,
exports with `pg_dump`, restores into a different database, verifies catalog
objects and sample data, tests missing/corrupt/incompatible archives, and
proves cleanup leaves an unrelated container untouched. It does not establish
Auth, Storage object, Edge Function, Vault, scheduler, managed role, or
project-control-plane recovery; those must be verified separately in the
Supabase dashboard before a hosted migration.

The hosted `MIGRATIONS_FAILED` state remains unresolved. This runbook does not
authorize a hosted repair, reset, restore, or migration push.
