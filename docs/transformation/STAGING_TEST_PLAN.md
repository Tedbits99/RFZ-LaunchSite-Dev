# Staging verification plan

**Proposed; no staging deployment or real provider operation executed.** Setup, spending, emails and financial/provider actions need their explicit approvals. Infrastructure work remains behind the Phase 0/1/2 gates.

## Isolation prerequisites

Owner identifies non-production app/backend targets, safe synthetic users/orders, provider sandbox capability, test recipients and spending limits. Confirm test environments cannot reach production secrets/data/jobs. Disable real transports and schedulers by an approved staged configuration; do not assume `PAYMENT_PROVIDER=mock` disables the direct PayMongo/FazerCards paths. Record exact code SHA, dependency lock, deployed Edge versions, migration ledger and environment-variable names only.

| Test group | Required scenarios and evidence | Current status |
|---|---|---|
| Host/runtime | SSR, route handlers, proxy/cookie refresh, static assets, cache/auth separation and error logs | Pending Verification |
| Auth | Signup/confirmation/resend, login/logout, recovery replay/expiry, origin rejection and customer/admin namespace isolation | Local tests exist; target pending |
| Permissions | Anonymous, customer A/B, inactive admin, active admin and super admin for every relevant action | Local guard tests exist; full matrix pending |
| Catalog/checkout | Empty/unavailable packages, current cents/discounts, price tampering, player validation outage, duplicate submission | Pending Verification |
| Payments | Sandbox QR creation, signature rejection, wrong amount/currency/order, duplicates, late events, refunds and reconciliation | Requires Owner Approval + confirmed sandbox |
| Fulfillment | Paid gate, captured mapping, concurrent claim, timeout/unknown outcome, bounded retry and manual recovery | Requires Owner Approval; no live purchases |
| Wallet | Disabled-state denial; later phase synthetic double-entry/overspend/replay/reversal and approval separation | Locked to assigned phases |
| Email | Template/escaping/dedupe locally; approved SMTP auth/send/receive and SPF/DKIM/DMARC results in controlled environment | TLS greeting only verified; delivery pending |
| Workers/jobs | Authorization, disabled paths, leases, retries, competing workers, duplicate jobs and failure recovery | Production receipt handler unimplemented; DB harness blocked |
| Admin | Every control from source inventory: happy path, failure, loading, role denial and audit trail | Pending Verification |
| UX/SEO | Phone/tablet/desktop, keyboard/screen reader, errors/empty states, canonical/sitemap/robots | Pending Verification |
| Recovery | Last-good app rollback, isolated DB/object restore, post-recovery financial reconciliation | Pending Verification |
| Domain | Host test URL first; later approved apex/www TLS/redirect and Auth callbacks; mailbox preservation | Production DNS untouched |

## Evidence and acceptance

For each case record test ID, phase/issue ID, environment, code/migration identity, synthetic fixture, expected/actual result, timestamp and sanitized evidence. Distinguish mocked tests, PGlite tests, real disposable Postgres tests, staging browser tests and live provider tests. An unavailable or intentionally omitted mandatory integration is BLOCKED, not PASS.

Reject a release with unresolved security/financial defects, missing migrations, broken mandatory controls, failing required checks or unverified restoration. Follow strict phase gates; a staging plan is not implementation or permission to advance. See [launch checklist](../PRODUCTION_LAUNCH_CHECKLIST.md).
