# Dependencies and integrations

## Direct dependencies

Next/React/React DOM provide rendering and routing; `@supabase/ssr` handles cookie-aware auth clients; `@supabase/supabase-js` handles database/Auth/Realtime; Tailwind/PostCSS/autoprefixer provide CSS; Lucide provides icons; TypeScript and ESLint provide static tooling; Vitest/Vite provide tests.

## External services

- Supabase Postgres/Auth/Realtime/Edge Functions.
- PayMongo QR Ph payment APIs and webhook signatures.
- FazerCards (`api.fzr.cards`) for catalog, account validation, top-up creation, and status.
- `open.er-api.com` for admin USD→PHP rate lookup.
- Titan SMTP through the email Edge Function.
- Cloudinary/static HTTPS image URLs are supported by promotion/package image fields.
- Netlify hosts the Next build; provider account configuration is outside the repository.

## High-impact internal modules

[lib/adminGuard.ts](/workspaces/RFZ-LaunchSite/lib/adminGuard.ts:73) affects every admin API. [lib/supabaseServer.ts](/workspaces/RFZ-LaunchSite/lib/supabaseServer.ts:15) and [middleware.ts](/workspaces/RFZ-LaunchSite/middleware.ts:4) affect authentication cookies. [lib/suppliers/fulfillment.ts](/workspaces/RFZ-LaunchSite/lib/suppliers/fulfillment.ts:117) controls supplier side effects and status transitions. [lib/voucher.ts](/workspaces/RFZ-LaunchSite/lib/voucher.ts:42) and the SQL checkout RPC jointly define discount behavior. Payment route handlers, QR/webhook Edge Functions, and the provider adapter interfaces are coupled around payment transaction/status semantics.

## Coupling/duplication observations

There are two payment integration layers: a legacy/simple `PaymentProvider` that currently always resolves to mock, and a richer adapter contract plus PayMongo-specific Edge Functions. Supplier fulfillment is implemented in Next server code and mirrored in the payment webhook Edge Function. Any future change to payment or fulfillment must update both paths and their database RPC/status assumptions.

No confirmed circular imports were found by source inspection; TypeScript is used without a generated database type file, so several modules use `any` casts around Supabase joins.
