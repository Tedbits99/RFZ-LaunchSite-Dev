# Production architecture audit

Audit basis: `main` SHA `0fde4cf946c85150fc0a607657e4a9e18f8c4afe`, inspected
2026-10-29 (Asia/Taipei date context). This is repository/GitHub metadata only;
no hosted provider was changed or queried beyond public repository metadata.

## Findings

- **Application:** Next.js App Router with Supabase browser/SSR clients and
  Next route handlers. `netlify.toml` describes a Netlify Next build, while
  `open-next.config.ts` and `wrangler.jsonc` define an OpenNext Cloudflare
  Worker named `runfazone-preview`. The actual production host/domain is not
  proven by this repository and must be identified by the owner.
- **Worker:** build output is `.open-next/worker.js` with `.open-next/assets`,
  `nodejs_compat`, and `global_fetch_strictly_public`. The Worker name,
  account, routes, custom domains, bindings, version, and production Access
  policy require hosted verification. The existing private-preview workflow
  is manual, exact-SHA gated, development-project scoped, and separately
  checks a saved Cloudflare Access policy.
- **Supabase:** Postgres/Auth/Realtime, migrations, and independently deployed
  Edge Functions. `supabase/config.toml` sets `verify_jwt = false` for all
  listed functions; handler-level authorization, HMAC, origin, and secret
  checks are therefore release-critical. No production project ref is in the
  repository.
- **Configuration:** names-only inventory is in `environment-names.txt`.
  Public browser values are limited to the public Supabase URL/key and app
  origin. Service-role, provider, SMTP, HMAC, cron, and Cloudflare values must
  remain server/Edge/host secret bindings. Never copy values into Git or logs.
- **Auth/domain:** Supabase Auth must allow the exact production site origin,
  `/auth/callback`, recovery/reset routes, and any approved email-action
  origins. The app origin must be fixed configuration, never derived from an
  arbitrary request Host. Verify TLS, apex/www canonicalization, cookie
  domain/SameSite behavior, and Cloudflare Access exclusions for customer
  routes before launch.
- **Migrations:** the canonical disposable sequence has 101 included SQL
  files and explicitly excludes scheduler/outbound and deferred RF Coins
  migrations. Compare production migration history/schema first; back up and
  test restoration; apply only a reviewed exact set in chronological order.
  A code merge must not implicitly apply production migrations.
- **GitHub integration:** existing workflows provide frontend validation,
  development database synchronization, isolated security tests, exact-head
  preview checks, and production-release-safety. The existing DB workflow is
  capable of hosted operations when manually dispatched; this branch adds no
  workflow and performs none.
- **Access:** preview evidence documents an account-wide owner-only Access
  policy check. Production policy, identity provider, bypasses, service-token
  rules, and custom-domain attachment remain owner verification items.

## Failure points / blockers

1. Production host and Cloudflare Worker/domain identity are unverified.
2. Production Supabase project, migration ledger, Auth allowlist, functions,
   secrets, schedules, storage, and Realtime settings are unverified.
3. The previously exposed FazerCards key has dummy replacement in source/config
   context, but upstream revocation is not evidenced. Treat it as compromised.
4. Payment, supplier fulfillment, email, scheduler, and RF Coins activation
   require separate approval and smoke-test isolation.
5. GitHub branch/ruleset protection and required status contexts must be
   verified on the target repository; local evidence is insufficient.

## Agent A isolation

PR #82 is draft, targets `main`, and was inspected before editing. Its changed
files are application/account/auth code, existing CI workflows, and related
docs/tests. None of this branch's files are in that list. Integration is by a
new PR targeting `main`; Agent A's PR must be reviewed independently and never
cherry-picked, rebased, merged, or modified by this workstream.
