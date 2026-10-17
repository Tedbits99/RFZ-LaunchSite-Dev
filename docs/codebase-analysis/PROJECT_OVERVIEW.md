# RunFazone project overview

## Scope and evidence

This is a read-only analysis of the tracked application source, configuration, Edge Functions, and Supabase migrations present on 2026-10-17. Generated `.next`, `.netlify`, `.git`, dependency, cache, and binary contents were excluded. Findings marked **verified** are directly supported by code; assumptions and gaps are called out explicitly.

## Purpose

RunFazone is a Philippine game-credit top-up storefront. Customers browse active games and packages, enter game/player identifiers, select a payment method, optionally apply a voucher, create an order, submit or complete payment, and track payment and supplier fulfillment. Staff administer the catalog, pricing, promotions, payment configuration, orders, refunds, suppliers, mappings, vouchers, and operational reports.

## Stack

- Next.js 13.5.1 App Router, React 18, TypeScript 5.2.
- Tailwind CSS 3.3 with global CSS in `app/globals.css`; Lucide icons.
- Supabase Auth, Postgres, RLS, Realtime, Storage-compatible URLs, and Edge Functions.
- Netlify deployment via `@netlify/plugin-nextjs`; the project also retains the default Vercel-oriented Next README.
- Vitest is configured as the test runner, with supplier adapter tests in `lib/suppliers/adapters.test.ts`.

## Architectural summary

The browser renders the storefront and admin pages. Server components and route handlers use the Supabase anon client or service-role client depending on the operation. Customer checkout relies on SECURITY DEFINER Postgres functions (`create_order`, `submit_payment`, and voucher validation) to keep authoritative pricing and writes transactional. Admin routes first run `requireAdmin`, then use service-role access where needed. Payment and supplier automation is split between Next route handlers, Supabase Edge Functions, and shared TypeScript modules.

Primary references: [package.json](/workspaces/RFZ-LaunchSite/package.json), [app/layout.tsx](/workspaces/RFZ-LaunchSite/app/layout.tsx:1), [lib/adminGuard.ts](/workspaces/RFZ-LaunchSite/lib/adminGuard.ts:1), [lib/suppliers/fulfillment.ts](/workspaces/RFZ-LaunchSite/lib/suppliers/fulfillment.ts:117), [supabase/config.toml](/workspaces/RFZ-LaunchSite/supabase/config.toml:1).

## Overall assessment

The implemented core is an operational top-up platform, not a complete account product. The strongest, most explicit design is the order/payment/fulfillment state separation and its database RPC guards. The least verified areas are production deployment settings, live secret configuration, actual provider credentials, Supabase project state after all migrations, and whether dormant admin modules are enabled in production.
