# UIUX-007 Gate B evidence matrix

This matrix records the current boundary for the private preview. It does not
authorize a hosted migration, Worker deployment, DNS change, payment, supplier
operation, email, or webhook.

| Requirement | Evidence | Status | Next evidence/action |
|---|---|---|---|
| PR exact head and Gate A checks | PR #14 is open/draft; the PR body records the current exact head and both linked validation runs. Those runs must match the head before this row is considered PASS; the latest recorded runs completed SUCCESS with 101 browser passes and 3 skips | PASS (Gate A) | Hosted owner-authenticated admin and recovery evidence remains separate |
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
| Cloudflare Access all traffic | Protected preview deployment `40270959320` verified the exact current PR head `9df7a6388d9ff37d6dcd6de0e813847ffd8ba58f` through the trusted main workflow; saved account-wide Access policy passed | PASS | Owner-authenticated access and unauthorized-identity denial remain owner-assisted |
| Anonymous denial | Deployment `40270959320` returned HTTP 302 for both the normal Worker URL and immutable version URL, with no application data markers | PASS | Complete owner-authenticated and unauthorized-identity tests without sharing credentials or tokens |

## P0 authentication gate evidence

The current PR head adds a server-side `/api/auth/admin-login` endpoint. It
accepts the browser JSON flow and the native pre-hydration form, then verifies
the Supabase Auth user and the exact `public.admins.id`/normalized-email,
active-role contract before redirecting to `/admin`. Invalid, customer,
email-mismatched, inactive, and untrusted-origin cases clear the isolated
admin session and remain denied.

Exact-head validation:

- The PR body records the latest exact-head Frontend and Development runs;
  both completed SUCCESS, including tests, TypeScript, lint, Next.js/OpenNext
  builds, isolated RPC/RLS security, browser acceptance, legacy upgrade, and
  production release safety.
- Local unit/integration validation: 55 files, 893 passed, 1 skipped.

Live owner-admin login, password-reset email delivery, Auth callback
configuration, and same-browser/fresh-browser hosted recovery remain
UNVERIFIED because no authorized live Supabase/Auth binding or owner mailbox
session is available in this environment. The repository supports both
Supabase authorization-code/PKCE callbacks and `token_hash` recovery links;
the actual project email template was not available for inspection, so the
cross-browser path is not claimed until the owner confirms which template is
active and completes a fresh-browser test. The hosted preview verified at an
earlier commit is historical and is not evidence that the current head is
deployed.

The failed browser evidence is retained in GitHub run `40147707434`. Its
screenshots show the shared loading/compiling surface, with no admin data
rendered. The remediation waits for that observable loading boundary to
resolve before checking the server-side not-found marker, and sets the theme
ready marker in the existing synchronous boot script so mobile hydration does
not gate the preference contract.

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

