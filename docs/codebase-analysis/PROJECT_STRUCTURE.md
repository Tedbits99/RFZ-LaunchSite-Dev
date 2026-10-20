# Project structure

| Path | Responsibility |
|---|---|
| [app/](/workspaces/RFZ-LaunchSite/app) | App Router pages, layouts, styles, metadata, and API route handlers |
| [app/admin/](/workspaces/RFZ-LaunchSite/app/admin) | Admin dashboard and management pages for catalog, orders, payments, suppliers, promotions, risk, staff, and operations |
| [app/api/](/workspaces/RFZ-LaunchSite/app/api) | HTTP APIs used by customer/admin clients and webhook bridges |
| [app/games/](/workspaces/RFZ-LaunchSite/app/games) | Game catalog detail and top-up flow |
| [components/](/workspaces/RFZ-LaunchSite/components) | Storefront and admin shared components |
| [lib/](/workspaces/RFZ-LaunchSite/lib) | Supabase clients, guards, formatting, payments, vouchers, suppliers, email |
| [supabase/functions/](/workspaces/RFZ-LaunchSite/supabase/functions) | Deno Edge Functions for verification, QR payments, webhooks, reconciliation, archival, and email |
| [supabase/migrations/](/workspaces/RFZ-LaunchSite/supabase/migrations) | 2026 schema, RPC, RLS, status, payment, voucher, supplier, and Realtime evolution |
| [public/](/workspaces/RFZ-LaunchSite/public) | Logos, favicons, and static image assets |
| [docs/](/workspaces/RFZ-LaunchSite/docs) | Existing voucher notes plus this analysis knowledge base |

## Configuration

[.env.example](/workspaces/RFZ-LaunchSite/.env.example:1) lists public Supabase URL/key, server service key, app URL/auth secret, payment credentials, storage, supplier credentials, and Edge Function SMTP notes. Values are intentionally not reproduced here.

## Source inventory

The inspected non-generated tree contains approximately 230 files. It includes 80+ SQL migration files, 40+ API/page/client TypeScript files, seven Edge Functions plus shared verification providers, and one focused supplier adapter test file. Migration filenames with a second `.sql` suffix are part of the repository history and should be treated as potentially replayed/duplicate migration artifacts until verified against the live Supabase migration table.
