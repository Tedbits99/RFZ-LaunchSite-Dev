# FazerCards incident status

**Status: unresolved. Order creator and exposed-key revocation remain unverified.** This record captures evidence reviewed on 2026-10-29 and does not attribute the orders to a person, agent, or organization.

## Supplier references

- `ord-2539708` — Jawaker 4250 Tokens
- `ord-2539753` — Google Play India 10 INR
- `ord-2539758` — IMO 5 USD

Incoming FazerCards webhook attempts for these references were recorded from 2026-10-28 21:06:39 UTC through 21:16:40 UTC (2026-10-29 05:06:39–05:16:40 Philippine time). Supabase returned HTTP 503 for the webhook attempts. No hosted `orders`, `supplier_transactions`, `supplier_test_runs`, or `suppliers` rows linked the supplier references when reviewed. These facts confirm supplier-side references existed but do not identify who created them.

## Separate diagnostic traffic

Seven requests reached the deployed Supabase functions from `172.234.82.46` (Linode, Osaka) between 2026-10-28 22:42:43 and 22:43:01 UTC, with user agent `curl/8.22.0`. They received only 401, 405, or 503 responses. The function endpoint logs show no request to the FazerCards test-order route and no evidence that the requests placed an order. The client operator is unknown.

## Confirmed webhook failure

The signed webhook receiver looked up each supplier reference in `public.supplier_transactions`. PostgREST returned 403 / SQLSTATE 42501. A read-only privilege query confirmed `service_role` lacked SELECT on that table. The receiver returns 503 when that lookup errors, so it could not persist/link these webhook events. The repair in this PR grants only `SELECT` on that table to `service_role`; it changes neither RLS nor browser-role access and is not applied to hosted Supabase.

The separate auto-reconciliation and handoff 503s occurred because the deployed functions queried `public._cron_secrets`, which was absent from the hosted database. They therefore failed closed before processing a queue.

## Containment and attribution limits

- The FazerCards diagnostics Edge Function no longer calls the provider or creates orders in this source tree. Its admin test-order page is replaced by a disabled-state notice.
- Canonical purchase paths now require the exact server-side release value `RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE=enabled`; they default to locked. No workflow in this PR should configure that value.
- These source changes have not been deployed. Do not infer hosted isolation from this PR until its separate deployment status is verified.
- Codex-wide execution history, other agents' logs, Cloudflare account logs, and FazerCards order-creation audit records were unavailable. GitHub Actions had no run during the observed event window. The previously exposed API key's revocation status is unknown.
- Request FazerCards' order-creation audit trail for each reference: timestamp/timezone, API key fingerprint, source IP, user agent/client metadata, authenticated account/API principal, and request/idempotency ID. Never request or share the secret itself.

Do not mark the incident resolved until provider-side key revocation and order attribution have independent evidence.
