# UIUX-007 provisional route acceptance contract

The historical UIUX-007 specification was not recoverable from repository
instructions, branches, commits, or pull requests. This is therefore an
explicitly provisional contract derived from the routes that exist in the
current application. `PARTIAL` means the route has working product UI but
still needs route-specific visual or protected/browser evidence; it is not a
claim that the route is complete.

Evidence references: local test suite (890 passed, 1 skipped), TypeScript,
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
- Appearance controls use one rotating `data-theme-toggle` button, expose the
  current/next mode through an accessible label, and persist across reloads.

The matrix must be updated with new evidence as protected routes are tested;
it must not be silently treated as the missing historical specification.

## Evidence update (protected-journey continuation)

- PR #13 is merged at `886f1f8864acf727ec5649203c5bcd564d6a56c3`.
- PR #14 is intentionally draft at
  `d020440114a2610cd4c8783603ffd9f23e1ee58e`.
- The previous exact-head validation at
  `c759e48fd617387f09e608fb0c86de840d96ac77` had frontend and production
  release safety PASS, but the development run failed in browser acceptance.
  The isolated database assertions passed 6/6 and the application suite passed
  857 tests; the failure was limited to the new route-harness expectations and
  a customer fixture redirect under the large parallel fan-out. The browser
  artifact is available from
  [Development validation run 39862775809](https://github.com/Tedbits99/RFZ-LaunchSite-Dev/actions/runs/39862775809/artifacts/12462688150).
- The current exact-head Frontend validation run `40264513457` and
  Development validation run `40264513560` are terminal SUCCESS. The
  Development run includes successful isolated database/security, browser,
  legacy-upgrade, and production release-safety jobs; its browser result was
  101 passed and 3 skipped.
- The route harness now runs public routes and protected-route denial checks as
  sequential journeys. Public routes passed on both Chromium desktop and
  mobile in the prior run, but this evidence does not promote protected routes
  or prove route-specific CRUD, ownership, payment recovery, or admin
  operational acceptance.
- The matrix remains `5 COMPLETE`, `46 PARTIAL`, and `1 BLOCKED`. The
  authenticated `/secure-admin-login` and admin-order journey is useful
  evidence, but it does not satisfy the full route contract for authorization,
  responsive/theme states, and operational interactions, so it remains
  PARTIAL until the fresh exact-head run completes.
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
- Safe authenticated fixtures remain CI-only: this local environment has no
  approved disposable Supabase credentials or test identities. CI provisions
  and tears down its own isolated stack and synthetic users. No production
  account, secret, or real transaction was used.

## P0 authentication evidence

The current head routes admin sign-in through a server-side endpoint that
verifies the Auth user against the exact `public.admins.id`, normalized email,
active status, and `ADMIN`/`SUPER_ADMIN` role before redirecting to `/admin`.
Native pre-hydration submission and the hydrated JSON flow are both covered by
regression tests. Live owner-admin sign-in, password-reset email delivery,
Auth callback settings, and same-browser/fresh-browser hosted recovery remain
UNVERIFIED because this environment has no authorized live Supabase/Auth
binding or owner mailbox session. The earlier hosted preview result is
historical and is not evidence that this exact head is deployed.

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
