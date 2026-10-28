# Source coverage and action inventory

**Verified:** structural inventory of the current working tree, 2026-10-19. Every listed source/config file was read for declarations and risk patterns. This is not a claim of line-by-line correctness or successful browser execution. Previous manual findings are reconciled in [Phase 0 audit](./PHASE_00_AUDIT.md).

## Counts

- source_config_files_scanned: 396
- next_api_routes: 49
- all_route_handlers: 51
- pages: 52
- admin_pages: 32
- edge_entrypoints: 11
- vitest_test_files: 50
- active_migration_files: 114
- pending_migration_files: 2
- archived_migration_files: 13

## Routes and pages

Every route below is **IMPLEMENTED BUT UNVERIFIED** as a deployed route. Local tests may cover selected boundaries; no production or staging browser test was run.

| Source | HTTP methods or surface |
|---|---|
| [app/(legal)/copyright-disclaimer/page.tsx](../../app/%28legal%29/copyright-disclaimer/page.tsx) | Page |
| [app/(legal)/payment-policy/page.tsx](../../app/%28legal%29/payment-policy/page.tsx) | Page |
| [app/(legal)/privacy-policy/page.tsx](../../app/%28legal%29/privacy-policy/page.tsx) | Page |
| [app/(legal)/refund-policy/page.tsx](../../app/%28legal%29/refund-policy/page.tsx) | Page |
| [app/(legal)/terms-of-service/page.tsx](../../app/%28legal%29/terms-of-service/page.tsx) | Page |
| [app/account/orders/[id]/page.tsx](../../app/account/orders/[id]/page.tsx) | Page |
| [app/account/orders/page.tsx](../../app/account/orders/page.tsx) | Page |
| [app/account/page.tsx](../../app/account/page.tsx) | Page |
| [app/account/profile/page.tsx](../../app/account/profile/page.tsx) | Page |
| [app/account/wallet/page.tsx](../../app/account/wallet/page.tsx) | Page |
| [app/admin/activity-log/page.tsx](../../app/admin/activity-log/page.tsx) | Page |
| [app/admin/analytics/page.tsx](../../app/admin/analytics/page.tsx) | Page |
| [app/admin/announcements/page.tsx](../../app/admin/announcements/page.tsx) | Page |
| [app/admin/approvals/page.tsx](../../app/admin/approvals/page.tsx) | Page |
| [app/admin/blocklist/page.tsx](../../app/admin/blocklist/page.tsx) | Page |
| [app/admin/bulk-pricing/page.tsx](../../app/admin/bulk-pricing/page.tsx) | Page |
| [app/admin/customers/page.tsx](../../app/admin/customers/page.tsx) | Page |
| [app/admin/export/page.tsx](../../app/admin/export/page.tsx) | Page |
| [app/admin/games/[id]/packages/page.tsx](../../app/admin/games/[id]/packages/page.tsx) | Page |
| [app/admin/games/page.tsx](../../app/admin/games/page.tsx) | Page |
| [app/admin/ml-offer-pricing/page.tsx](../../app/admin/ml-offer-pricing/page.tsx) | Page |
| [app/admin/notifications/page.tsx](../../app/admin/notifications/page.tsx) | Page |
| [app/admin/orders/[id]/page.tsx](../../app/admin/orders/[id]/page.tsx) | Page |
| [app/admin/orders/page.tsx](../../app/admin/orders/page.tsx) | Page |
| [app/admin/page.tsx](../../app/admin/page.tsx) | Page |
| [app/admin/payments/page.tsx](../../app/admin/payments/page.tsx) | Page |
| [app/admin/pricing/page.tsx](../../app/admin/pricing/page.tsx) | Page |
| [app/admin/promotions/page.tsx](../../app/admin/promotions/page.tsx) | Page |
| [app/admin/reconciliation/page.tsx](../../app/admin/reconciliation/page.tsx) | Page |
| [app/admin/refunds/page.tsx](../../app/admin/refunds/page.tsx) | Page |
| [app/admin/risk-alerts/page.tsx](../../app/admin/risk-alerts/page.tsx) | Page |
| [app/admin/roles/page.tsx](../../app/admin/roles/page.tsx) | Page |
| [app/admin/security/page.tsx](../../app/admin/security/page.tsx) | Page |
| [app/admin/settings/page.tsx](../../app/admin/settings/page.tsx) | Page |
| [app/admin/staff/page.tsx](../../app/admin/staff/page.tsx) | Page |
| [app/admin/suppliers/controlled-test-order/page.tsx](../../app/admin/suppliers/controlled-test-order/page.tsx) | Page |
| [app/admin/suppliers/fazercards-catalog/page.tsx](../../app/admin/suppliers/fazercards-catalog/page.tsx) | Page |
| [app/admin/suppliers/page.tsx](../../app/admin/suppliers/page.tsx) | Page |
| [app/admin/system-health/page.tsx](../../app/admin/system-health/page.tsx) | Page |
| [app/admin/tasks/page.tsx](../../app/admin/tasks/page.tsx) | Page |
| [app/admin/tickets/page.tsx](../../app/admin/tickets/page.tsx) | Page |
| [app/admin/vouchers/page.tsx](../../app/admin/vouchers/page.tsx) | Page |
| [app/api/account/profile/route.ts](../../app/api/account/profile/route.ts) | GET,PUT,POST,DELETE |
| [app/api/account/wallet/ledger/route.ts](../../app/api/account/wallet/ledger/route.ts) | GET |
| [app/api/account/wallet/route.ts](../../app/api/account/wallet/route.ts) | GET |
| [app/api/account/wallet/topup/route.ts](../../app/api/account/wallet/topup/route.ts) | POST |
| [app/api/admin/fx-rate/route.ts](../../app/api/admin/fx-rate/route.ts) | GET |
| [app/api/admin/orders/[id]/poll-supplier-status/route.ts](../../app/api/admin/orders/[id]/poll-supplier-status/route.ts) | POST |
| [app/api/admin/orders/[id]/refund/route.ts](../../app/api/admin/orders/[id]/refund/route.ts) | POST |
| [app/api/admin/orders/[id]/retry-fulfillment/route.ts](../../app/api/admin/orders/[id]/retry-fulfillment/route.ts) | POST |
| [app/api/admin/orders/[id]/route.ts](../../app/api/admin/orders/[id]/route.ts) | GET |
| [app/api/admin/orders/[id]/start-fulfillment/route.ts](../../app/api/admin/orders/[id]/start-fulfillment/route.ts) | POST |
| [app/api/admin/orders/[id]/status/route.ts](../../app/api/admin/orders/[id]/status/route.ts) | PATCH |
| [app/api/admin/orders/[id]/verify-payment/route.ts](../../app/api/admin/orders/[id]/verify-payment/route.ts) | POST |
| [app/api/admin/orders/route.ts](../../app/api/admin/orders/route.ts) | GET |
| [app/api/admin/package-pricing/route.ts](../../app/api/admin/package-pricing/route.ts) | PATCH |
| [app/api/admin/rf-coins/route.ts](../../app/api/admin/rf-coins/route.ts) | GET,POST |
| [app/api/admin/settings/route.ts](../../app/api/admin/settings/route.ts) | GET,PATCH |
| [app/api/admin/sync-offers/route.ts](../../app/api/admin/sync-offers/route.ts) | POST,GET |
| [app/api/admin/test-order-candidates/route.ts](../../app/api/admin/test-order-candidates/route.ts) | GET |
| [app/api/admin/vouchers/route.ts](../../app/api/admin/vouchers/route.ts) | GET,POST,PATCH,DELETE |
| [app/api/announcement/route.ts](../../app/api/announcement/route.ts) | GET,POST |
| [app/api/auth/forgot-password/route.ts](../../app/api/auth/forgot-password/route.ts) | POST,GET |
| [app/api/auth/login/route.ts](../../app/api/auth/login/route.ts) | POST,GET |
| [app/api/auth/logout/route.ts](../../app/api/auth/logout/route.ts) | POST,GET |
| [app/api/auth/register/route.ts](../../app/api/auth/register/route.ts) | POST,GET |
| [app/api/auth/resend-confirmation/route.ts](../../app/api/auth/resend-confirmation/route.ts) | POST,GET |
| [app/api/export/route.ts](../../app/api/export/route.ts) | GET |
| [app/api/games/route.ts](../../app/api/games/route.ts) | GET,PATCH |
| [app/api/internal/fulfillment-handoff/route.ts](../../app/api/internal/fulfillment-handoff/route.ts) | POST |
| [app/api/orders/[id]/status-check/route.ts](../../app/api/orders/[id]/status-check/route.ts) | GET |
| [app/api/orders/[id]/timeline/route.ts](../../app/api/orders/[id]/timeline/route.ts) | GET |
| [app/api/orders/access/request/route.ts](../../app/api/orders/access/request/route.ts) | POST |
| [app/api/orders/access/verify/route.ts](../../app/api/orders/access/verify/route.ts) | POST |
| [app/api/orders/coin/route.ts](../../app/api/orders/coin/route.ts) | POST |
| [app/api/orders/create-payment/route.ts](../../app/api/orders/create-payment/route.ts) | POST |
| [app/api/orders/create-qrph-payment/route.ts](../../app/api/orders/create-qrph-payment/route.ts) | POST |
| [app/api/orders/lookup/route.ts](../../app/api/orders/lookup/route.ts) | GET,POST |
| [app/api/orders/qrph-status/route.ts](../../app/api/orders/qrph-status/route.ts) | GET |
| [app/api/orders/route.ts](../../app/api/orders/route.ts) | POST |
| [app/api/orders/submit-payment/route.ts](../../app/api/orders/submit-payment/route.ts) | POST |
| [app/api/payment-config/route.ts](../../app/api/payment-config/route.ts) | GET,POST,PATCH,DELETE |
| [app/api/promotions/route.ts](../../app/api/promotions/route.ts) | GET,POST,PATCH |
| [app/api/suppliers/actions/route.ts](../../app/api/suppliers/actions/route.ts) | POST |
| [app/api/suppliers/mappings/route.ts](../../app/api/suppliers/mappings/route.ts) | GET,POST,DELETE |
| [app/api/suppliers/route.ts](../../app/api/suppliers/route.ts) | GET,POST,PATCH,DELETE |
| [app/api/suppliers/test-runs/poll/route.ts](../../app/api/suppliers/test-runs/poll/route.ts) | GET,POST |
| [app/api/suppliers/test-runs/route.ts](../../app/api/suppliers/test-runs/route.ts) | GET,POST,PATCH |
| [app/api/suppliers/transactions/route.ts](../../app/api/suppliers/transactions/route.ts) | GET |
| [app/api/vouchers/validate/route.ts](../../app/api/vouchers/validate/route.ts) | POST |
| [app/api/webhooks/payment/route.ts](../../app/api/webhooks/payment/route.ts) | POST |
| [app/auth/callback/route.ts](../../app/auth/callback/route.ts) | GET |
| [app/auth/confirmation/page.tsx](../../app/auth/confirmation/page.tsx) | Page |
| [app/auth/reset-password/complete/route.ts](../../app/auth/reset-password/complete/route.ts) | POST,GET |
| [app/auth/reset-password/page.tsx](../../app/auth/reset-password/page.tsx) | Page |
| [app/checkout/page.tsx](../../app/checkout/page.tsx) | Page |
| [app/forgot-password/page.tsx](../../app/forgot-password/page.tsx) | Page |
| [app/games/[slug]/page.tsx](../../app/games/[slug]/page.tsx) | Page |
| [app/login/page.tsx](../../app/login/page.tsx) | Page |
| [app/page.tsx](../../app/page.tsx) | Page |
| [app/register/page.tsx](../../app/register/page.tsx) | Page |
| [app/secure-admin-login/page.tsx](../../app/secure-admin-login/page.tsx) | Page |
| [app/track-order/page.tsx](../../app/track-order/page.tsx) | Page |
| [supabase/functions/archive-old-orders/index.ts](../../supabase/functions/archive-old-orders/index.ts) | Edge entrypoint |
| [supabase/functions/auto-reconciliation/index.ts](../../supabase/functions/auto-reconciliation/index.ts) | Edge entrypoint |
| [supabase/functions/completion-receipt-email-worker/index.ts](../../supabase/functions/completion-receipt-email-worker/index.ts) | Edge entrypoint |
| [supabase/functions/create-coin-topup-payment/index.ts](../../supabase/functions/create-coin-topup-payment/index.ts) | Edge entrypoint |
| [supabase/functions/create-qrph-payment/index.ts](../../supabase/functions/create-qrph-payment/index.ts) | Edge entrypoint |
| [supabase/functions/fazercards-test/index.ts](../../supabase/functions/fazercards-test/index.ts) | Edge entrypoint |
| [supabase/functions/fulfillment-handoff/index.ts](../../supabase/functions/fulfillment-handoff/index.ts) | Edge entrypoint |
| [supabase/functions/fulfillment-handoff-v2/index.ts](../../supabase/functions/fulfillment-handoff-v2/index.ts) | Edge entrypoint |
| [supabase/functions/payment-webhook/index.ts](../../supabase/functions/payment-webhook/index.ts) | Edge entrypoint |
| [supabase/functions/send-transactional-email/index.ts](../../supabase/functions/send-transactional-email/index.ts) | Edge entrypoint |
| [supabase/functions/verify-player/index.ts](../../supabase/functions/verify-player/index.ts) | Edge entrypoint |

