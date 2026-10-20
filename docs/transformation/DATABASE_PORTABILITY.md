# Database portability audit

**Status: BLOCKED / Pending Verification.** Source demonstrates a Supabase-compatible application; it does not establish who controls the deployed backend. No database connection, export, hosted SQL, provisioning or personal-data copy was performed.

## Retention decision

First determine whether the existing project is already independently managed by the owner. If yes, retain it and change only the app host after verification. If it is managed through legacy Bolt with restricted access, request supported ownership transfer/export options. A PostgreSQL schema is portable in principle, but Auth, storage, Vault, cron, Realtime and deployed Edge configuration make a whole-service move more than a SQL dump. Do not infer portability from the URL format.

| Requirement | Available evidence | Missing evidence / safe next step |
|---|---|---|
| Ownership/admin rights | Owner states an existing backend; code uses Supabase clients | Owner-confirmed project/account and read-only administrative metadata |
| Project identity/connection | Variable names and clients exist | Confirm project reference/region and supported connection/export access without sharing secrets |
| Schema/migration ledger | 114 active, 2 pending, 13 archived source files | Read-only deployed schema/ledger comparison; duplicates and pending status cannot be inferred |
| Auth/users | Supabase Auth and namespaced sessions; auth-linked UUIDs | Supported identities/password-hash export/restore, OAuth providers, MFA, SMTP, session invalidation/relogin plan |
| RLS/RPC/extensions | SECURITY DEFINER, grants, Vault, cron/net and Realtime references | Effective policy/grant/owner/search-path and extension compatibility inventory |
| Edge Functions | Eleven source entrypoints and explicit verification config | Deployed versions, runtime compatibility, secret names/presence and invocation URLs |
| Storage | References/history only | Bucket inventory, access policies, object count/size, independent object export and URL rewrite needs |
| Jobs/secrets | Historical scheduler, outbox/handoff code and Vault credential bridge | Schedule definitions, secret ownership/re-creation plan and assurance no job is duplicated during transition |
| Backup/recovery | Proposed procedures only | Actual backup retention, export permission, restore drill and recovery objectives |
| Cutover consistency | Idempotency/claim source exists | Handling in-flight orders/webhooks, financial delta reconciliation and approved write-freeze window |

## Future migration rehearsal — Proposed, not executed

1. Obtain exact ownership/export documentation and an owner-approved isolated target; do not provision it during Phase 0.
2. Inventory schema, roles, extensions, grants/RLS, functions/triggers, migration ledger, Auth identity dependencies, storage objects and schedules. Record counts/hashes and configuration names only in Git.
3. Design an encrypted owner-controlled export and access/retention policy. Production personal data must not enter development. Prefer synthetic or appropriately anonymized rehearsal data.
4. Restore in isolation with all outbound scheduler/provider/mail calls disabled. Re-create required service configuration and secrets through secure channels, not Git.
5. Verify UUID/reference preservation, exact monetary totals, row counts, checksums where appropriate, Auth login/recovery, RLS role matrix, storage retrieval and worker idempotency.
6. Plan in-flight transaction handling, webhook URL transition, approved delta capture/write freeze and consistency checkpoints. Avoid simultaneous fulfillment workers against the same orders.
7. Prove rollback including post-snapshot writes; obtain separate production migration/cutover approval. Keep the old service available until acceptance.

The [official Supabase backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) is a reference workflow, not proof this legacy service permits it. [Database backups](https://supabase.com/docs/guides/platform/backups) exclude Storage object bytes and some role credentials; separately verify all required assets. No export command is supplied with an invented project ID.

See [database guide](../DATABASE_AND_MIGRATIONS.md) and [deployment dependencies](DEPLOYMENT_DEPENDENCIES.md). No independent backend recommendation is final until these access and restore questions are answered.
