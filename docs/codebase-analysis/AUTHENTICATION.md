# Authentication and authorization

## Customer

The verified customer-facing checkout and tracking flows are guest/email based. Order lookup requires reference plus email in API routes. Supabase browser Auth is available and the secure admin login uses `signInWithPassword`, but the ordinary login/register pages post to `/api/auth`, and no matching route was found in the inspected tree. The account pages therefore do not constitute a verified authenticated customer area.

## Admin

`middleware.ts` refreshes Supabase Auth cookies. `requireAdmin` calls `auth.getUser`, looks up the user ID in `admins`, and returns 401/403/500 as appropriate. Admin pages use the admin layout/guarding conventions, and most admin APIs call the same guard. Current exceptions include the orders list route and supplier CRUD/actions routes, which do not call `requireAdmin` directly and must be treated as authorization gaps until verified through effective RLS/deployment configuration. `hasRole` exists, but most guarded route handlers only require an admin row; route-level role enforcement was not broadly evidenced.

## Secrets

The browser receives only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Service role, payment, supplier, SMTP, and webhook secrets are intended for server/Edge environments. Supabase Vault is used by later migrations for supplier credentials. Secret values were not read or reproduced.

## Confirmed security concerns

- [supabase/migrations/20260927063133_runfazone_vouchers_promos.sql](/workspaces/RFZ-LaunchSite/supabase/migrations/20260927063133_runfazone_vouchers_promos.sql:123) defines “own” support-ticket reads using only `length(email) > 3`, without comparing the caller to the ticket email; notifications use `USING (true)`. Later migration state may supersede this, but it must be verified in the live database.
- The initial supplier schema grants anon/authenticated broad CRUD policies ([20260928103235... schema](/workspaces/RFZ-LaunchSite/supabase/migrations/20260928103235_supplier_management_schema.sql:110)); later hardening adds admin policies but the inspected files do not prove every earlier broad policy was dropped.
- Edge Functions have `verify_jwt = false` in [supabase/config.toml](/workspaces/RFZ-LaunchSite/supabase/config.toml:1); webhook signatures and function-specific authorization are therefore critical deployment controls.
- `/account/orders?email=` is an email-only history lookup in [app/account/orders/page.tsx](/workspaces/RFZ-LaunchSite/app/account/orders/page.tsx:34). This is a privacy risk unless live RLS/service-client behavior and threat model explicitly accept it.

These are findings to validate and fix in a separate authorized change; no remediation was made during this analysis.