## Admin controls and action call sites

Counts are lexical JSX occurrences, not distinct business operations. Each button/event line is an inspection locator; dynamic/generated controls can render multiple instances. Runtime permission, success/failure, disabled/loading and audit behavior remain **Pending Verification** for every control.

| Source | Button tags | Event bindings | API/RPC call references |
|---|---:|---:|---|
| [app/admin/AdminShell.tsx](../../app/admin/AdminShell.tsx) | 1 | 1 | No literal fetch/RPC/router target detected |
| [app/admin/GamesVisibilityPanel.tsx](../../app/admin/GamesVisibilityPanel.tsx) | 1 | 1 | `/api/games` |
| [app/admin/activity-log/page.tsx](../../app/admin/activity-log/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/analytics/page.tsx](../../app/admin/analytics/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/announcements/AnnouncementsClient.tsx](../../app/admin/announcements/AnnouncementsClient.tsx) | 7 | 17 | `/api/announcement` |
| [app/admin/announcements/page.tsx](../../app/admin/announcements/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/approvals/page.tsx](../../app/admin/approvals/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/blocklist/page.tsx](../../app/admin/blocklist/page.tsx) | 1 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/bulk-pricing/page.tsx](../../app/admin/bulk-pricing/page.tsx) | 3 | 7 | `/api/admin/bulk-pricing` |
| [app/admin/customers/page.tsx](../../app/admin/customers/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/export/page.tsx](../../app/admin/export/page.tsx) | 1 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/games/GameToggle.tsx](../../app/admin/games/GameToggle.tsx) | 1 | 1 | `/api/games` |
| [app/admin/games/[id]/packages/PackagesManager.tsx](../../app/admin/games/[id]/packages/PackagesManager.tsx) | 4 | 8 | `/api/admin/package-pricing` |
| [app/admin/games/[id]/packages/page.tsx](../../app/admin/games/[id]/packages/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/games/page.tsx](../../app/admin/games/page.tsx) | 1 | 0 | `admin_get_games_with_package_counts` |
| [app/admin/layout.tsx](../../app/admin/layout.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/ml-offer-pricing/MLOfferPricingClient.tsx](../../app/admin/ml-offer-pricing/MLOfferPricingClient.tsx) | 13 | 22 | `/api/admin/fx-rate`; `/api/admin/package-pricing`; `/api/admin/settings`; `/api/admin/sync-offers` |
| [app/admin/ml-offer-pricing/page.tsx](../../app/admin/ml-offer-pricing/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/notifications/page.tsx](../../app/admin/notifications/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/orders/OrdersManager.tsx](../../app/admin/orders/OrdersManager.tsx) | 8 | 16 | `/api/admin/orders/${detail.id}/poll-supplier-status`; `/api/admin/orders/${detail.id}/retry-fulfillment`; `/api/admin/orders/${detail.id}/start-fulfillment`; `/api/admin/orders/${detail.id}/status`; `/api/admin/orders/${detail.id}/verify-payment`; `/api/admin/orders/${id}`; `/api/admin/orders?${params.toString()}` |
| [app/admin/orders/[id]/AdminOrderDetailClient.tsx](../../app/admin/orders/[id]/AdminOrderDetailClient.tsx) | 9 | 13 | `/api/admin/orders/${order.id}/poll-supplier-status`; `/api/admin/orders/${order.id}/refund`; `/api/admin/orders/${order.id}/retry-fulfillment`; `/api/admin/orders/${order.id}/start-fulfillment`; `/api/admin/orders/${order.id}/status`; `/api/admin/orders/${order.id}/verify-payment`; `/api/orders/${order.id}/status-check`; `/api/orders/${order.id}/timeline` |
| [app/admin/orders/[id]/page.tsx](../../app/admin/orders/[id]/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/orders/page.tsx](../../app/admin/orders/page.tsx) | 0 | 0 | `archive_old_unpaid_orders` |
| [app/admin/page.tsx](../../app/admin/page.tsx) | 0 | 0 | `admin_get_all_games` |
| [app/admin/payments/PaymentConfigEditor.tsx](../../app/admin/payments/PaymentConfigEditor.tsx) | 9 | 37 | `/api/payment-config`; `/api/payment-config?id=${id}` |
| [app/admin/payments/page.tsx](../../app/admin/payments/page.tsx) | 0 | 0 | `admin_get_all_payment_config` |
| [app/admin/pricing/page.tsx](../../app/admin/pricing/page.tsx) | 1 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/promotions/PromotionsClient.tsx](../../app/admin/promotions/PromotionsClient.tsx) | 8 | 22 | `/api/promotions` |
| [app/admin/promotions/page.tsx](../../app/admin/promotions/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/reconciliation/page.tsx](../../app/admin/reconciliation/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/refunds/page.tsx](../../app/admin/refunds/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/rf-coins/RfCoinsClient.tsx](../../app/admin/rf-coins/RfCoinsClient.tsx) | 7 | 21 | `/api/admin/rf-coins` |
| [app/admin/risk-alerts/page.tsx](../../app/admin/risk-alerts/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/roles/page.tsx](../../app/admin/roles/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/security/page.tsx](../../app/admin/security/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/settings/page.tsx](../../app/admin/settings/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/staff/StaffManager.tsx](../../app/admin/staff/StaffManager.tsx) | 3 | 7 | `/api/admin/staff` |
| [app/admin/staff/page.tsx](../../app/admin/staff/page.tsx) | 1 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/suppliers/SuppliersClient.tsx](../../app/admin/suppliers/SuppliersClient.tsx) | 10 | 27 | `/api/suppliers`; `/api/suppliers/actions`; `/api/suppliers/mappings?supplier_id=${supplier.id}`; `/api/suppliers/test-runs?supplier_id=${supplier.id}&limit=10`; `/api/suppliers/transactions?supplier_id=${supplier.id}&limit=10`; `/api/suppliers?id=${supplier.id}` |
| [app/admin/suppliers/controlled-test-order/ControlledTestOrderClient.tsx](../../app/admin/suppliers/controlled-test-order/ControlledTestOrderClient.tsx) | 12 | 12 | `${EDGE_URL}/categories?limit=305`; `${EDGE_URL}/offers?category_id=${encodeURIComponent(cat.category_id)}`; `${EDGE_URL}/order`; `${EDGE_URL}/order-status?supplier_ref=${encodeURIComponent(supplierRef)}`; `/api/admin/test-order-candidates?limit=10`; `/api/suppliers/test-runs`; `/api/suppliers/test-runs/poll?id=${runId}`; `/api/suppliers/test-runs?limit=20` |
| [app/admin/suppliers/controlled-test-order/page.tsx](../../app/admin/suppliers/controlled-test-order/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/suppliers/fazercards-catalog/FazerCardsCatalogClient.tsx](../../app/admin/suppliers/fazercards-catalog/FazerCardsCatalogClient.tsx) | 4 | 5 | `${EDGE_URL}/balance`; `${EDGE_URL}/offers?category_id=${encodeURIComponent(cat.category_id)}` |
| [app/admin/suppliers/fazercards-catalog/page.tsx](../../app/admin/suppliers/fazercards-catalog/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/suppliers/page.tsx](../../app/admin/suppliers/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/system-health/page.tsx](../../app/admin/system-health/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/tasks/page.tsx](../../app/admin/tasks/page.tsx) | 1 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/tickets/page.tsx](../../app/admin/tickets/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |
| [app/admin/vouchers/VouchersClient.tsx](../../app/admin/vouchers/VouchersClient.tsx) | 11 | 23 | `/api/admin/vouchers`; `/api/admin/vouchers?id=${encodeURIComponent(v.id)}` |
| [app/admin/vouchers/page.tsx](../../app/admin/vouchers/page.tsx) | 0 | 0 | No literal fetch/RPC/router target detected |

### Button and event line index

All entries below require staged browser verification; presence is not functionality.

- [app/admin/AdminShell.tsx](../../app/admin/AdminShell.tsx): lines 38, 39.

- [app/admin/GamesVisibilityPanel.tsx](../../app/admin/GamesVisibilityPanel.tsx): lines 45, 46.

- [app/admin/announcements/AnnouncementsClient.tsx](../../app/admin/announcements/AnnouncementsClient.tsx): lines 102, 103, 119, 126, 133, 138, 147, 152, 157, 166, 167, 178, 198, 202, 221, 222, 249, 254, 262.

- [app/admin/blocklist/page.tsx](../../app/admin/blocklist/page.tsx): lines 39.

- [app/admin/bulk-pricing/page.tsx](../../app/admin/bulk-pricing/page.tsx): lines 100, 117, 127, 128, 144, 157, 190, 193, 194.

- [app/admin/export/page.tsx](../../app/admin/export/page.tsx): lines 47.

- [app/admin/games/GameToggle.tsx](../../app/admin/games/GameToggle.tsx): lines 45, 46.

- [app/admin/games/[id]/packages/PackagesManager.tsx](../../app/admin/games/[id]/packages/PackagesManager.tsx): lines 179, 181, 204, 208, 211, 215, 223, 224, 233.

- [app/admin/games/page.tsx](../../app/admin/games/page.tsx): lines 49.

- [app/admin/ml-offer-pricing/MLOfferPricingClient.tsx](../../app/admin/ml-offer-pricing/MLOfferPricingClient.tsx): lines 302, 304, 362, 444, 471, 507, 524, 532, 534, 547, 549, 555, 557, 566, 568, 599, 601, 645, 666, 687, 696, 702, 704, 710, 712, 728, 730, 768, 770, 777, 779, 795, 799, 801.

- [app/admin/orders/OrdersManager.tsx](../../app/admin/orders/OrdersManager.tsx): lines 251, 253, 264, 300, 308, 359, 368, 369, 375, 418, 432, 434, 473, 477, 478, 489, 491, 522, 524, 555, 557.

- [app/admin/orders/[id]/AdminOrderDetailClient.tsx](../../app/admin/orders/[id]/AdminOrderDetailClient.tsx): lines 439, 441, 532, 538, 539, 553, 554, 568, 569, 585, 598, 604, 605, 619, 620, 631, 638, 639, 645, 646, 661, 662.

- [app/admin/payments/PaymentConfigEditor.tsx](../../app/admin/payments/PaymentConfigEditor.tsx): lines 213, 214, 223, 234, 237, 246, 266, 271, 272, 273, 275, 276, 288, 289, 308, 309, 310, 311, 312, 313, 317, 320, 324, 327, 328, 344, 351, 355, 369, 370, 373, 381, 387, 388, 389, 390, 391, 392, 394, 396, 399.

- [app/admin/pricing/page.tsx](../../app/admin/pricing/page.tsx): lines 14.

- [app/admin/promotions/PromotionsClient.tsx](../../app/admin/promotions/PromotionsClient.tsx): lines 234, 235, 248, 249, 262, 271, 285, 299, 312, 324, 355, 364, 380, 389, 398, 405, 406, 415, 416, 421, 422, 458, 459, 470, 471, 503, 516, 531, 568, 569.

- [app/admin/rf-coins/RfCoinsClient.tsx](../../app/admin/rf-coins/RfCoinsClient.tsx): lines 158, 348, 349, 353, 354, 361, 363, 390, 392, 433, 434, 435, 436, 438, 458, 498, 499, 500, 501, 502, 504.

- [app/admin/staff/StaffManager.tsx](../../app/admin/staff/StaffManager.tsx): lines 79, 80, 94, 103, 113, 124, 132, 141, 184, 185.

- [app/admin/staff/page.tsx](../../app/admin/staff/page.tsx): lines 14.

- [app/admin/suppliers/SuppliersClient.tsx](../../app/admin/suppliers/SuppliersClient.tsx): lines 166, 168, 226, 228, 268, 296, 835, 837, 860, 862, 892, 894, 924, 926, 1057, 1070, 1083, 1092, 1094, 1096, 1153, 1155, 1168, 1175, 1189, 1200, 1221, 1230, 1242, 1257, 1268, 1283, 1294, 1367, 1369, 1374, 1376.

- [app/admin/suppliers/controlled-test-order/ControlledTestOrderClient.tsx](../../app/admin/suppliers/controlled-test-order/ControlledTestOrderClient.tsx): lines 455, 457, 498, 500, 545, 593, 594, 604, 622, 648, 668, 677, 706, 724.

- [app/admin/suppliers/fazercards-catalog/FazerCardsCatalogClient.tsx](../../app/admin/suppliers/fazercards-catalog/FazerCardsCatalogClient.tsx): lines 174, 176, 328, 330, 345, 375, 378, 408, 410.

- [app/admin/tasks/page.tsx](../../app/admin/tasks/page.tsx): lines 47.

- [app/admin/vouchers/VouchersClient.tsx](../../app/admin/vouchers/VouchersClient.tsx): lines 312, 313, 318, 319, 340, 345, 347, 359, 376, 388, 400, 415, 426, 435, 450, 459, 469, 480, 493, 496, 498, 537, 566, 568, 574, 576, 581, 583, 589, 591, 611.

## File coverage manifest

Content hashes identify the audited working tree, including pre-existing uncommitted implementation. They do not identify a deployed release. Excludes generated output, assets, secret files and dependency lock contents; dependencies were separately inspected via npm.

| File | Lines | SHA-256 prefix |
|---|---:|---|
| [.bolt/config.json](../../.bolt/config.json) | 10 | `1015a866137a` |
| [.eslintrc.json](../../.eslintrc.json) | 3 | `1589a15e55fb` |
| [.github/workflows/database-security-tests.yml](../../.github/workflows/database-security-tests.yml) | 81 | `0a294d6ac3c8` |
| [app/(legal)/copyright-disclaimer/page.tsx](../../app/%28legal%29/copyright-disclaimer/page.tsx) | 42 | `883de7b55c4f` |
| [app/(legal)/layout.tsx](../../app/%28legal%29/layout.tsx) | 15 | `f225801c749f` |
| [app/(legal)/payment-policy/page.tsx](../../app/%28legal%29/payment-policy/page.tsx) | 51 | `1f702d0cd4a5` |
| [app/(legal)/privacy-policy/page.tsx](../../app/%28legal%29/privacy-policy/page.tsx) | 75 | `d49a664bd140` |
| [app/(legal)/refund-policy/page.tsx](../../app/%28legal%29/refund-policy/page.tsx) | 59 | `be9c08bdf37d` |
| [app/(legal)/terms-of-service/page.tsx](../../app/%28legal%29/terms-of-service/page.tsx) | 60 | `da39ac4add92` |
| [app/account/orders/[id]/AccountOrderDetailClient.tsx](../../app/account/orders/[id]/AccountOrderDetailClient.tsx) | 334 | `5819c67dc7db` |
| [app/account/orders/[id]/page.tsx](../../app/account/orders/[id]/page.tsx) | 57 | `e5fb2cef217b` |
| [app/account/orders/page.tsx](../../app/account/orders/page.tsx) | 99 | `099d4f749e51` |
| [app/account/page.tsx](../../app/account/page.tsx) | 51 | `0a7166868e39` |
| [app/account/profile/page.tsx](../../app/account/profile/page.tsx) | 114 | `552d4bc44c0c` |
| [app/account/wallet/WalletClient.tsx](../../app/account/wallet/WalletClient.tsx) | 239 | `0aa2b2a6af5e` |
| [app/account/wallet/page.tsx](../../app/account/wallet/page.tsx) | 23 | `07db7542c6eb` |
| [app/admin/AdminShell.tsx](../../app/admin/AdminShell.tsx) | 57 | `867cb6ce4dca` |
| [app/admin/GamesVisibilityPanel.tsx](../../app/admin/GamesVisibilityPanel.tsx) | 61 | `76482c11e573` |
| [app/admin/activity-log/page.tsx](../../app/admin/activity-log/page.tsx) | 22 | `4844460fa157` |
| [app/admin/analytics/page.tsx](../../app/admin/analytics/page.tsx) | 37 | `07ba6c6c1746` |
| [app/admin/announcements/AnnouncementsClient.tsx](../../app/admin/announcements/AnnouncementsClient.tsx) | 302 | `da0844433b2d` |
| [app/admin/announcements/page.tsx](../../app/admin/announcements/page.tsx) | 15 | `8b9df6eddfd8` |
| [app/admin/approvals/page.tsx](../../app/admin/approvals/page.tsx) | 67 | `86fcb472b1a1` |
| [app/admin/blocklist/page.tsx](../../app/admin/blocklist/page.tsx) | 85 | `1eefa45aa38e` |
| [app/admin/bulk-pricing/page.tsx](../../app/admin/bulk-pricing/page.tsx) | 206 | `4258e2713da8` |
| [app/admin/customers/page.tsx](../../app/admin/customers/page.tsx) | 41 | `28a9a468ef6d` |
| [app/admin/export/page.tsx](../../app/admin/export/page.tsx) | 57 | `df06e1544eb8` |
| [app/admin/games/GameToggle.tsx](../../app/admin/games/GameToggle.tsx) | 62 | `4d8f05cea9a4` |
| [app/admin/games/[id]/packages/PackagesManager.tsx](../../app/admin/games/[id]/packages/PackagesManager.tsx) | 246 | `2964b60a8155` |
| [app/admin/games/[id]/packages/page.tsx](../../app/admin/games/[id]/packages/page.tsx) | 61 | `3ae407c67df2` |
| [app/admin/games/page.tsx](../../app/admin/games/page.tsx) | 110 | `472da072abd2` |
| [app/admin/layout.test.ts](../../app/admin/layout.test.ts) | 13 | `12d98d2098d3` |
| [app/admin/layout.tsx](../../app/admin/layout.tsx) | 13 | `1f1d49bc9a0f` |
| [app/admin/ml-offer-pricing/MLOfferPricingClient.tsx](../../app/admin/ml-offer-pricing/MLOfferPricingClient.tsx) | 833 | `3ea16e0e3f67` |
| [app/admin/ml-offer-pricing/page.tsx](../../app/admin/ml-offer-pricing/page.tsx) | 11 | `abbbc8970005` |
| [app/admin/notifications/page.tsx](../../app/admin/notifications/page.tsx) | 67 | `f98b9414d693` |
| [app/admin/orders/OrdersManager.tsx](../../app/admin/orders/OrdersManager.tsx) | 596 | `d43c28db105a` |
| [app/admin/orders/[id]/AdminOrderDetailClient.tsx](../../app/admin/orders/[id]/AdminOrderDetailClient.tsx) | 693 | `3e6294ce7ce7` |
| [app/admin/orders/[id]/page.tsx](../../app/admin/orders/[id]/page.tsx) | 152 | `9236087536b4` |
| [app/admin/orders/page.tsx](../../app/admin/orders/page.tsx) | 84 | `876eee877062` |
| [app/admin/page.tsx](../../app/admin/page.tsx) | 132 | `fa8a4cd6f75b` |
| [app/admin/payments/PaymentConfigEditor.tsx](../../app/admin/payments/PaymentConfigEditor.tsx) | 408 | `a5817841c7b8` |
| [app/admin/payments/page.tsx](../../app/admin/payments/page.tsx) | 135 | `e9bea832b77a` |
| [app/admin/pricing/page.tsx](../../app/admin/pricing/page.tsx) | 22 | `c1ddeda91e5c` |
| [app/admin/promotions/PromotionsClient.tsx](../../app/admin/promotions/PromotionsClient.tsx) | 584 | `39a1d3401796` |
| [app/admin/promotions/page.tsx](../../app/admin/promotions/page.tsx) | 61 | `b823c7134567` |
| [app/admin/reconciliation/page.tsx](../../app/admin/reconciliation/page.tsx) | 95 | `c205fb607815` |
| [app/admin/refunds/page.tsx](../../app/admin/refunds/page.tsx) | 25 | `5aeff2774682` |
| [app/admin/rf-coins/RfCoinsClient.tsx](../../app/admin/rf-coins/RfCoinsClient.tsx) | 507 | `477009985414` |
| [app/admin/risk-alerts/page.tsx](../../app/admin/risk-alerts/page.tsx) | 25 | `424be9c37ee5` |
| [app/admin/roles/page.tsx](../../app/admin/roles/page.tsx) | 23 | `7bb9703d2c22` |
| [app/admin/security/page.tsx](../../app/admin/security/page.tsx) | 23 | `2f93e2784112` |
| [app/admin/settings/page.tsx](../../app/admin/settings/page.tsx) | 25 | `0fe2a3f7e085` |
| [app/admin/staff/StaffManager.tsx](../../app/admin/staff/StaffManager.tsx) | 198 | `b5c3e6b4ed49` |
| [app/admin/staff/page.tsx](../../app/admin/staff/page.tsx) | 21 | `f8d952c58b8f` |
| [app/admin/suppliers/SuppliersClient.tsx](../../app/admin/suppliers/SuppliersClient.tsx) | 1392 | `105443fc805d` |
| [app/admin/suppliers/controlled-test-order/ControlledTestOrderClient.tsx](../../app/admin/suppliers/controlled-test-order/ControlledTestOrderClient.tsx) | 751 | `54f7b7f5f352` |
| [app/admin/suppliers/controlled-test-order/page.tsx](../../app/admin/suppliers/controlled-test-order/page.tsx) | 11 | `3d5a60cdf3ff` |
| [app/admin/suppliers/fazercards-catalog/FazerCardsCatalogClient.tsx](../../app/admin/suppliers/fazercards-catalog/FazerCardsCatalogClient.tsx) | 427 | `f0619b127692` |
| [app/admin/suppliers/fazercards-catalog/page.tsx](../../app/admin/suppliers/fazercards-catalog/page.tsx) | 11 | `83135a713a39` |
| [app/admin/suppliers/page.tsx](../../app/admin/suppliers/page.tsx) | 11 | `f0bbd897bc89` |
| [app/admin/system-health/page.tsx](../../app/admin/system-health/page.tsx) | 24 | `6211b4f7e916` |
| [app/admin/tasks/page.tsx](../../app/admin/tasks/page.tsx) | 81 | `671deb104c77` |
| [app/admin/tickets/page.tsx](../../app/admin/tickets/page.tsx) | 27 | `eda698416f49` |
| [app/admin/vouchers/VouchersClient.tsx](../../app/admin/vouchers/VouchersClient.tsx) | 670 | `6ab00fb6bfee` |
| [app/admin/vouchers/page.tsx](../../app/admin/vouchers/page.tsx) | 18 | `78614ca7e176` |
| [app/api/account/profile/route.test.ts](../../app/api/account/profile/route.test.ts) | 112 | `cf432cf20443` |
| [app/api/account/profile/route.ts](../../app/api/account/profile/route.ts) | 67 | `06b370ea2456` |
| [app/api/account/wallet/ledger/route.ts](../../app/api/account/wallet/ledger/route.ts) | 21 | `8426c0d98e1e` |
| [app/api/account/wallet/route.ts](../../app/api/account/wallet/route.ts) | 49 | `4305f8074b5e` |
| [app/api/account/wallet/topup/route.ts](../../app/api/account/wallet/topup/route.ts) | 77 | `93d39bb5ccb8` |
| [app/api/admin/fx-rate/route.ts](../../app/api/admin/fx-rate/route.ts) | 37 | `e4b672d057e3` |
| [app/api/admin/orders/[id]/poll-supplier-status/route.ts](../../app/api/admin/orders/[id]/poll-supplier-status/route.ts) | 29 | `e010bf607331` |
| [app/api/admin/orders/[id]/refund/route.test.ts](../../app/api/admin/orders/[id]/refund/route.test.ts) | 286 | `8eed3f676939` |
| [app/api/admin/orders/[id]/refund/route.ts](../../app/api/admin/orders/[id]/refund/route.ts) | 197 | `3f290d0f1b28` |
| [app/api/admin/orders/[id]/retry-fulfillment/route.ts](../../app/api/admin/orders/[id]/retry-fulfillment/route.ts) | 92 | `d83baff8f689` |
| [app/api/admin/orders/[id]/route.ts](../../app/api/admin/orders/[id]/route.ts) | 65 | `27d52d2bdc9d` |
| [app/api/admin/orders/[id]/start-fulfillment/route.ts](../../app/api/admin/orders/[id]/start-fulfillment/route.ts) | 59 | `b7f9f630a838` |
| [app/api/admin/orders/[id]/status/route.ts](../../app/api/admin/orders/[id]/status/route.ts) | 86 | `96c6a5cf1ae2` |
| [app/api/admin/orders/[id]/verify-payment/route.ts](../../app/api/admin/orders/[id]/verify-payment/route.ts) | 58 | `5e6618a04ed1` |
| [app/api/admin/orders/route.ts](../../app/api/admin/orders/route.ts) | 65 | `0d17af135b3e` |
| [app/api/admin/package-pricing/route.ts](../../app/api/admin/package-pricing/route.ts) | 123 | `df2151e85678` |
| [app/api/admin/rf-coins/route.test.ts](../../app/api/admin/rf-coins/route.test.ts) | 102 | `3ae8074dd388` |
| [app/api/admin/rf-coins/route.ts](../../app/api/admin/rf-coins/route.ts) | 141 | `abdabc6ff1ec` |
| [app/api/admin/settings/route.ts](../../app/api/admin/settings/route.ts) | 72 | `c1370eefc3b1` |
| [app/api/admin/sync-offers/route.ts](../../app/api/admin/sync-offers/route.ts) | 275 | `9352abcdf5bf` |
| [app/api/admin/test-order-candidates/route.ts](../../app/api/admin/test-order-candidates/route.ts) | 23 | `87faa552bc87` |
| [app/api/admin/vouchers/route.ts](../../app/api/admin/vouchers/route.ts) | 237 | `97b38c93224b` |
| [app/api/announcement/route.ts](../../app/api/announcement/route.ts) | 53 | `ca82e483c60e` |
| [app/api/auth/forgot-password/route.test.ts](../../app/api/auth/forgot-password/route.test.ts) | 152 | `154c86ec560d` |
| [app/api/auth/forgot-password/route.ts](../../app/api/auth/forgot-password/route.ts) | 60 | `1e0a495f51e2` |
| [app/api/auth/login/route.test.ts](../../app/api/auth/login/route.test.ts) | 181 | `0f5d31b32449` |
| [app/api/auth/login/route.ts](../../app/api/auth/login/route.ts) | 131 | `4e6d67120d39` |
| [app/api/auth/logout/route.test.ts](../../app/api/auth/logout/route.test.ts) | 56 | `ed318bcd5142` |
| [app/api/auth/logout/route.ts](../../app/api/auth/logout/route.ts) | 30 | `395881aeff90` |
| [app/api/auth/register/route.test.ts](../../app/api/auth/register/route.test.ts) | 123 | `5692d7f2e702` |
| [app/api/auth/register/route.ts](../../app/api/auth/register/route.ts) | 95 | `7153eb2050cc` |
| [app/api/auth/resend-confirmation/route.test.ts](../../app/api/auth/resend-confirmation/route.test.ts) | 228 | `d008f0841c1d` |
| [app/api/auth/resend-confirmation/route.ts](../../app/api/auth/resend-confirmation/route.ts) | 87 | `2cbbb9b8a503` |
| [app/api/export/route.ts](../../app/api/export/route.ts) | 92 | `5432acb6cc7d` |
| [app/api/games/route.ts](../../app/api/games/route.ts) | 59 | `bd29e3cd3870` |
| [app/api/internal/fulfillment-handoff/route.ts](../../app/api/internal/fulfillment-handoff/route.ts) | 64 | `6ae6c365cf7a` |
| [app/api/orders/[id]/status-check/route.ts](../../app/api/orders/[id]/status-check/route.ts) | 39 | `a0582f5a53ba` |
| [app/api/orders/[id]/timeline/route.ts](../../app/api/orders/[id]/timeline/route.ts) | 32 | `68ad74be6978` |
| [app/api/orders/access/request/route.ts](../../app/api/orders/access/request/route.ts) | 69 | `a1e343254392` |
| [app/api/orders/access/verify/route.ts](../../app/api/orders/access/verify/route.ts) | 57 | `799330a41bfc` |
| [app/api/orders/coin/route.ts](../../app/api/orders/coin/route.ts) | 171 | `a62607c291e0` |
| [app/api/orders/create-payment/route.ts](../../app/api/orders/create-payment/route.ts) | 156 | `90974be57c15` |
| [app/api/orders/create-qrph-payment/route.ts](../../app/api/orders/create-qrph-payment/route.ts) | 71 | `8397243fc0e5` |
| [app/api/orders/lookup/route.test.ts](../../app/api/orders/lookup/route.test.ts) | 92 | `010fc20d72eb` |
| [app/api/orders/lookup/route.ts](../../app/api/orders/lookup/route.ts) | 51 | `6759c430e7dc` |
| [app/api/orders/qrph-status/route.ts](../../app/api/orders/qrph-status/route.ts) | 46 | `11a1dea3fd89` |
| [app/api/orders/route.test.ts](../../app/api/orders/route.test.ts) | 139 | `8fd854f53b07` |
| [app/api/orders/route.ts](../../app/api/orders/route.ts) | 176 | `e872ec1cdb0f` |
| [app/api/orders/submit-payment/route.ts](../../app/api/orders/submit-payment/route.ts) | 58 | `26f79ddd0b9d` |
| [app/api/payment-config/route.ts](../../app/api/payment-config/route.ts) | 181 | `48f3147a84f1` |
| [app/api/promotions/route.ts](../../app/api/promotions/route.ts) | 158 | `91cab8f4ab36` |
| [app/api/suppliers/actions/route.ts](../../app/api/suppliers/actions/route.ts) | 33 | `2366596f457d` |
| [app/api/suppliers/mappings/route.ts](../../app/api/suppliers/mappings/route.ts) | 60 | `39b348881ae9` |
| [app/api/suppliers/route.ts](../../app/api/suppliers/route.ts) | 111 | `3561dc67697f` |
| [app/api/suppliers/test-runs/poll/route.ts](../../app/api/suppliers/test-runs/poll/route.ts) | 144 | `21c27be5c7cb` |
| [app/api/suppliers/test-runs/route.ts](../../app/api/suppliers/test-runs/route.ts) | 128 | `a674595c9d24` |
| [app/api/suppliers/transactions/route.ts](../../app/api/suppliers/transactions/route.ts) | 27 | `45f4eb63c135` |
| [app/api/vouchers/validate/route.ts](../../app/api/vouchers/validate/route.ts) | 105 | `a70120c2be90` |
| [app/api/webhooks/payment/route.ts](../../app/api/webhooks/payment/route.ts) | 48 | `4a454c630b6c` |
| [app/auth/callback/route.test.ts](../../app/auth/callback/route.test.ts) | 352 | `ba0d4f8818bd` |
| [app/auth/callback/route.ts](../../app/auth/callback/route.ts) | 130 | `8b89e0f9f665` |
| [app/auth/confirmation/ResendConfirmationForm.tsx](../../app/auth/confirmation/ResendConfirmationForm.tsx) | 142 | `d19a9448e36b` |
| [app/auth/confirmation/page.test.tsx](../../app/auth/confirmation/page.test.tsx) | 159 | `a5421e31c1ea` |
| [app/auth/confirmation/page.tsx](../../app/auth/confirmation/page.tsx) | 49 | `a8e0cbefd5a8` |
| [app/auth/reset-password/complete/route.test.ts](../../app/auth/reset-password/complete/route.test.ts) | 297 | `20c2ba6aa022` |
| [app/auth/reset-password/complete/route.ts](../../app/auth/reset-password/complete/route.ts) | 101 | `ade9bb27d992` |
| [app/auth/reset-password/page.test.tsx](../../app/auth/reset-password/page.test.tsx) | 93 | `3ccbd3c7a2a1` |
| [app/auth/reset-password/page.tsx](../../app/auth/reset-password/page.tsx) | 87 | `33387d90a617` |
| [app/checkout/CheckoutPaymentForm.tsx](../../app/checkout/CheckoutPaymentForm.tsx) | 111 | `fe57fafcf795` |
| [app/checkout/QrPhPayment.tsx](../../app/checkout/QrPhPayment.tsx) | 522 | `22949b675382` |
| [app/checkout/page.tsx](../../app/checkout/page.tsx) | 218 | `0602ea7a1813` |
| [app/forgot-password/page.tsx](../../app/forgot-password/page.tsx) | 77 | `9b14ecb746f7` |
| [app/games/[slug]/GameTopUp.tsx](../../app/games/[slug]/GameTopUp.tsx) | 561 | `603abdd5672c` |
| [app/games/[slug]/page.tsx](../../app/games/[slug]/page.tsx) | 112 | `3cc84aa448cc` |
| [app/globals.css](../../app/globals.css) | 15 | `a257777c80b5` |
| [app/layout.tsx](../../app/layout.tsx) | 36 | `5c6e33fc66ff` |
| [app/login/page.test.tsx](../../app/login/page.test.tsx) | 24 | `9a4f2656e30f` |
| [app/login/page.tsx](../../app/login/page.tsx) | 82 | `ad762d8b8057` |
| [app/page.tsx](../../app/page.tsx) | 105 | `cc4af0182f7d` |
| [app/register/page.test.tsx](../../app/register/page.test.tsx) | 72 | `af5fedc09e14` |
| [app/register/page.tsx](../../app/register/page.tsx) | 112 | `f75c81f33d78` |
| [app/robots.ts](../../app/robots.ts) | 6 | `5f74a3998529` |
| [app/secure-admin-login/page.tsx](../../app/secure-admin-login/page.tsx) | 127 | `9692478c6cdd` |
| [app/sitemap.ts](../../app/sitemap.ts) | 11 | `10cdab055ac7` |
| [app/track-order/page.tsx](../../app/track-order/page.tsx) | 278 | `24a3529cb8f0` |
| [components/AnnouncementPopup.tsx](../../components/AnnouncementPopup.tsx) | 133 | `18651f589916` |
| [components/SiteFooter.tsx](../../components/SiteFooter.tsx) | 48 | `0bb77c1665f8` |
| [components/admin/AdminNavigation.tsx](../../components/admin/AdminNavigation.tsx) | 104 | `a756e7876daa` |
| [components/admin/AdminPage.tsx](../../components/admin/AdminPage.tsx) | 12 | `aac6eb8dccb3` |
| [components/admin/navData.ts](../../components/admin/navData.ts) | 76 | `e10bdd1a643f` |
| [components/admin/ui.tsx](../../components/admin/ui.tsx) | 40 | `c6265232ae58` |
| [eslint.config.mjs](../../eslint.config.mjs) | 30 | `5fefa3aa96ef` |
| [lib/adminGuard.test.ts](../../lib/adminGuard.test.ts) | 64 | `97d448001503` |
| [lib/adminGuard.ts](../../lib/adminGuard.ts) | 128 | `41b61f5250a9` |
| [lib/archiveSecurityMigration.test.ts](../../lib/archiveSecurityMigration.test.ts) | 43 | `11ea77e8c683` |
| [lib/authRedirect.ts](../../lib/authRedirect.ts) | 25 | `2ba5670b570c` |
| [lib/authRouteContext.test.ts](../../lib/authRouteContext.test.ts) | 73 | `6e9fd39d2c33` |
| [lib/authRouteContext.ts](../../lib/authRouteContext.ts) | 107 | `63082dda37b6` |
| [lib/authSessionBrowserClients.ts](../../lib/authSessionBrowserClients.ts) | 33 | `b5cb018b4c41` |
| [lib/authSessionClients.test.ts](../../lib/authSessionClients.test.ts) | 137 | `48897bf8664c` |
| [lib/authSessionClients.ts](../../lib/authSessionClients.ts) | 64 | `016bfc5db481` |
| [lib/authSessionConfig.ts](../../lib/authSessionConfig.ts) | 22 | `e2605d68dbcc` |
| [lib/authSessionMigrationBoundary.test.ts](../../lib/authSessionMigrationBoundary.test.ts) | 101 | `81a51cc76562` |
| [lib/authValidation.test.ts](../../lib/authValidation.test.ts) | 67 | `ccc66f5c4fd4` |
| [lib/authValidation.ts](../../lib/authValidation.ts) | 52 | `ca5ea5d5610a` |
| [lib/authorization-regression.test.ts](../../lib/authorization-regression.test.ts) | 79 | `9c02fbd8b9a9` |
| [lib/completionReceipt.test.ts](../../lib/completionReceipt.test.ts) | 154 | `8595db9684f6` |
| [lib/completionReceipt.ts](../../lib/completionReceipt.ts) | 39 | `59b57677aa0b` |
| [lib/completionReceiptCore.ts](../../lib/completionReceiptCore.ts) | 220 | `b2d84a6f9699` |
| [lib/cookieHttpRoundTrip.test.ts](../../lib/cookieHttpRoundTrip.test.ts) | 328 | `4e3dc3e7a55e` |
| [lib/cookieIntegration.test.ts](../../lib/cookieIntegration.test.ts) | 278 | `94d051f11b7d` |
| [lib/customerConfirmationResendKey.test.ts](../../lib/customerConfirmationResendKey.test.ts) | 79 | `a5f405cacb44` |
| [lib/customerConfirmationResendKey.ts](../../lib/customerConfirmationResendKey.ts) | 59 | `a5103f05ba83` |
| [lib/customerSession.ts](../../lib/customerSession.ts) | 38 | `54959f7a24e2` |
| [lib/format.ts](../../lib/format.ts) | 7 | `5ef28c32f983` |
| [lib/fulfillmentHandoffBatch.test.ts](../../lib/fulfillmentHandoffBatch.test.ts) | 539 | `2e7f6de81dc1` |
| [lib/fulfillmentHandoffBatch.ts](../../lib/fulfillmentHandoffBatch.ts) | 455 | `5503a377d739` |
| [lib/hitpayWebhook.test.ts](../../lib/hitpayWebhook.test.ts) | 96 | `96b951f1bf17` |
| [lib/orderAccess.test.ts](../../lib/orderAccess.test.ts) | 25 | `b6dc6a2ea72d` |
| [lib/orderAccess.ts](../../lib/orderAccess.ts) | 15 | `88de28cdee2f` |
| [lib/orderCapability.test.ts](../../lib/orderCapability.test.ts) | 117 | `e22a727b1a46` |
| [lib/orderCapability.ts](../../lib/orderCapability.ts) | 86 | `0a008bc3f60f` |
| [lib/paymentMethods.ts](../../lib/paymentMethods.ts) | 13 | `eacedf41c67b` |
| [lib/paymentProvider.ts](../../lib/paymentProvider.ts) | 34 | `de0201258a2b` |
| [lib/paymentProviderAdapters.ts](../../lib/paymentProviderAdapters.ts) | 582 | `80de8165d5c5` |
| [lib/phase1SecurityContracts.test.ts](../../lib/phase1SecurityContracts.test.ts) | 41 | `140fb9d91254` |
| [lib/reconciliationSecurity.test.ts](../../lib/reconciliationSecurity.test.ts) | 48 | `659abc5296d2` |
| [lib/reconciliationSecurity.ts](../../lib/reconciliationSecurity.ts) | 52 | `befb7700d84b` |
| [lib/recoveryNamespaceIsolation.test.ts](../../lib/recoveryNamespaceIsolation.test.ts) | 188 | `21f4054fc45d` |
| [lib/recoveryProof.ts](../../lib/recoveryProof.ts) | 190 | `fbb5d78544a1` |
| [lib/rfCoins.ts](../../lib/rfCoins.ts) | 91 | `af03af893c91` |
| [lib/rfCoinsAclContract.test.ts](../../lib/rfCoinsAclContract.test.ts) | 98 | `48375fb8cde6` |
| [lib/rfCoinsPostgres.test.ts](../../lib/rfCoinsPostgres.test.ts) | 850 | `2c7c607543f0` |
| [lib/rfCoinsSqlContract.test.ts](../../lib/rfCoinsSqlContract.test.ts) | 263 | `7361f2b8db25` |
| [lib/rpc-security-regression.test.ts](../../lib/rpc-security-regression.test.ts) | 36 | `8573e30ddd14` |
| [lib/signupVerificationPkce.test.ts](../../lib/signupVerificationPkce.test.ts) | 198 | `9e1f7afaf700` |
| [lib/supabase.ts](../../lib/supabase.ts) | 7 | `0ab4d1f0d3c5` |
| [lib/supabaseAdmin.ts](../../lib/supabaseAdmin.ts) | 6 | `f0d62336092c` |
| [lib/supabaseBrowser.ts](../../lib/supabaseBrowser.ts) | 16 | `59d3742833e3` |
| [lib/supabaseServer.ts](../../lib/supabaseServer.ts) | 48 | `ffbeca09298e` |
| [lib/suppliers/adapter.ts](../../lib/suppliers/adapter.ts) | 302 | `5ccea69d0448` |
| [lib/suppliers/adapters.test.ts](../../lib/suppliers/adapters.test.ts) | 2027 | `b597e23e0da8` |
| [lib/suppliers/fazercards.ts](../../lib/suppliers/fazercards.ts) | 265 | `bd2dd473be29` |
| [lib/suppliers/fulfillment.ts](../../lib/suppliers/fulfillment.ts) | 711 | `327e75f35cda` |
| [lib/suppliers/fulfillmentClientBoundary.test.ts](../../lib/suppliers/fulfillmentClientBoundary.test.ts) | 137 | `7ffde6aaaf8b` |
| [lib/transactionalEmail.ts](../../lib/transactionalEmail.ts) | 130 | `4b7f81a787a9` |
| [lib/transactionalEmailAuth.test.ts](../../lib/transactionalEmailAuth.test.ts) | 47 | `7c84f77df79b` |
| [lib/transactionalEmailAuth.ts](../../lib/transactionalEmailAuth.ts) | 13 | `2d6c52f2f1fc` |
| [lib/transactionalEmailEdgeContract.test.ts](../../lib/transactionalEmailEdgeContract.test.ts) | 40 | `496de3e6f68d` |
| [lib/voucher.ts](../../lib/voucher.ts) | 181 | `dd5ec2d954c8` |
| [middleware.test.ts](../../middleware.test.ts) | 335 | `29a18b186bd6` |
| [netlify.toml](../../netlify.toml) | 6 | `590bb26751c5` |
| [next.config.js](../../next.config.js) | 7 | `aa96a27935bc` |
| [package.json](../../package.json) | 41 | `b27faac74092` |
| [postcss.config.js](../../postcss.config.js) | 5 | `323d21314f4e` |
| [proxy.ts](../../proxy.ts) | 93 | `1f6d3150311f` |
| [scripts/test-github-actions-database-security.sh](../../scripts/test-github-actions-database-security.sh) | 654 | `b1d4b4aa3397` |
| [scripts/test-local-database-security.sh](../../scripts/test-local-database-security.sh) | 5 | `1e45d85fab80` |
| [supabase/config.toml](../../supabase/config.toml) | 32 | `d8bbbc4857b5` |
| [supabase/functions/_shared/completionReceiptCore.ts](../../supabase/functions/_shared/completionReceiptCore.ts) | 220 | `b2d84a6f9699` |
| [supabase/functions/_shared/fulfillmentHandoffWorker.ts](../../supabase/functions/_shared/fulfillmentHandoffWorker.ts) | 318 | `e54bf47c5bba` |
| [supabase/functions/_shared/reconciliationSecurity.ts](../../supabase/functions/_shared/reconciliationSecurity.ts) | 76 | `b602e1165270` |
| [supabase/functions/_shared/transactionalEmailAuth.ts](../../supabase/functions/_shared/transactionalEmailAuth.ts) | 13 | `2d6c52f2f1fc` |
| [supabase/functions/_shared/verification-providers.ts](../../supabase/functions/_shared/verification-providers.ts) | 103 | `3dc77ace8cc1` |
| [supabase/functions/archive-old-orders/index.ts](../../supabase/functions/archive-old-orders/index.ts) | 48 | `dee0b9196964` |
| [supabase/functions/auto-reconciliation/dispatch.test.ts](../../supabase/functions/auto-reconciliation/dispatch.test.ts) | 270 | `d56014dd6d5f` |
| [supabase/functions/auto-reconciliation/index.ts](../../supabase/functions/auto-reconciliation/index.ts) | 232 | `20e556fbb2b4` |
| [supabase/functions/completion-receipt-email-worker/handler.ts](../../supabase/functions/completion-receipt-email-worker/handler.ts) | 79 | `d36daea27d12` |
| [supabase/functions/completion-receipt-email-worker/index.ts](../../supabase/functions/completion-receipt-email-worker/index.ts) | 9 | `a4a243f730a4` |
| [supabase/functions/completion-receipt-email-worker/receiptSnapshot.ts](../../supabase/functions/completion-receipt-email-worker/receiptSnapshot.ts) | 99 | `b6808639c11e` |
| [supabase/functions/completion-receipt-email-worker/testing/engine.integration.test.ts](../../supabase/functions/completion-receipt-email-worker/testing/engine.integration.test.ts) | 286 | `a8850e627be6` |
| [supabase/functions/completion-receipt-email-worker/testing/engine.test.ts](../../supabase/functions/completion-receipt-email-worker/testing/engine.test.ts) | 425 | `592c707541f9` |
| [supabase/functions/completion-receipt-email-worker/testing/engine.ts](../../supabase/functions/completion-receipt-email-worker/testing/engine.ts) | 303 | `2ec9767fcede` |
| [supabase/functions/completion-receipt-email-worker/transportContract.ts](../../supabase/functions/completion-receipt-email-worker/transportContract.ts) | 11 | `0ed2b02dce1d` |
| [supabase/functions/completion-receipt-email-worker/worker.test.ts](../../supabase/functions/completion-receipt-email-worker/worker.test.ts) | 303 | `a985d2915907` |
| [supabase/functions/create-coin-topup-payment/index.ts](../../supabase/functions/create-coin-topup-payment/index.ts) | 289 | `aad47d825af1` |
| [supabase/functions/create-qrph-payment/index.ts](../../supabase/functions/create-qrph-payment/index.ts) | 362 | `6fbcf3db86db` |
| [supabase/functions/fazercards-test/authorization.ts](../../supabase/functions/fazercards-test/authorization.ts) | 13 | `4e9d9295f767` |
| [supabase/functions/fazercards-test/authorization_test.ts](../../supabase/functions/fazercards-test/authorization_test.ts) | 13 | `5ff233cc6dc7` |
| [supabase/functions/fazercards-test/index.ts](../../supabase/functions/fazercards-test/index.ts) | 214 | `f40fcb7514f3` |
| [supabase/functions/fulfillment-handoff/index.ts](../../supabase/functions/fulfillment-handoff/index.ts) | 65 | `12c68a5e360d` |
| [supabase/functions/fulfillment-handoff-v2/index.ts](../../supabase/functions/fulfillment-handoff-v2/index.ts) | 72 | `1a832adba659` |
| [supabase/functions/fulfillment-handoff-v2/worker.test.ts](../../supabase/functions/fulfillment-handoff-v2/worker.test.ts) | 79 | `359eb7d97630` |
| [supabase/functions/payment-webhook/index.ts](../../supabase/functions/payment-webhook/index.ts) | 764 | `35bacd0919d5` |
| [supabase/functions/send-transactional-email/index.ts](../../supabase/functions/send-transactional-email/index.ts) | 394 | `eb9e1ddf787e` |
| [supabase/functions/verify-player/index.ts](../../supabase/functions/verify-player/index.ts) | 204 | `3372d92bff43` |
| [supabase/migrations/20260927062024_runfazone_core_catalog.sql](../../supabase/migrations/20260927062024_runfazone_core_catalog.sql) | 150 | `d67a8b70ebd7` |
| [supabase/migrations/20260927063133_runfazone_vouchers_promos.sql](../../supabase/migrations/20260927063133_runfazone_vouchers_promos.sql) | 148 | `fc4cfb25f726` |
| [supabase/migrations/20260927064634_runfazone_mlbb_packages.sql](../../supabase/migrations/20260927064634_runfazone_mlbb_packages.sql) | 61 | `44654e72217c` |
| [supabase/migrations/20260928042134_runfazone_games_update_policy.sql](../../supabase/migrations/20260928042134_runfazone_games_update_policy.sql) | 10 | `3ca74aaeeaea` |
| [supabase/migrations/20260928051223_admin_games_rpc.sql](../../supabase/migrations/20260928051223_admin_games_rpc.sql) | 48 | `a03fe8d8395a` |
| [supabase/migrations/20260928055204_20260928_apply_games_rpc.sql.sql](../../supabase/migrations/20260928055204_20260928_apply_games_rpc.sql.sql) | 41 | `4c42865a2c9f` |
| [supabase/migrations/20260928055236_20260928_games_with_package_counts_rpc.sql.sql](../../supabase/migrations/20260928055236_20260928_games_with_package_counts_rpc.sql.sql) | 31 | `cdd0815c09a3` |
| [supabase/migrations/20260928060956_20260928_order_fulfillment_payment.sql.sql](../../supabase/migrations/20260928060956_20260928_order_fulfillment_payment.sql.sql) | 102 | `317a48eed269` |
| [supabase/migrations/20260928061342_20260928_order_fulfillment_rls.sql.sql](../../supabase/migrations/20260928061342_20260928_order_fulfillment_rls.sql.sql) | 18 | `af16daf46570` |
| [supabase/migrations/20260928062007_20260928_fix_order_status_rpc.sql.sql](../../supabase/migrations/20260928062007_20260928_fix_order_status_rpc.sql.sql) | 52 | `b292aef6e685` |
| [supabase/migrations/20260928062039_20260928_update_orders_status_check.sql.sql](../../supabase/migrations/20260928062039_20260928_update_orders_status_check.sql.sql) | 28 | `682a1849f974` |
| [supabase/migrations/20260928071820_20260928_order_fulfillment_schema.sql](../../supabase/migrations/20260928071820_20260928_order_fulfillment_schema.sql) | 336 | `c9832b9c13d8` |
| [supabase/migrations/20260928072329_20260928_fix_rpc_ambiguous_column.sql](../../supabase/migrations/20260928072329_20260928_fix_rpc_ambiguous_column.sql) | 69 | `56281769edcd` |
| [supabase/migrations/20260928072356_20260928_fix_rpc_ambiguous_v3.sql](../../supabase/migrations/20260928072356_20260928_fix_rpc_ambiguous_v3.sql) | 66 | `102e1747c760` |
| [supabase/migrations/20260928102030_global_announcement.sql](../../supabase/migrations/20260928102030_global_announcement.sql) | 61 | `05e818e48674` |
| [supabase/migrations/20260928103235_supplier_management_schema.sql](../../supabase/migrations/20260928103235_supplier_management_schema.sql) | 180 | `a5550e574607` |
| [supabase/migrations/20260928111244_payment_system_enhancement.sql](../../supabase/migrations/20260928111244_payment_system_enhancement.sql) | 129 | `c63efb94c557` |
| [supabase/migrations/20260928112701_fix_missing_rls_policies.sql](../../supabase/migrations/20260928112701_fix_missing_rls_policies.sql) | 150 | `15fe8bbe71be` |
| [supabase/migrations/20260928112748_create_generate_order_reference.sql](../../supabase/migrations/20260928112748_create_generate_order_reference.sql) | 38 | `aff586697eb9` |
| [supabase/migrations/20260928120351_admin_manual_status_management.sql](../../supabase/migrations/20260928120351_admin_manual_status_management.sql) | 81 | `e63c7ace6a64` |
| [supabase/migrations/20260928121611_player_verification_tables.sql](../../supabase/migrations/20260928121611_player_verification_tables.sql) | 173 | `cd822ef55dce` |
| [supabase/migrations/20260928124803_honor_of_kings_uid_input_field.sql](../../supabase/migrations/20260928124803_honor_of_kings_uid_input_field.sql) | 2 | `39ba23925522` |
| [supabase/migrations/20260929131301_20260928071820_20260928_order_fulfillment_schema.sql.sql](../../supabase/migrations/20260929131301_20260928071820_20260928_order_fulfillment_schema.sql.sql) | 335 | `56142a12befb` |
| [supabase/migrations/20260929131450_20260928072329_20260928_fix_rpc_ambiguous_column.sql.sql](../../supabase/migrations/20260929131450_20260928072329_20260928_fix_rpc_ambiguous_column.sql.sql) | 69 | `7852e73db385` |
| [supabase/migrations/20260929131511_20260928072356_20260928_fix_rpc_ambiguous_v3.sql.sql](../../supabase/migrations/20260929131511_20260928072356_20260928_fix_rpc_ambiguous_v3.sql.sql) | 66 | `44174263c412` |
| [supabase/migrations/20260929131533_20260928102030_global_announcement.sql.sql](../../supabase/migrations/20260929131533_20260928102030_global_announcement.sql.sql) | 60 | `93b93b96c942` |
| [supabase/migrations/20260929131616_20260928103235_supplier_management_schema.sql.sql](../../supabase/migrations/20260929131616_20260928103235_supplier_management_schema.sql.sql) | 178 | `2ab6d3180029` |
| [supabase/migrations/20260929131654_20260928111244_payment_system_enhancement.sql.sql](../../supabase/migrations/20260929131654_20260928111244_payment_system_enhancement.sql.sql) | 128 | `8b1da85cdc33` |
| [supabase/migrations/20260929131726_20260928112701_fix_missing_rls_policies.sql.sql](../../supabase/migrations/20260929131726_20260928112701_fix_missing_rls_policies.sql.sql) | 150 | `8b18228a81de` |
| [supabase/migrations/20260929131742_20260928112748_create_generate_order_reference.sql.sql](../../supabase/migrations/20260929131742_20260928112748_create_generate_order_reference.sql.sql) | 38 | `221e48b85544` |
| [supabase/migrations/20260929131803_20260928120351_admin_manual_status_management.sql.sql](../../supabase/migrations/20260929131803_20260928120351_admin_manual_status_management.sql.sql) | 81 | `474a41a8c2d4` |
| [supabase/migrations/20260929131835_20260928121611_player_verification_tables.sql.sql](../../supabase/migrations/20260929131835_20260928121611_player_verification_tables.sql.sql) | 173 | `1eb7219492be` |
| [supabase/migrations/20260929131902_20260928124803_honor_of_kings_uid_input_field.sql.sql](../../supabase/migrations/20260929131902_20260928124803_honor_of_kings_uid_input_field.sql.sql) | 24 | `dacefe674479` |
| [supabase/migrations/20260929134014_20260929_admins_identity_and_voucher_code.sql.sql](../../supabase/migrations/20260929134014_20260929_admins_identity_and_voucher_code.sql.sql) | 60 | `8efe8f04f293` |
| [supabase/migrations/20260929134330_20260929_claim_first_admin_rpc.sql.sql](../../supabase/migrations/20260929134330_20260929_claim_first_admin_rpc.sql.sql) | 61 | `34d80be29592` |
| [supabase/migrations/20260929165012_20260929_player_verification_per_game.sql](../../supabase/migrations/20260929165012_20260929_player_verification_per_game.sql) | 29 | `ecc3e396daeb` |
| [supabase/migrations/20260929171739_20260929_orders_lockdown.sql](../../supabase/migrations/20260929171739_20260929_orders_lockdown.sql) | 12 | `ce19cf024dbf` |
| [supabase/migrations/20260929171902_20260929_timeline_submissions_lockdown.sql](../../supabase/migrations/20260929171902_20260929_timeline_submissions_lockdown.sql) | 13 | `d8ceccaf4fde` |
| [supabase/migrations/20260929172540_20260929_voucher_usage_unique.sql](../../supabase/migrations/20260929172540_20260929_voucher_usage_unique.sql) | 3 | `3eca80418e3d` |
| [supabase/migrations/20260929172643_20260929_voucher_usage_dedupe.sql](../../supabase/migrations/20260929172643_20260929_voucher_usage_dedupe.sql) | 2 | `bd8964f39a96` |
| [supabase/migrations/20260929173746_20260929_checkout_security_definer_functions.sql](../../supabase/migrations/20260929173746_20260929_checkout_security_definer_functions.sql) | 220 | `9ca88fef07c4` |
| [supabase/migrations/20260929174039_20260929_restrict_admin_status_rpc.sql](../../supabase/migrations/20260929174039_20260929_restrict_admin_status_rpc.sql) | 5 | `45560d350d04` |
| [supabase/migrations/20260929174347_20260929_fix_create_order_voucher_record.sql](../../supabase/migrations/20260929174347_20260929_fix_create_order_voucher_record.sql) | 139 | `2ca7658cbb3e` |
| [supabase/migrations/20260929174456_20260929_fix_create_order_no_applies_to.sql](../../supabase/migrations/20260929174456_20260929_fix_create_order_no_applies_to.sql) | 134 | `4fb9efa9e8ab` |
| [supabase/migrations/20260929175408_20260929_payment_config_lockdown_and_snapshot.sql](../../supabase/migrations/20260929175408_20260929_payment_config_lockdown_and_snapshot.sql) | 199 | `31567d750feb` |
| [supabase/migrations/20260929175433_20260929_payment_config_admin_functions.sql](../../supabase/migrations/20260929175433_20260929_payment_config_admin_functions.sql) | 117 | `45bcd4a3063b` |
| [supabase/migrations/20260929175842_20260929_payment_config_dedupe_policy.sql](../../supabase/migrations/20260929175842_20260929_payment_config_dedupe_policy.sql) | 2 | `0b4dc4e6e5a1` |
| [supabase/migrations/20260929180041_20260929_fix_search_path_and_deny_vouchers.sql](../../supabase/migrations/20260929180041_20260929_fix_search_path_and_deny_vouchers.sql) | 14 | `3d1f50913b2d` |
| [supabase/migrations/20260929183808_20260929_admin_rls_policies.sql](../../supabase/migrations/20260929183808_20260929_admin_rls_policies.sql) | 164 | `571778f67fff` |
| [supabase/migrations/20260929183838_20260929_admin_rls_policies_remaining_tables.sql](../../supabase/migrations/20260929183838_20260929_admin_rls_policies_remaining_tables.sql) | 247 | `0bca52ad72b4` |
| [supabase/migrations/20261001002025_20261001_create_admin_get_all_payment_config.sql.sql](../../supabase/migrations/20261001002025_20261001_create_admin_get_all_payment_config.sql.sql) | 16 | `6777569aa0ae` |
| [supabase/migrations/20261001031259_20261001_supplier_offer_fields_on_packages.sql](../../supabase/migrations/20261001031259_20261001_supplier_offer_fields_on_packages.sql) | 32 | `be2d3b1b160e` |
| [supabase/migrations/20261001032158_20261001_app_settings_fx_rate.sql](../../supabase/migrations/20261001032158_20261001_app_settings_fx_rate.sql) | 45 | `89f653858512` |
| [supabase/migrations/20261001040225_20261001_separate_order_payment_fulfillment_status.sql](../../supabase/migrations/20261001040225_20261001_separate_order_payment_fulfillment_status.sql) | 258 | `b31ce1ff7b8a` |
| [supabase/migrations/20261001042237_20261001043001_prevent_terminal_status_regression.sql.sql](../../supabase/migrations/20261001042237_20261001043001_prevent_terminal_status_regression.sql.sql) | 50 | `91972b48875b` |
| [supabase/migrations/20261001050007_20261001_fulfillment_advisory_lock.sql](../../supabase/migrations/20261001050007_20261001_fulfillment_advisory_lock.sql) | 65 | `7761441056d5` |
| [supabase/migrations/20261001050031_20261001_fix_fulfillment_lock_key.sql](../../supabase/migrations/20261001050031_20261001_fix_fulfillment_lock_key.sql) | 42 | `c16c83416c03` |
| [supabase/migrations/20261001050049_20261001_fix_fulfillment_lock_v3.sql](../../supabase/migrations/20261001050049_20261001_fix_fulfillment_lock_v3.sql) | 39 | `e36392816caf` |
| [supabase/migrations/20261001050119_20261001_guard_fulfillment_state_transitions.sql](../../supabase/migrations/20261001050119_20261001_guard_fulfillment_state_transitions.sql) | 122 | `d15194ddbdd3` |
| [supabase/migrations/20261001050940_20261001_atomic_fulfillment_claim.sql](../../supabase/migrations/20261001050940_20261001_atomic_fulfillment_claim.sql) | 108 | `edb29ba2766c` |
| [supabase/migrations/20261001064817_20261001_current_mlbb_package_count.sql](../../supabase/migrations/20261001064817_20261001_current_mlbb_package_count.sql) | 58 | `44c5863eafbc` |
| [supabase/migrations/20261001133506_20261001130000_submit_payment_proof_url.sql](../../supabase/migrations/20261001133506_20261001130000_submit_payment_proof_url.sql) | 68 | `647e7b59eae6` |
| [supabase/migrations/20261001144115_20261001140000_submit_payment_set_pending_status.sql.sql](../../supabase/migrations/20261001144115_20261001140000_submit_payment_set_pending_status.sql.sql) | 75 | `5d894c469a5c` |
| [supabase/migrations/20261001165000_20261001170000_order_archive_column_and_function.sql.sql](../../supabase/migrations/20261001165000_20261001170000_order_archive_column_and_function.sql.sql) | 73 | `182138796ec3` |
| [supabase/migrations/20261002141509_20261002090000_fix_orders_status_check_constraint.sql.sql](../../supabase/migrations/20261002141509_20261002090000_fix_orders_status_check_constraint.sql.sql) | 45 | `0c28bbbc7102` |
| [supabase/migrations/20261002154042_20261002160000_capture_supplier_mapping_on_order.sql.sql](../../supabase/migrations/20261002154042_20261002160000_capture_supplier_mapping_on_order.sql.sql) | 181 | `a4b46a04a5c2` |
| [supabase/migrations/20261002160151_20261002170000_supplier_credentials_vault.sql.sql](../../supabase/migrations/20261002160151_20261002170000_supplier_credentials_vault.sql.sql) | 64 | `7caf6a71e332` |
| [supabase/migrations/20261002160236_20261002170100_fix_set_supplier_credential.sql.sql](../../supabase/migrations/20261002160236_20261002170100_fix_set_supplier_credential.sql.sql) | 26 | `cf605c8ad7f7` |
| [supabase/migrations/20261002160317_20261002170200_fix_set_supplier_credential_v2.sql.sql](../../supabase/migrations/20261002160317_20261002170200_fix_set_supplier_credential_v2.sql.sql) | 24 | `4c28860b4e0b` |
| [supabase/migrations/20261002160405_20261002170300_revoke_set_credential_anon.sql.sql](../../supabase/migrations/20261002160405_20261002170300_revoke_set_credential_anon.sql.sql) | 2 | `ac3084e91559` |
| [supabase/migrations/20261002163221_20261002180000_supplier_test_runs.sql.sql](../../supabase/migrations/20261002163221_20261002180000_supplier_test_runs.sql.sql) | 85 | `a692158bdb31` |
| [supabase/migrations/20261002171044_20261002190000_supplier_test_runs_last_polled_at.sql.sql](../../supabase/migrations/20261002171044_20261002190000_supplier_test_runs_last_polled_at.sql.sql) | 18 | `c75e8ce097e2` |
| [supabase/migrations/20261002172324_20261002174000_harden_test_runs_rls.sql.sql](../../supabase/migrations/20261002172324_20261002174000_harden_test_runs_rls.sql.sql) | 37 | `5d3b8c468ae4` |
| [supabase/migrations/20261002184003_20261002200000_supplier_test_runs_rls_crud.sql.sql](../../supabase/migrations/20261002184003_20261002200000_supplier_test_runs_rls_crud.sql.sql) | 57 | `307986acc57c` |
| [supabase/migrations/20261002204046_20261002210000_promotions_placement_columns.sql.sql](../../supabase/migrations/20261002204046_20261002210000_promotions_placement_columns.sql.sql) | 26 | `08776a4967b1` |
| [supabase/migrations/20261005124602_20261005120000_packages_markup_percent.sql.sql](../../supabase/migrations/20261005124602_20261005120000_packages_markup_percent.sql.sql) | 30 | `7eb6f4a3f41a` |
| [supabase/migrations/20261005131450_20261005130000_fix_app_settings_rls_for_admin_writes.sql.sql](../../supabase/migrations/20261005131450_20261005130000_fix_app_settings_rls_for_admin_writes.sql.sql) | 36 | `85c0647dbaee` |
| [supabase/migrations/20261005134605_20261005140000_packages_image_url.sql.sql](../../supabase/migrations/20261005134605_20261005140000_packages_image_url.sql.sql) | 4 | `983a92228162` |
| [supabase/migrations/20261005145751_20261005150000_paymongo_qrph_payment_integration.sql.sql](../../supabase/migrations/20261005145751_20261005150000_paymongo_qrph_payment_integration.sql.sql) | 26 | `c40f0a2edb5b` |
| [supabase/migrations/20261005160417_20261005160000_fix_paymongo_qrph_max_amount_cents.sql.sql](../../supabase/migrations/20261005160417_20261005160000_fix_paymongo_qrph_max_amount_cents.sql.sql) | 24 | `fd7632c97a68` |
| [supabase/migrations/20261006170315_20261006120000_restore_verify_player_public_access.sql.sql](../../supabase/migrations/20261006170315_20261006120000_restore_verify_player_public_access.sql.sql) | 30 | `6928ad89868c` |
| [supabase/migrations/20261006174425_lockdown_payment_transactions_rls.sql](../../supabase/migrations/20261006174425_lockdown_payment_transactions_rls.sql) | 42 | `fd44f36cfb83` |
| [supabase/migrations/20261007182002_20261007120000_voucher_usage_release_on_failed_orders.sql.sql](../../supabase/migrations/20261007182002_20261007120000_voucher_usage_release_on_failed_orders.sql.sql) | 50 | `bf1fb4e17cf6` |
| [supabase/migrations/20261007182206_20261007130000_voucher_game_applicability_and_usage_release.sql.sql](../../supabase/migrations/20261007182206_20261007130000_voucher_game_applicability_and_usage_release.sql.sql) | 196 | `8319b5e36f6c` |
| [supabase/migrations/20261007185408_20261007190000_public_validate_voucher_rpc.sql.sql](../../supabase/migrations/20261007185408_20261007190000_public_validate_voucher_rpc.sql.sql) | 128 | `ac65d1f44fa1` |
| [supabase/migrations/20261007185427_20261007190100_voucher_code_unique_upper.sql.sql](../../supabase/migrations/20261007185427_20261007190100_voucher_code_unique_upper.sql.sql) | 28 | `bf86eae55ead` |
| [supabase/migrations/20261008125709_20261008120000_payment_operator_guard.sql.sql](../../supabase/migrations/20261008125709_20261008120000_payment_operator_guard.sql.sql) | 237 | `d1d8bb5a15dd` |
| [supabase/migrations/20261008125733_20261008120100_revoke_public_grants.sql.sql](../../supabase/migrations/20261008125733_20261008120100_revoke_public_grants.sql.sql) | 26 | `2497d67383e8` |
| [supabase/migrations/20261008134402_20261008140000_orders_realtime_publication.sql.sql](../../supabase/migrations/20261008134402_20261008140000_orders_realtime_publication.sql.sql) | 20 | `0f2e88357c5e` |
| [supabase/migrations/20261008142813_20261008150000_schedule_auto_reconciliation.sql.sql](../../supabase/migrations/20261008142813_20261008150000_schedule_auto_reconciliation.sql.sql) | 71 | `926d11b2de4c` |
| [supabase/migrations/20261008144657_20261008160000_order_timeline_realtime_publication.sql.sql](../../supabase/migrations/20261008144657_20261008160000_order_timeline_realtime_publication.sql.sql) | 6 | `fe1b02c8d8c5` |
| [supabase/migrations/20261009035710_add_payment_config_logo_url.sql.sql](../../supabase/migrations/20261009035710_add_payment_config_logo_url.sql.sql) | 117 | `532869b2084b` |
| [supabase/migrations/20261009154441_20261009_email_sent_log.sql.sql](../../supabase/migrations/20261009154441_20261009_email_sent_log.sql.sql) | 40 | `fd40da1ee479` |
| [supabase/migrations/20261018151838_20261017090000_security_harden_privileged_rpcs.sql](../../supabase/migrations/20261018151838_20261017090000_security_harden_privileged_rpcs.sql) | 269 | `b23838b41e18` |
| [supabase/migrations/20261018151856_20261017091000_revoke_legacy_payment_config_rpc.sql](../../supabase/migrations/20261018151856_20261017091000_revoke_legacy_payment_config_rpc.sql) | 31 | `9518c80a269f` |
| [supabase/migrations/20261018151959_20261017100000_customer_profiles_and_order_ownership.sql](../../supabase/migrations/20261018151959_20261017100000_customer_profiles_and_order_ownership.sql) | 308 | `cd87014cf776` |
| [supabase/migrations/20261018152054_20261017110000_guest_order_access_primitives.sql](../../supabase/migrations/20261018152054_20261017110000_guest_order_access_primitives.sql) | 253 | `7daf0a9ff9f9` |
| [supabase/migrations/20261018152151_20261017111000_customer_order_security_lockdown.sql](../../supabase/migrations/20261018152151_20261017111000_customer_order_security_lockdown.sql) | 275 | `defe4c4ac5cf` |
| [supabase/migrations/20261018152244_20261017120000_atomic_supplier_reconciliation.sql](../../supabase/migrations/20261018152244_20261017120000_atomic_supplier_reconciliation.sql) | 196 | `70dc252efdaf` |
| [supabase/migrations/20261018152301_20261017130000_defer_guest_order_access_fk.sql](../../supabase/migrations/20261018152301_20261017130000_defer_guest_order_access_fk.sql) | 18 | `18056beb774b` |
| [supabase/migrations/20261018152314_20261017140000_revoke_customer_order_direct_writes.sql](../../supabase/migrations/20261018152314_20261017140000_revoke_customer_order_direct_writes.sql) | 7 | `188279c3e31c` |
| [supabase/migrations/20261018152348_20261017140100_customer_confirmation_resend_rate_limit.sql](../../supabase/migrations/20261018152348_20261017140100_customer_confirmation_resend_rate_limit.sql) | 126 | `fe4af9fb32f6` |
| [supabase/migrations/20261018152423_20261017150000_restrict_direct_fulfillment_completion.sql](../../supabase/migrations/20261018152423_20261017150000_restrict_direct_fulfillment_completion.sql) | 95 | `aed235cf4ddc` |
| [supabase/migrations/20261018152514_20261017160000_completion_receipt_outbox.sql](../../supabase/migrations/20261018152514_20261017160000_completion_receipt_outbox.sql) | 229 | `3d30f223561e` |
| [supabase/migrations/20261018152530_20261017170000_authoritative_completion_receipt_data.sql](../../supabase/migrations/20261018152530_20261017170000_authoritative_completion_receipt_data.sql) | 33 | `0b87be1d9b03` |
| [supabase/migrations/20261018152627_20261018090000_secure_completion_receipt_outbox_worker_rpcs.sql](../../supabase/migrations/20261018152627_20261018090000_secure_completion_receipt_outbox_worker_rpcs.sql) | 241 | `54d9d33a2a4c` |
| [supabase/migrations/20261018153746_20261018160000_restore_mlbb_package_count_filter.sql](../../supabase/migrations/20261018153746_20261018160000_restore_mlbb_package_count_filter.sql) | 69 | `7860eae0dde9` |
| [supabase/migrations/20261019014625_20261018160000_rf_coins_schema.sql.sql](../../supabase/migrations/20261019014625_20261018160000_rf_coins_schema.sql.sql) | 479 | `cdb3016355f6` |
| [supabase/migrations/20261019015047_20261018160100_rf_coins_functions.sql.sql](../../supabase/migrations/20261019015047_20261018160100_rf_coins_functions.sql.sql) | 500 | `a3d107acd7cd` |
| [supabase/migrations/20261019015313_20261018160102_rf_coins_admin_adjustments.sql.sql](../../supabase/migrations/20261019015313_20261018160102_rf_coins_admin_adjustments.sql.sql) | 255 | `f2f4696317f4` |
| [supabase/migrations/20261019015353_20261018160103_rf_coins_settings_packages_handoff.sql.sql](../../supabase/migrations/20261019015353_20261018160103_rf_coins_settings_packages_handoff.sql.sql) | 252 | `378e13b78f74` |
| [supabase/migrations/20261019015421_20261018160104_rf_coins_grants.sql.sql](../../supabase/migrations/20261019015421_20261018160104_rf_coins_grants.sql.sql) | 105 | `b7e33c92407d` |
| [supabase/migrations/20261019023739_20261019020000_rf_coins_security_remediation.sql.sql](../../supabase/migrations/20261019023739_20261019020000_rf_coins_security_remediation.sql.sql) | 367 | `34050f1c6214` |
| [supabase/migrations/20261019110000_restrict_order_archive_rpc.sql](../../supabase/migrations/20261019110000_restrict_order_archive_rpc.sql) | 4 | `cc165f381d0a` |
| [supabase/migrations-archive/applied-20261018-duplicates/20261017090000_security_harden_privileged_rpcs.sql](../../supabase/migrations-archive/applied-20261018-duplicates/20261017090000_security_harden_privileged_rpcs.sql) | 276 | `65b53a1f2f1a` |
| [supabase/migrations-archive/applied-20261018-duplicates/20261017091000_revoke_legacy_payment_config_rpc.sql](../../supabase/migrations-archive/applied-20261018-duplicates/20261017091000_revoke_legacy_payment_config_rpc.sql) | 34 | `93ba0ea9ce83` |
| [supabase/migrations-archive/applied-20261018-duplicates/20261017100000_customer_profiles_and_order_ownership.sql](../../supabase/migrations-archive/applied-20261018-duplicates/20261017100000_customer_profiles_and_order_ownership.sql) | 311 | `2523b21d71f4` |
| [supabase/migrations-archive/applied-20261018-duplicates/20261017110000_guest_order_access_primitives.sql](../../supabase/migrations-archive/applied-20261018-duplicates/20261017110000_guest_order_access_primitives.sql) | 256 | `d2ab6e769194` |
| [supabase/migrations-archive/applied-20261018-duplicates/20261017111000_customer_order_security_lockdown.sql](../../supabase/migrations-archive/applied-20261018-duplicates/20261017111000_customer_order_security_lockdown.sql) | 278 | `2c1b3c67766d` |
| [supabase/migrations-archive/applied-20261018-duplicates/20261017120000_atomic_supplier_reconciliation.sql](../../supabase/migrations-archive/applied-20261018-duplicates/20261017120000_atomic_supplier_reconciliation.sql) | 199 | `4981961d6d0d` |
| [supabase/migrations-archive/applied-20261018-duplicates/20261017130000_defer_guest_order_access_fk.sql](../../supabase/migrations-archive/applied-20261018-duplicates/20261017130000_defer_guest_order_access_fk.sql) | 21 | `c15d11aa0d1e` |
| [supabase/migrations-archive/applied-20261018-duplicates/20261017140000_revoke_customer_order_direct_writes.sql](../../supabase/migrations-archive/applied-20261018-duplicates/20261017140000_revoke_customer_order_direct_writes.sql) | 10 | `d5443a88defd` |
| [supabase/migrations-archive/applied-20261018-duplicates/20261017140100_customer_confirmation_resend_rate_limit.sql](../../supabase/migrations-archive/applied-20261018-duplicates/20261017140100_customer_confirmation_resend_rate_limit.sql) | 129 | `80e5f431246d` |
| [supabase/migrations-archive/applied-20261018-duplicates/20261017150000_restrict_direct_fulfillment_completion.sql](../../supabase/migrations-archive/applied-20261018-duplicates/20261017150000_restrict_direct_fulfillment_completion.sql) | 98 | `6e1e6e9b7ff5` |
| [supabase/migrations-archive/applied-20261018-duplicates/20261017160000_completion_receipt_outbox.sql](../../supabase/migrations-archive/applied-20261018-duplicates/20261017160000_completion_receipt_outbox.sql) | 232 | `2eadd67d51fb` |
| [supabase/migrations-archive/applied-20261018-duplicates/20261017170000_authoritative_completion_receipt_data.sql](../../supabase/migrations-archive/applied-20261018-duplicates/20261017170000_authoritative_completion_receipt_data.sql) | 153 | `8d5e5187bb59` |
| [supabase/migrations-archive/applied-20261018-duplicates/20261018090000_secure_completion_receipt_outbox_worker_rpcs.sql](../../supabase/migrations-archive/applied-20261018-duplicates/20261018090000_secure_completion_receipt_outbox_worker_rpcs.sql) | 244 | `76a51bd83ea5` |
| [supabase/migrations-pending/20261028120000_rf_coins_schema.sql](../../supabase/migrations-pending/20261028120000_rf_coins_schema.sql) | 487 | `f2f5120fe048` |
| [supabase/migrations-pending/20261028120100_rf_coins_functions.sql](../../supabase/migrations-pending/20261028120100_rf_coins_functions.sql) | 1187 | `9d02b95f4092` |
| [supabase/migrations-pending/20261028120200_rf_coin_admin_center_read.sql](../../supabase/migrations-pending/20261028120200_rf_coin_admin_center_read.sql) | 390 | `d6ea8c453c41` |
| [supabase/tests/completion-receipt-data-contract.sql](../../supabase/tests/completion-receipt-data-contract.sql) | 246 | `d02f95db2596` |
| [supabase/tests/completion-receipt-outbox-worker.sql](../../supabase/tests/completion-receipt-outbox-worker.sql) | 398 | `6bfed1f33a72` |
| [supabase/tests/completion-receipt-outbox.sql](../../supabase/tests/completion-receipt-outbox.sql) | 390 | `8a05f395e52f` |
| [supabase/tests/customer-auth-foundation.sql](../../supabase/tests/customer-auth-foundation.sql) | 1115 | `97a8de675e70` |
| [supabase/tests/customer-confirmation-resend-concurrency-assertion.sql](../../supabase/tests/customer-confirmation-resend-concurrency-assertion.sql) | 24 | `148f024e2d10` |
| [supabase/tests/customer-confirmation-resend-rate-limit.sql](../../supabase/tests/customer-confirmation-resend-rate-limit.sql) | 175 | `310eeca22abe` |
| [supabase/tests/database/privileged-rpc-security.sql](../../supabase/tests/database/privileged-rpc-security.sql) | 3 | `6727b9a8d449` |
| [supabase/tests/fulfillment-completion-guard.sql](../../supabase/tests/fulfillment-completion-guard.sql) | 205 | `b7d1dc2772c6` |
| [supabase/tests/privileged-rpc-security.sql](../../supabase/tests/privileged-rpc-security.sql) | 495 | `c4da5b95ce95` |
| [supabase/tests/reconciliation-atomicity.sql](../../supabase/tests/reconciliation-atomicity.sql) | 290 | `bbe7861e04c8` |
| [supabase/tests/reconciliation-concurrency-assertion.sql](../../supabase/tests/reconciliation-concurrency-assertion.sql) | 20 | `a564c4f670f2` |
| [supabase/tests/reconciliation-concurrency-cleanup.sql](../../supabase/tests/reconciliation-concurrency-cleanup.sql) | 9 | `7c617140585e` |
| [supabase/tests/reconciliation-concurrency-setup.sql](../../supabase/tests/reconciliation-concurrency-setup.sql) | 51 | `c12c1d7222b4` |
| [tsconfig.json](../../tsconfig.json) | 42 | `644841934e37` |
| [vite.config.ts](../../vite.config.ts) | 19 | `d07690c3f300` |
