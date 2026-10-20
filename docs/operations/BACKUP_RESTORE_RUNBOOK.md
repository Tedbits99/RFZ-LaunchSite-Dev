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

Restore only into a disposable loopback PostgreSQL database. The restore
command refuses remote targets and requires `RFZ_DISPOSABLE_RESTORE_CONFIRM=YES`:

```bash
RFZ_DISPOSABLE_RESTORE_CONFIRM=YES \
  RESTORE_DATABASE_URL='postgresql://…@127.0.0.1:54322/postgres' \
  BACKUP_FILE=/secure/operator/path/runfazone-<timestamp>.dump \
  bash scripts/backup-restore-disposable.sh restore-verify
```

The rehearsal checks the manifest checksum, restores with `pg_restore` in one
transaction, and reports only the restored public-table count and migration
history count. It does not establish Auth, Storage object, Edge Function,
Vault, scheduler, or project-control-plane recovery; those must be verified
separately in the Supabase dashboard before a hosted migration.

The hosted `MIGRATIONS_FAILED` state remains unresolved. This runbook does not
authorize a hosted repair, reset, restore, or migration push.
