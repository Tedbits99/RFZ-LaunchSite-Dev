# RunFazone development instructions

## Project shape

RunFazone is a Next.js 13 App Router + React 18 + strict TypeScript application using Tailwind CSS and Supabase Postgres/Auth/Realtime/Edge Functions. Netlify builds it with `npx next build`. Start with the detailed [codebase analysis](/workspaces/RFZ-LaunchSite/docs/codebase-analysis/), especially [ARCHITECTURE.md](/workspaces/RFZ-LaunchSite/docs/codebase-analysis/ARCHITECTURE.md), [DATA_FLOW.md](/workspaces/RFZ-LaunchSite/docs/codebase-analysis/DATA_FLOW.md), and [CHANGE_IMPACT_GUIDE.md](/workspaces/RFZ-LaunchSite/docs/codebase-analysis/CHANGE_IMPACT_GUIDE.md) before any significant task.

Important areas:

- [app/](/workspaces/RFZ-LaunchSite/app): App Router pages, layouts, customer flows, admin pages, and `/api/*` route handlers.
- [components/](/workspaces/RFZ-LaunchSite/components): shared storefront/admin UI.
- [lib/](/workspaces/RFZ-LaunchSite/lib): Supabase clients, admin guard, vouchers, payments, suppliers, and email.
- [supabase/functions/](/workspaces/RFZ-LaunchSite/supabase/functions): Deno workers for verification, QR payments, webhooks, reconciliation, archival, and email.
- [supabase/migrations/](/workspaces/RFZ-LaunchSite/supabase/migrations): schema, RPC, RLS, status, payment, supplier, voucher, and Realtime changes.

## Coding conventions

- Use strict TypeScript, `@/*` imports, existing folder-based App Router conventions, and the project’s existing Tailwind dark visual system.
- Keep money as integer cents; format only at the UI boundary. Never trust browser prices, discounts, payment status, or supplier status.
- Prefer small typed components and existing helpers over new duplicate implementations. Match nearby code style and preserve existing loading/error states.
- Use server components for server-side reads where established; use `'use client'` only for interactive state, browser Auth, polling, or Realtime.
- Reuse shared components such as [AdminPage](/workspaces/RFZ-LaunchSite/components/admin/AdminPage.tsx:3), [PageHeader](/workspaces/RFZ-LaunchSite/components/admin/ui.tsx:4), [SiteFooter](/workspaces/RFZ-LaunchSite/components/SiteFooter.tsx:1), [AnnouncementPopup](/workspaces/RFZ-LaunchSite/components/AnnouncementPopup.tsx:19), and shared payment/format helpers before adding equivalents.
- Keep provider-specific behavior behind the existing supplier/payment adapter boundaries. Do not silently introduce a second payment or fulfillment path.
- Do not expose secrets, service-role keys, raw credentials, or sensitive upstream payloads to the browser or documentation.

## Authentication and database safety

- Public browser code may use only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Keep service-role and provider secrets server-side/Edge-only.
- Admin pages check the `admins` table, and most protected APIs use [requireAdmin](/workspaces/RFZ-LaunchSite/lib/adminGuard.ts:73). Always review authorization and effective RLS before changing an admin/API route.
- Current source exceptions require special scrutiny: [app/api/admin/orders/route.ts](/workspaces/RFZ-LaunchSite/app/api/admin/orders/route.ts:1), [app/api/suppliers/route.ts](/workspaces/RFZ-LaunchSite/app/api/suppliers/route.ts:1), and [app/api/suppliers/actions/route.ts](/workspaces/RFZ-LaunchSite/app/api/suppliers/actions/route.ts:1) do not call `requireAdmin` directly.
- Treat Postgres RPCs, RLS policies, status constraints, and migrations as production-critical. Read the full chronological migration context; duplicated/suffixed migration filenames make live Supabase state important to verify.
- Preserve `create_order`, `verify_payment`, `complete_fulfillment`, voucher usage uniqueness, supplier idempotency, captured supplier mappings, and terminal-state protections when changing checkout/order flows.
- Never trigger supplier fulfillment unless payment is verified. Preserve atomic claim/idempotency behavior to prevent duplicate top-ups.
- Edge Functions have JWT verification disabled in [supabase/config.toml](/workspaces/RFZ-LaunchSite/supabase/config.toml:1); preserve explicit signature/authorization checks and validate webhook amounts, event IDs, and order state.

## Commands and validation

```bash
npm run dev       # local development
npm run build     # production build
npm run start     # run the production build
npm run lint      # Next/ESLint checks
npm test          # Vitest suite
```

For changes, run the narrowest relevant tests plus `npm run lint` and `npm run build` when practical. Validate customer, unauthenticated, authenticated non-admin, and intended admin paths. For database/security changes, test anon/authenticated/service-role behavior against staging and inspect deployed Edge secrets, schedules, webhook configuration, and provider sandbox behavior.

## Change impact

Before changing checkout, payment, fulfillment, auth/RLS, or order states, follow [CHANGE_IMPACT_GUIDE.md](/workspaces/RFZ-LaunchSite/docs/codebase-analysis/CHANGE_IMPACT_GUIDE.md). High-blast-radius code includes [middleware.ts](/workspaces/RFZ-LaunchSite/middleware.ts:4), [adminGuard.ts](/workspaces/RFZ-LaunchSite/lib/adminGuard.ts:73), order/payment RPC migrations, [fulfillment.ts](/workspaces/RFZ-LaunchSite/lib/suppliers/fulfillment.ts:117), order APIs, and payment/webhook Edge Functions.

Update related UI labels, API allow-lists, SQL transitions, timeline entries, emails, Realtime behavior, polling, and reconciliation together. Inspect actual source before editing, avoid unrelated refactors, preserve existing behavior, and document any remaining uncertainty. Do not modify application code when the task is analysis/documentation-only.
