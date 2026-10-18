# Routes and pages

## Customer routes

| Route | Purpose |
|---|---|
| `/` | Storefront hero, game catalog, promotions, FAQ/contact sections |
| `/games/[slug]` | Game details, package selection, player fields, verification, voucher, payment/order form |
| `/checkout?ref=` | Payment instructions/status and QR/manual payment continuation |
| `/track-order` | Reference/email order lookup and live timeline/status |
| `/account`, `/account/orders`, `/account/orders/[id]`, `/account/profile` | Guest-style account/order views; authentication integration is incomplete |
| `/login`, `/register`, `/forgot-password`, `/secure-admin-login` | Auth UI; only secure admin login has a verified Supabase sign-in flow |
| `/copyright-disclaimer`, `/payment-policy`, `/privacy-policy`, `/refund-policy`, `/terms-of-service` | Legal pages |
| `/robots.txt`, `/sitemap.xml` | Metadata routes |

## Admin routes

`/admin` and its nested pages cover activity log, analytics, announcements, approvals, blocklist, bulk pricing, customers, export, games/packages, ML offer pricing, notifications, orders/detail, payments, pricing, promotions, reconciliation, refunds, risk alerts, roles, security, settings, staff, suppliers/catalog/test orders, system health, tasks, tickets, and vouchers. [app/admin/layout.tsx](/workspaces/RFZ-LaunchSite/app/admin/layout.tsx:1) supplies the admin shell; [components/admin/navData.ts](/workspaces/RFZ-LaunchSite/components/admin/navData.ts:1) defines navigation.

## API route inventory

Customer APIs: `/api/games`, `/api/orders`, `/api/orders/lookup`, `/api/orders/[id]/status-check`, `/api/orders/[id]/timeline`, `/api/orders/create-payment`, `/api/orders/create-qrph-payment`, `/api/orders/qrph-status`, `/api/orders/submit-payment`, `/api/payment-config`, `/api/promotions`, `/api/announcement`, `/api/vouchers/validate`, `/api/webhooks/payment`, and `/api/export`.

Admin APIs: `/api/admin/orders` and detail actions, `/api/admin/fx-rate`, `/api/admin/package-pricing`, `/api/admin/settings`, `/api/admin/sync-offers`, `/api/admin/vouchers`, `/api/games` mutation, `/api/payment-config` mutation, and supplier CRUD/actions/mappings/test-runs/transactions.

The authoritative method and database access for each endpoint is documented by its `route.ts`. Most sensitive admin routes call `requireAdmin`, but the current source has notable exceptions: [app/api/admin/orders/route.ts](/workspaces/RFZ-LaunchSite/app/api/admin/orders/route.ts:1), [app/api/suppliers/route.ts](/workspaces/RFZ-LaunchSite/app/api/suppliers/route.ts:1), and [app/api/suppliers/actions/route.ts](/workspaces/RFZ-LaunchSite/app/api/suppliers/actions/route.ts:1) do not call it directly and require separate RLS/deployment review.
