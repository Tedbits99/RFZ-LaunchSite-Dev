# UIUX-007 provisional route acceptance contract

The historical UIUX-007 specification was not recoverable from repository
instructions, branches, commits, or pull requests. This is therefore an
explicitly provisional contract derived from the routes that exist in the
current application. `PARTIAL` means the route has working product UI but
still needs route-specific visual or protected/browser evidence; it is not a
claim that the route is complete.

Evidence references: local test suite (857 passed, 1 skipped), TypeScript,
lint, Next/OpenNext builds, the public browser smoke run documented in the
task report, and the exact-head GitHub validations listed below. Protected
routes require configured Supabase credentials and an authorized test account
before browser acceptance can be promoted.

| Route | Purpose/access | Current classification | Remaining acceptance evidence |
| --- | --- | --- | --- |
| `/` | Storefront, public | PARTIAL | Theme/responsive browser pass; external announcement API is 503 locally |
| `/games/[slug]` | Game/product detail, public | PARTIAL | Authenticated catalog/package fixtures and mobile interaction evidence |
| `/checkout` | Checkout, public/session | PARTIAL | Payment-provider-safe browser journey and recovery states |
| `/track-order` | Guest tracking, public | PARTIAL | Browser pass; real lookup/access-code fixtures unavailable |
| `/login`, `/register` | Customer auth, public | PARTIAL | Auth-provider acceptance and recovery journey |
| `/forgot-password`, `/auth/confirmation`, `/auth/reset-password` | Auth recovery, public | PARTIAL | Email/provider-backed browser evidence |
| `/secure-admin-login` | Admin auth, public | BLOCKED | Authorized admin fixture required |
| `/account`, `/account/orders`, `/account/orders/[id]`, `/account/profile`, `/account/wallet` | Customer account, authenticated | PARTIAL | Authorized customer fixture and ownership denial evidence |
| `/copyright-disclaimer`, `/payment-policy`, `/privacy-policy`, `/refund-policy`, `/terms-of-service` | Legal, public | COMPLETE | Public browser smoke coverage |
| `/admin` | Admin dashboard, admin | PARTIAL | Authorized admin browser evidence |
| `/admin/orders`, `/admin/orders/[id]` | Order operations, admin | PARTIAL | Authorized status/action matrix and responsive table evidence |
| `/admin/games`, `/admin/games/[id]/packages` | Catalog management, admin | PARTIAL | Authorized CRUD and small-screen evidence |
| `/admin/pricing`, `/admin/bulk-pricing`, `/admin/vouchers` | Pricing/catalog controls, admin | PARTIAL | Permission and validation matrix |
| `/admin/customers`, `/admin/staff`, `/admin/roles` | Customer/staff access, admin | PARTIAL | Role/ownership browser evidence |
| `/admin/announcements`, `/admin/notifications`, `/admin/promotions` | Marketing controls, admin | PARTIAL | Configured database and form-state evidence |
| `/admin/approvals`, `/admin/tickets`, `/admin/tasks`, `/admin/blocklist` | Operations, admin | PARTIAL | Authorized empty/error/action states |
| `/admin/suppliers`, `/admin/suppliers/fazercards-catalog`, `/admin/suppliers/controlled-test-order`, `/admin/ml-offer-pricing` | Supplier operations, admin | PARTIAL | Sandbox-only fixtures and permission evidence |
| `/admin/payments`, `/admin/reconciliation`, `/admin/refunds`, `/admin/export` | Finance operations, admin | PARTIAL | Safe read-only fixtures and export validation |
| `/admin/analytics`, `/admin/activity-log`, `/admin/risk-alerts`, `/admin/system-health`, `/admin/security`, `/admin/settings` | Reports/system, admin | PARTIAL | Authorized data and service-state evidence |

## Implemented in this continuation

- Shared admin shell, navigation, page headers, metrics, panels, inputs and
  empty states now consume semantic Light/Dark/Night tokens.
- Global and admin loading/error boundaries provide retry-safe recovery UI.
- Guest tracking has labeled inputs, autocomplete metadata, live errors and
  theme-aware styling.
- Appearance controls expose stable `data-theme-option` hooks and persist
  across reloads.

The matrix must be updated with new evidence as protected routes are tested;
it must not be silently treated as the missing historical specification.

## Evidence update (protected-journey continuation)

