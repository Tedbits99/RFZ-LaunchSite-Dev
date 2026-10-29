# Authentication and authorization

Reviewed for the PR #82 recovery on 2026-10-29. This describes the reviewed source; it does not assert that the candidate or its pending migrations have been deployed. See [owner acceptance](../../OWNER_ACCEPTANCE.md) for candidate-bound validation and remaining gates.

## Components and trust boundaries

| Component | Responsibility |
| --- | --- |
| [Session configuration](../../lib/authSessionConfig.ts) | Separate customer, admin and recovery cookie names. |
| [Browser clients](../../lib/authSessionBrowserClients.ts) and [server clients](../../lib/authSessionClients.ts) | Supabase SSR clients using the matching namespace; browser instances are not singletons. |
| [Next.js proxy](../../proxy.ts) | Refresh existing customer/admin and legacy sessions and forward refreshed cookies to the same request and response. It does not authorize access. Recovery is handled by its dedicated flow. |
| [Customer session guard](../../lib/customerSession.ts) | Require a provider-verified Auth user, confirmed email and an active RLS-backed customer profile. It never substitutes the service-role client for customer ownership checks. |
| [Admin guard](../../lib/adminGuard.ts) | Verify the admin Auth session and require an active `admins` mapping; privileged surfaces additionally enforce the required role. |
| [Recovery proof](../../lib/recoveryProof.ts) | Bind password-reset completion to a verified recovery user and session with a short-lived signed cookie. |
| [Server privileged client](../../lib/supabaseAdmin.ts) | Privileged database access after the caller's authorization checks. Its credential is not a browser credential or a substitute for authenticating the caller. |

The namespaces are `rfz-customer-auth`, `rfz-admin-auth` and `rfz-recovery-auth`. The signed completion proof is `rfz-recovery-proof`. Customer login/logout and password recovery must not silently overwrite or sign out the admin namespace, and a customer Auth identity alone is not an admin authorization grant.

## Customer request flow

1. Registration posts to [`/api/auth/register`](../../app/api/auth/register/route.ts), validates input and delegates password handling to Supabase Auth. Duplicate registrations receive a generic acceptance response. An unexpected pre-confirmation session fails closed.
2. Confirmation reaches [`/auth/callback`](../../app/auth/callback/route.ts). The callback uses the configured application origin and the appropriate token-hash or PKCE exchange. Confirmed customers activate through the constrained customer-profile flow; a browser-supplied identity does not establish ownership.
3. Login posts to [`/api/auth/login`](../../app/api/auth/login/route.ts). It requires the configured request Origin, validates credentials with `signInWithPassword`, verifies the resulting user with `getUser`, checks confirmation/profile state and rejects suspended or deactivated accounts. Session writes stay in the customer namespace.
4. Account pages/APIs call `getActiveCustomerSession`. For example, [`/account/orders`](../../app/account/orders/page.tsx) filters by immutable `customer_user_id = session.user.id` through the customer's RLS-backed client. Supplying another email in the URL does not authorize another customer's account history.
5. Subsequent requests carry the namespace cookie. The proxy forwards any refresh changes into the current request as well as the response. The protected route still verifies the session and authorization; cookie presence or a decoded JWT alone is insufficient.

Guest order tracking/recovery is a separate, constrained reference-and-proof flow. It is not customer-account authentication, and old guest orders are not automatically claimed solely because their email matches a newly authenticated account.

## Admin request flow

[`/secure-admin-login`](../../app/secure-admin-login/page.tsx) signs in through the admin browser client, then [the admin login flow](../../lib/adminLoginFlow.ts) checks the active mapping and allowed role. [The admin layout](../../app/admin/layout.tsx) and API guards recheck authorization server-side. Customer cookies are not accepted as admin cookies. The hydrated sign-in form does not wait for its optional session probe, and logout-return URLs skip that optimization; this affects navigation only and grants no authorization. The RF Coins Admin Center requires active Super Admin authorization; nonprivileged staff/customer denial is tested independently.

Most admin APIs use `requireAdmin`; reviewed supplier CRUD/action and order-list routes now invoke it. A role returned by browser state is not authoritative. Privileged database clients may bypass RLS where permitted, so guards must precede their use. Database table privileges still apply: `service_role` lacking SELECT can produce SQLSTATE 42501 even when it bypasses RLS.

## Password recovery and token handling

The recovery flow uses its own Supabase namespace and PKCE storage. A successful recovery callback verifies the user, then issues an HMAC-SHA256 completion proof. It binds the verified user, password-reset purpose, absolute expiry and a SHA-256 fingerprint of the stable Supabase `session_id` claim. Binding to the stable session allows legitimate JWT refresh without authorizing a different session. The JWT is verified with Supabase before its claim is used for this binding.

The proof cookie is HttpOnly, Secure, SameSite=Lax, scoped to `/auth/reset-password` and limited to ten minutes. It contains signed claims, not a password, bearer JWT, PKCE verifier or signing secret. The signing secret `RFZ_RECOVERY_PROOF_HMAC_SECRET` stays server-side and must be at least 32 bytes. The proof grants nothing without the matching verified recovery session.

[`/auth/reset-password/complete`](../../app/auth/reset-password/complete/route.ts) checks origin, recovery session/user and the proof before calling Auth `updateUser`. Completion clears the recovery state; one-time-link reuse, missing proof, different-user/session proofs and old-password login are rejected. Normal customer/admin sessions remain separate.

Supabase SSR sessions use base64url cookie encoding; encoding is not encryption. Do not assume that every Auth cookie is HttpOnly merely because the separate recovery-proof cookie is HttpOnly. Browser-side Auth uses its namespace session, while server handlers validate it. Do not copy tokens into application logs, URL diagnostics, screenshots, downloadable traces or storage-state artifacts.

## Credentials and Edge Functions

- Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are public browser configuration. The public key identifies the project/API context; it is not proof of an authenticated user or admin role.
- Passwords are submitted for Supabase Auth verification; the application does not maintain a separate password table. Service-role, recovery-signing, supplier, payment, SMTP and webhook secrets remain server/Edge configuration and must never appear in browser bundles.
- [`supabase/config.toml`](../../supabase/config.toml) disables gateway JWT verification for several Edge Functions. Those handlers therefore depend on explicit webhook signatures or dedicated authorization/cron secrets. Do not infer that an exposed route is authorized merely because it exists.
- The reviewed `fazercards-test` handler is permanently disabled and makes no provider requests. Other purchase-capable source paths have an independent supplier release lock; no Auth role alone releases financial features. RF Coins funding/spending remain source-locked off.

## Verification and remaining limits

The isolated real-Auth workflow exercises disposable PostgreSQL 17, GoTrue, PostgREST and a local mail catcher on desktop/mobile, using synthetic identities. It covers confirmation/resend, login/logout, recovery and link reuse, customer/admin isolation, cross-account order and wallet/ledger RLS, privileged CSV audit and financial release locks. [Owner acceptance](../../OWNER_ACCEPTANCE.md) and the PR's current checks identify the reviewed candidate and artifacts; historical green runs do not transfer automatically to a new SHA.

These results are not hosted Auth configuration or owner UX approval. Hosted password-recovery `internal_failure` needs its application stage and runtime logs for attribution; the bounded diagnostic category alone does not identify a database error. The supplier incident and historical exposed-key revocation remain [unresolved](../FAZERCARDS_INCIDENT.md). No live provider call, hosted migration or credential change is authorized by this document. Historical policy concerns in older audits must be assessed against the full migration chain and actual deployed privileges, rather than treated as either current or resolved from one old migration file.
