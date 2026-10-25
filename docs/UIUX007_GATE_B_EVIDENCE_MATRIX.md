# UIUX-007 Gate B evidence matrix

This matrix records the current boundary for the private preview. It does not
authorize a hosted migration, Worker deployment, DNS change, payment, supplier
operation, email, or webhook.

| Requirement | Evidence | Status | Next evidence/action |
|---|---|---|---|
| PR exact head and Gate A checks | PR #14 at `256cbd326c58207244b671c8a08473bd2933c1cf`; Frontend and Development checks passed; 84/84 browser; legacy upgrade passed | PASS | Recheck only if the PR head changes |
| Cloudflare account authorization | Preflight run `40146567430` | PASS | Preserve environment restriction |
| OpenNext artifact and privileged-secret scan | Preflight build job passed | PASS | No deploy authorization implied |
| Existing Supabase project identity | Project `ketdhcmwowzztcdlmris`, URL recorded in prior project-scoped audit | PASS (historical) | Owner-confirm current identity |
| Hosted migration ledger and checksums | Prior read-only evidence: 11 versions; checksums and current state unavailable | UNVERIFIED | Run `SUPABASE_READONLY_AUDIT.sql` through approved read-only access |
| Hosted schema/RLS/functions | Prior catalog snapshot only; known privilege/RLS findings remain | UNVERIFIED | Capture sanitized SQL results and compare to active migrations |
| Auth/callback configuration | Not exposed by prior catalog inspection | UNVERIFIED | Owner supplies sanitized Auth settings evidence |
| Jobs/triggers/Edge Functions | Prior evidence reported zero deployed Edge Functions; current state unverified | UNVERIFIED | Capture function list, trigger list, cron/net metadata |
| Backup/PITR/export/restore | No backup or restore-test evidence | BLOCKED | Owner supplies dashboard backup evidence and disposable restore proof |
| Payment isolation | Source-level mock/loopback test controls; hosted secret/config status unverified | BLOCKED | Verify sandbox/mock mode and disabled live provider credentials |
| Supplier isolation | Source/test guards only; hosted FazerCards configuration unverified | BLOCKED | Verify no live supplier secret or route is enabled |
| Webhook isolation | Signature tests are isolated; hosted endpoint/configuration unverified | BLOCKED | Verify live webhook routing is disabled or sandbox-only |
| Email isolation | Local tests and secret-name inventory only | BLOCKED | Verify sink/test recipient and disabled production SMTP delivery |
| Cloudflare Access all traffic | No Worker/hostname exists; account policy unavailable to this session | UNVERIFIED | Owner protects exact hostname and every alternate/version URL |
| Anonymous denial | Not executable before a protected Worker exists | BLOCKED | After authorized deployment, test unauthenticated 401/Access denial |

## Owner-provided evidence package

Use the Supabase SQL Editor or another approved read-only channel to run the
SELECT-only script at [SUPABASE_READONLY_AUDIT.sql](SUPABASE_READONLY_AUDIT.sql).
Provide results with customer rows, tokens, URLs containing credentials, and
secret values redacted. Include a timestamp and project reference.

Separately provide dashboard evidence for backup retention/PITR, export rights,
and a restore rehearsal into a disposable database. A logical database dump
alone is not proof of Auth, Storage, Vault, Edge Function, scheduler, or secret
recovery.

For Cloudflare Access, configure a Self-hosted application for the exact
preview hostname, add the approved two email identities to an Allow policy,
remove public/bypass paths, and cover any immutable or alternate preview
hostname. Do not deploy until the owner confirms the policy is effective.