- PR #13 is merged at `886f1f8864acf727ec5649203c5bcd564d6a56c3`.
- PR #14 is intentionally draft at
  `57d18b0b3507a9d8b8916cbe246a508407d046ac`.
- Exact-head PR #14 validation is terminal SUCCESS:
  [Frontend validation run 39836563824](https://github.com/Tedbits99/RFZ-LaunchSite-Dev/actions/runs/39836563824),
  [Development validation run 39836563924](https://github.com/Tedbits99/RFZ-LaunchSite-Dev/actions/runs/39836563924),
  including the [isolated Supabase security job](https://github.com/Tedbits99/RFZ-LaunchSite-Dev/actions/runs/39836563924/job/120026334239)
  and [production release safety job](https://github.com/Tedbits99/RFZ-LaunchSite-Dev/actions/runs/39836563924/job/120026333758).
  Supabase Preview is SKIPPED by integration design.
- Authenticated browser acceptance passed on exact head
  `3f27aa57f2f98eabfdaff8202ef3db279fe8da5f` in
  [Development validation run 39855425560](https://github.com/Tedbits99/RFZ-LaunchSite-Dev/actions/runs/39855425560):
  6 Playwright tests passed across Chromium desktop and mobile projects.
  This covers Customer A sign-in, account navigation, session persistence,
  protected-route denial after cookie removal, administrator sign-in and
  orders navigation, plus checkout rendering without a transaction. The
  [browser artifact](https://github.com/Tedbits99/RFZ-LaunchSite-Dev/actions/runs/39855425560/artifacts/12460245018)
  contains the generated report and traces/screenshots policy permits.
- The browser pass does not promote every route: the matrix remains
  `5 COMPLETE`, `46 PARTIAL`, and `1 BLOCKED` because route-specific CRUD,
  ownership fixtures with private orders, payment recovery states, and some
  admin operational pages still lack dedicated acceptance journeys.
- Playwright same-origin smoke coverage passed public routes at mobile and
  desktop sizes, including Light/Dark/Night selection, reload persistence,
  and keyboard focus. A reproducible desktop artifact was written to
  `/tmp/rfz-uiux007-home-desktop.png`.
- `/account*` correctly resolves to `/login` without a customer session.
  Admin routes render the retry-safe admin error boundary without configured
  admin/Supabase credentials. This is denial/recovery evidence, not an
  authorized admin journey pass.
- `/api/announcement` returns HTTP 503 when Supabase is intentionally
  unconfigured. The route explicitly returns `Database not configured`, and
  the storefront popup safely remains hidden. A configured isolated Supabase
  environment is required to test success and admin write scenarios.
- Safe authenticated fixtures are BLOCKED locally: this environment has no
  Supabase CLI/runtime, approved disposable project credentials, or test
  identities. The CI security job provisions and tears down its own isolated
  Supabase stack and passed its database/RLS assertions, but it does not
  provide browser session identities for this local acceptance run. No
  production account, secret, or real transaction was used.

## Route identifiers covered by this matrix

The 52 page files are: `/`, `/account`, `/account/orders`,
`/account/orders/[id]`, `/account/profile`, `/account/wallet`,
`/admin`, `/admin/activity-log`, `/admin/analytics`, `/admin/announcements`,
`/admin/approvals`, `/admin/blocklist`, `/admin/bulk-pricing`,
`/admin/customers`, `/admin/export`, `/admin/games`,
`/admin/games/[id]/packages`, `/admin/ml-offer-pricing`,
`/admin/notifications`, `/admin/orders`, `/admin/orders/[id]`,
`/admin/payments`, `/admin/pricing`, `/admin/promotions`,
`/admin/reconciliation`, `/admin/refunds`, `/admin/risk-alerts`,
`/admin/roles`, `/admin/security`, `/admin/settings`, `/admin/staff`,
`/admin/suppliers`, `/admin/suppliers/controlled-test-order`,
`/admin/suppliers/fazercards-catalog`, `/admin/system-health`, `/admin/tasks`,
`/admin/tickets`, `/admin/vouchers`, `/auth/confirmation`,
`/auth/reset-password`, `/checkout`, `/copyright-disclaimer`,
`/forgot-password`, `/games/[slug]`, `/login`, `/payment-policy`,
`/privacy-policy`, `/register`, `/refund-policy`, `/secure-admin-login`,
`/terms-of-service`, and `/track-order`.
