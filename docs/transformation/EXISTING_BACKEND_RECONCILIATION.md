# Existing Supabase backend reconciliation

**Inspection date:** 2026-10-19  
**Repository:** `Tedbits99/RFZ-LaunchSite-Dev` / `main`  
**Observed repository HEAD:** `9a22dc78061b591946efa038debc0b7fda15563c`  
**Existing project:** `ketdhcmwowzztcdlmris`

This is a read-only repository-side reconciliation record. No hosted SQL,
migration, reset, branch creation, Edge Function deployment, secret
configuration, storage change, schedule change, or provider request was made.

## Existing project status

The authenticated project-scoped Supabase inspection returned the existing
RunFazone URL, catalog metadata, migration history, extensions, advisors,
branches, and Edge Function inventory. The legacy project remains the system
under audit and was not used as a disposable migration target.

The database is not empty or missing: it contains 13 public tables and all
reported public tables have RLS enabled. Current observed row counts are
catalog data in `games` (8), `game_input_fields` (9), `packages` (44),
`vouchers` (2), `promotions` (2), and `announcements` (2); order, payment,
support, notification, and usage tables were empty at the returned count.
Counts are metadata only and no customer records were fetched.

The hosted migration ledger contains 11 versions through
`20260928062039_update_orders_status_check`. The local repository has 115
active SQL files, including those 11 logical matches, later unrecorded
candidates, two pending RF Coins files, and archived duplicate copies. The
remote tool did not expose checksums, so byte-for-byte identity is not proven.
An unapplied local migration is therefore classified as a candidate or drift
item, not as proof that the corresponding hosted object is missing.

The default branch metadata reports `MIGRATIONS_FAILED` while its preview is
`ACTIVE_HEALTHY`; no failed version or repair detail was exposed. No repair was
attempted. This state requires owner/Supabase follow-up before any hosted
change is considered.

## Database reconciliation

### Verified hosted inventory

- Public tables: 13; reported RLS enabled on all 13.
- Public constraints: 48; public indexes: 30, from the prior catalog snapshot.
- Public routines: 5; no public views or materialized views were returned.
- Public triggers: none returned by the prior catalog snapshot.
- Realtime publication members: none returned.
- Installed extensions include `plpgsql`, `pgcrypto`, `uuid-ossp`,
  `pg_stat_statements`, and `supabase_vault`. `pg_cron` and `pg_net` were
  available in the extension catalog but not installed in the observed state.
- No storage bucket or storage policy metadata was returned by the available
  project-scoped inspection. Auth provider settings, backup/PITR, export and
  restore controls are control-plane information and remain unverified.

### Live security findings requiring separately authorized remediation

The advisors reported RLS enabled without policies on
`payment_submissions`, `voucher_usages`, and `vouchers`. They also reported
five public `SECURITY DEFINER` routines executable by both `anon` and
`authenticated`: `admin_change_order_status`, `admin_get_all_games`,
`admin_get_games_with_package_counts`, `admin_set_game_active`, and
`rls_auto_enable`. These are findings, not fixes.

The same inspection reported disabled leaked-password protection, six
unindexed foreign keys, and nine unused indexes. Performance findings are
recorded for later reviewed remediation; they do not authorize a hosted
schema change.

The source tree contains later security and ownership migrations, but they are
not present in the hosted 11-version ledger. Their safe path is disposable
validation, review, and an owner-authorized forward-only hosted migration.

## Edge Function reconciliation

The hosted Edge Function inventory returned **zero deployed functions**. The
repository contains these deployment candidates; “missing” here means not
deployed to the existing project, not absent from source:

| Candidate | Role and required boundary | Secrets/configuration to verify later |
|---|---|---|
| `verify-player` | Player verification and cache writes; authenticated request and rate limits | Supabase URL/service role; provider-specific verification configuration if enabled |
| `create-qrph-payment` | Payment creation; server-side amount/order validation | Supabase URL/service role, payment provider secret/config |
| `payment-webhook` | Signature/event/amount/order-state verification, then payment RPCs | PayMongo webhook secret, provider secret, Supabase service role |
| `fulfillment-handoff` / `fulfillment-handoff-v2` | Supplier handoff only after verified payment and atomic claim | FazerCards credential, Supabase service role |
| `auto-reconciliation` | Supplier outcome reconciliation; schedule must remain disabled in development | FazerCards credential, Supabase service role, cron secret/config |
| `send-transactional-email` | Private transactional mail delivery | Titan SMTP or approved mail provider credentials, Supabase service role |
| `completion-receipt-email-worker` | Claim/ack/fail durable receipt outbox work | Worker secret, app origin, Supabase service role |
| `archive-old-orders` | Restricted administrative archival/recovery operation | Supabase service role and explicit admin authorization |
| `fazercards-test` | Controlled supplier test path only; no production fulfillment | FazerCards credential, explicit test-mode guard |
| `create-coin-topup-payment` | RF Coins payment path; excluded pending business/security approval | Payment provider secret and RF Coins RPC contract |

