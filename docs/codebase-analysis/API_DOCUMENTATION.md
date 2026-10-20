# API documentation

## Order lifecycle endpoints

1. `POST /api/orders` validates request shape and calls Postgres `create_order`; the RPC validates active package/game fields, computes cents, applies voucher rules, inserts the order and timeline, and returns reference/id/total.
2. `POST /api/orders/submit-payment` calls `submit_payment` after reference/email matching and records a proof/reference submission.
3. `POST /api/orders/create-payment` is the generic provider abstraction path. The current [paymentProvider.ts](/workspaces/RFZ-LaunchSite/lib/paymentProvider.ts:1) returns the mock provider for every configured name; concrete adapters are separately defined in [paymentProviderAdapters.ts](/workspaces/RFZ-LaunchSite/lib/paymentProviderAdapters.ts:1).
4. `POST /api/orders/create-qrph-payment` forwards to the `create-qrph-payment` Edge Function.
5. `GET /api/orders/qrph-status` reads current QR/payment transaction state.
6. `GET /api/orders/lookup`, `/api/orders/[id]/status-check`, and `/api/orders/[id]/timeline` authenticate by order reference/email and expose customer-safe status/timeline data.

## Admin and operational endpoints

Admin order routes load order, timeline, payment submission, supplier transaction, verify payment through `verify_payment`, manually transition allowed states through `admin_change_order_status`, start/retry/poll fulfillment, and create refund records. Pricing/settings routes update packages, FX rate settings, and payment config. Supplier routes manage suppliers, package mappings, test runs, transactions, catalog sync, and FazerCards test operations.

## Edge APIs

- `verify-player`: provider-specific player identity validation using game configuration.
- `create-qrph-payment`: creates/reuses a PayMongo QR payment transaction, validates order state/amount, and stores provider data.
- `payment-webhook`: validates PayMongo signature, handles paid/failed/idempotent events, verifies payment, and may trigger supplier fulfillment.
- `auto-reconciliation`: polls pending supplier transactions and transitions fulfillment.
- `archive-old-orders`: invokes the old-unpaid archive RPC.
- `fazercards-test`: admin operational probe for balance/catalog/order/status.
- `send-transactional-email`: deduplicates templates and sends SMTP email.

## Error model

Route handlers generally return JSON `{ error }` with 400/401/403/404/500/502/503. Database/RPC errors are translated to stable customer/admin messages; development-only logs may include Supabase error messages. No shared schema validator library was found; validation is hand-written in routes, clients, and SQL functions.
