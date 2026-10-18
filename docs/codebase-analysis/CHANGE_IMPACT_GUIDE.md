# Change impact guide

## Before changing checkout/pricing

Read [app/games/[slug]/GameTopUp.tsx](/workspaces/RFZ-LaunchSite/app/games/[slug]/GameTopUp.tsx:53), [app/api/orders/route.ts](/workspaces/RFZ-LaunchSite/app/api/orders/route.ts:1), the `create_order` migration, [lib/voucher.ts](/workspaces/RFZ-LaunchSite/lib/voucher.ts:42), and the package/order migrations. Preserve integer cents, server-side package lookup, voucher snapshots, required input validation, and reference generation.

## Before changing payment

Trace manual submission, generic provider routes, QR Edge Function, webhook Edge Function, payment transactions, `verify_payment`, RLS, and order status transitions. Test duplicate webhook, amount mismatch, already-paid, expired QR, and provider timeout scenarios. Changes may affect checkout, admin verification, fulfillment authorization, emails, and reconciliation.

## Before changing fulfillment/suppliers

Read [lib/suppliers/adapter.ts](/workspaces/RFZ-LaunchSite/lib/suppliers/adapter.ts:78), [lib/suppliers/fulfillment.ts](/workspaces/RFZ-LaunchSite/lib/suppliers/fulfillment.ts:117), FazerCards adapter, webhook trigger logic, reconciliation, mapping capture migrations, and supplier transaction constraints. Preserve atomic claim, idempotency key, captured mapping, retry semantics, and the rule that only verified payment can trigger fulfillment.

## Before changing auth/RLS

Inspect `middleware.ts`, [lib/adminGuard.ts](/workspaces/RFZ-LaunchSite/lib/adminGuard.ts:73), all relevant migration policy definitions in chronological order, and the deployed Supabase policy state. Do not infer effective security from one migration file because policies evolved and some files are duplicated/re-suffixed.

## Before changing order state

Update the TypeScript status labels, UI transitions, API allow-lists, SQL CHECK constraints/RPC transitions, timeline labels, email triggers, Realtime behavior, and reconciliation paths together. Validate terminal-state and concurrent-request behavior.

## Safe validation checklist

- Run TypeScript/ESLint/build checks available in the project.
- Run focused supplier tests and add tests for changed payment/order paths.
- Validate unauthenticated, authenticated non-admin, and each intended admin role.
- Test RLS with anon/authenticated/service-role contexts against a staging Supabase project.
- Test responsive/keyboard behavior on storefront, checkout, tracking, and admin pages.
- Confirm Edge Function deployment configuration, secrets, cron, webhook signature secrets, and provider sandbox behavior.

## Current high-impact modules

The highest blast radius is in `middleware.ts`, `lib/adminGuard.ts`, Supabase migrations/RPCs, `lib/suppliers/fulfillment.ts`, `app/api/orders/route.ts`, payment/webhook functions, and shared status/state types. Treat changes there as cross-feature changes requiring regression coverage.