All candidates require RPC dependency verification, explicit JWT/signature or
admin authorization, bounded retries, idempotency tests, and synthetic
provider fixtures before deployment. `create-coin-topup-payment` remains
inactive. No function is production-ready merely because its source exists.

## Secrets inventory

Only names were inventoried; no values were printed, requested, or retrieved.
Configuration status is **unverified** unless a later owner-authorized
control-plane inspection proves otherwise.

| Secret/config name | Consumer | Environment | Status | Safe verification |
|---|---|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | All privileged functions | Supabase development/production | Unverified | Confirm name exists in function configuration without revealing value |
| `SUPABASE_ANON_KEY` | Verification/function compatibility paths | Supabase development/production | Unverified | Name/config metadata only |
| `PAYMENT_PAYMONGO_SECRET_KEY`, `PAYMENT_PAYMONGO_WEBHOOK_SECRET` | Payment creation/webhook | Development sandbox then production | Unverified | Confirm secret names and sandbox mode; never echo values |
| `SUPPLIER_FAZERCARDS_API_KEY` | Supplier handoff/reconciliation/test | Development mock/sandbox then production | Unverified | Confirm name and provider sandbox entitlement |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | Transactional email | Development sink then Titan production | Unverified | Confirm names and non-production sink; preserve Titan business email |
| `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `PAYMENT_PROVIDER` | Alternate/provider compatibility paths | Explicitly approved environment only | Unverified | Confirm whether intentionally enabled; do not activate implicitly |
| `COMPLETION_RECEIPT_WORKER_ENABLED`, `COMPLETION_RECEIPT_WORKER_SECRET`, `COMPLETION_RECEIPT_APP_ORIGIN` | Receipt worker | Development/production | Unverified | Confirm disabled/default state and secret name |
| `RFZ_COMPLETION_RECEIPT_INTEGRATION_MODE`, `RFZ_RECOVERY_PROOF_HMAC_SECRET`, `RFZ_CUSTOMER_CONFIRMATION_RESEND_HMAC_SECRET` | Receipt/recovery/customer retry controls | Development/production | Unverified | Confirm names and test-mode values only |

Cloudflare configuration may contain public URL/anon-key values only. Private
payment, supplier, SMTP, service-role, database, and worker credentials remain
Supabase-managed and must not be copied to Cloudflare.

## Readiness and dependency order

The repository is ready for the next implementation phase to integrate the
existing database conservatively, but the backend is not ready for live
automation. The dependency order is:

1. Owner confirms project control-plane metadata and the intended environment.
2. In a disposable or owner-managed development instance, validate the
   reviewed forward-only migration candidates and their exact RPC/RLS grants.
3. Establish customer Auth/session boundaries and admin RBAC before exposing
   catalog or order administration.
4. Validate secure order creation, integer-cent pricing, payment verification,
   supplier atomic claims, reconciliation, and receipt outbox idempotency with
   mocks only.
5. Deploy private functions to an approved development project, configure
   synthetic/non-production secrets, and run observability/recovery drills.
6. Separately approve production secrets, provider activation, schedules,
   webhooks, email, and any hosted schema remediation.

RF Coins remains outside this baseline. Real payment, supplier, SMTP, and
outbound HTTP activity remains disabled in development tests.

## Phase 0 conclusion

Phase 0 can accurately record the existing backend and its risks without
requiring a second Supabase project or rebuilding the established database.
The remaining mandatory evidence is control-plane ownership/region/plan/quota
and backup/export information, exact failed-branch detail, complete Auth/
Storage/Realtime/schedule configuration evidence, owner-approved staged
security remediation, and side-effect-isolated validation of the later
automation candidates. Customer/admin feature implementation, Edge Function
deployment, provider activation, Cloudflare integration, and production
cutover belong to later transformation phases.
