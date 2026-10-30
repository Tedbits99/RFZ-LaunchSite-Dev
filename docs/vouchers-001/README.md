# VOUCHERS-001 campaign engine

This stacked change adds database-backed promotion campaigns to the catalog baseline. It does not authorize production rollout or financial activation. No hosted database, payment provider, supplier, Worker, or RF Coins endpoint is used by the acceptance commands.

## Local acceptance

Prerequisites: Node 22, Docker, Supabase CLI 2.121.0, PostgreSQL 17 support in the Supabase CLI, and Chromium for Playwright. Run:

```sh
bash scripts/vouchers-001/run-local-acceptance.sh
```

The runner makes an unlinked loopback-only Supabase/Auth stack in a new `/tmp/rfz-vouchers-001.*` directory, copies the canonical migration sequence, resets only that stack, creates synthetic ADMIN/STAFF/customer identities and catalog fixtures, then runs database ACL/accounting checks, all Vitest tests, the enabled catalog/voucher endpoint contracts, TypeScript, lint, Next.js/OpenNext builds, and desktop/mobile browser acceptance. It refuses to use non-loopback database/API URLs and refuses provider credentials. Cleanup stops the named local stack and removes only the exact temporary directory created for that run.

The deterministic campaign fixtures use the existing CATALOG-001 seed package `c0010000-0000-4000-8000-000000000022` and published game `c0010000-0000-4000-8000-000000000002`. The integration tests create uniquely named campaigns/orders and Auth activity only inside the disposable stack; the entire fixture database and test mail are removed with it. Do not point these test variables at any hosted Supabase project.

## Data and accounting contract

- Existing voucher rows are retained and attributed to private, non-discoverable legacy campaigns. Their limits, dates, applicability, and usage history are retained; a legacy `usage_limit=0` remains unlimited.
- New campaigns are always drafts. Status transitions and audited mutations are database-controlled.
- The package row supplies the price; the browser cannot submit a subtotal or discount. A single code is accepted per order. The database recomputes and snapshots the discount at order creation.
- Redemption uses a locked voucher/campaign row, an append-preserving usage ledger, a unique order/voucher key, and budget accounting over reserved plus committed discounts. Only an order lifecycle terminal state releases a reservation; repeating the same terminal event does not release it twice.
- Welcome and retention eligibility use verified `auth.uid()` and completed-order history. A guest-supplied email is only a guest-use-limit key, not proof of account identity.
- Supplier-linked orders/promotions remain blocked while the independent supplier release and pricing checks are not satisfied. Payment, supplier fulfillment, RF Coins and receipt delivery are not activated by this campaign feature.
- Rate limiting is database-backed across app/Worker instances, salted and hashed, fixed-window, capped at 100,000 buckets, and fails closed when its storage budget is exhausted.

## Rollback and release gate

The migration is forward-only and preserves old voucher/order rows. There is no automatic down migration: rollback means pause/archive campaign creation through the audited API, revert the application artifact to the last reviewed SHA, and retain the additive schema and redemption ledger until a separately reviewed recovery plan accounts for all reservations and committed orders. Never drop campaign tables, rewrite legacy voucher history, or reverse a migration with active redemptions. Do not apply this migration to hosted Supabase in this phase.

Development acceptance and production financial activation are separate decisions. A successful local/CI gate proves only the implementation against synthetic fixtures. Production requires independent owner approval, credential/provider remediation (including upstream confirmation that the previously exposed FazerCards credential was revoked), authorized release procedures, and separate activation decisions for payment, supplier fulfillment, and RF Coins.
