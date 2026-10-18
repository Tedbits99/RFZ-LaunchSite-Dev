# Architecture

## Runtime layers

```text
Browser pages/components
        |
        +-- Supabase browser client (catalog, auth, realtime)
        +-- Next route handlers (/api/*)
                    |
                    +-- anon Supabase client + SECURITY DEFINER RPCs
                    +-- service-role Supabase client for protected server work
                    +-- external PayMongo / FX / FazerCards APIs
        |
        +-- Supabase Edge Functions (QR payment, webhook, reconciliation, email, verification)
        |
        +-- Supabase Postgres tables, RLS, functions, triggers, Realtime
```

## Frontend

The App Router maps folders under [app/](/workspaces/RFZ-LaunchSite/app) to public, account, checkout, game, legal, and admin routes. Most customer pages use client components for forms and polling; catalog/game pages combine server-side Supabase reads with client checkout interactions. Shared navigation/footer and admin UI live under [components/](/workspaces/RFZ-LaunchSite/components).

Styling is utility-first Tailwind with a dark blue/cyan/violet visual system. `app/page.tsx` has fallback catalog content and client-side loading for games/promotions, while game detail pages query the database server-side.

## Backend

Next route handlers under [app/api/](/workspaces/RFZ-LaunchSite/app/api) cover orders, payment, vouchers, promotions, exports, games, suppliers, announcements, and admin operations. The `middleware.ts` Supabase SSR client refreshes auth cookies for all non-static requests. `requireAdmin` independently validates the current user and requires a matching `admins` row.

Supabase Edge Functions are independently deployable workers. They use `Deno.env` and service-role access and are configured with JWT verification disabled in [supabase/config.toml](/workspaces/RFZ-LaunchSite/supabase/config.toml:1), so each function is responsible for its own request/signature/secret validation.

## Data and state

Postgres is authoritative for prices, vouchers, orders, payment state, fulfillment state, and audit timelines. Realtime is enabled for orders and order timelines; the account order detail client combines realtime events with polling. The browser also keeps transient form state for selected package, player inputs, voucher, payment QR, proof, and status.

## Deployment

[netlify.toml](/workspaces/RFZ-LaunchSite/netlify.toml:1) builds with `npx next build` and publishes `.next` through the Netlify Next plugin. [next.config.js](/workspaces/RFZ-LaunchSite/next.config.js:1) limits experimental/build parallelism to one CPU. No CI workflow or infrastructure-as-code files were found in the inspected tree.
