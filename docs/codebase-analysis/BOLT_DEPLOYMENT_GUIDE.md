# RunFazone Bolt Cloud synchronization and database deployment guide

## Scope and safety boundary

This guide is based on repository evidence and the stated production facts that the live site is hosted by Bolt Cloud, the production database is Bolt Database, and the existing Bolt.new project is authoritative for production. No Bolt dashboard, published deployment, Bolt Database, GitHub webhook, or production environment was accessed during this review.

No deployment, GitHub push, database connection, migration, seed, reset, DNS change, webhook change, or supplier operation was performed. The repository and production database must be treated as separate systems until they are manually identified and compared.

## 1. Verified current architecture

### Repository-side facts

- The application is Next.js 13.5.1 App Router with React 18, strict TypeScript, Tailwind CSS, Supabase JS/SSR clients, and Vitest; see [package.json](/workspaces/RFZ-LaunchSite/package.json:1) and [tsconfig.json](/workspaces/RFZ-LaunchSite/tsconfig.json:1).
- Customer/admin pages and Next route handlers are under [app/](/workspaces/RFZ-LaunchSite/app). Shared UI is under [components/](/workspaces/RFZ-LaunchSite/components). Database/payment/supplier code is under [lib/](/workspaces/RFZ-LaunchSite/lib).
- The repository contains 93 SQL migration files under [supabase/migrations/](/workspaces/RFZ-LaunchSite/supabase/migrations), seven Supabase Edge Functions, and Supabase Auth/Postgres/Realtime integration code.
- Supabase clients are built from `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`; see [lib/supabase.ts](/workspaces/RFZ-LaunchSite/lib/supabase.ts:1), [lib/supabaseAdmin.ts](/workspaces/RFZ-LaunchSite/lib/supabaseAdmin.ts:1), and [.env.example](/workspaces/RFZ-LaunchSite/.env.example:1).
- Edge Functions include player verification, QR Ph payment creation, payment webhooks, supplier probes, reconciliation, archival, and transactional email. All are configured with `verify_jwt = false` in [supabase/config.toml](/workspaces/RFZ-LaunchSite/supabase/config.toml:1), so function-specific authorization/signature checks are essential.
- [netlify.toml](/workspaces/RFZ-LaunchSite/netlify.toml:1) describes a Netlify Next.js build (`npx next build`, `.next` publish). [README.md](/workspaces/RFZ-LaunchSite/README.md:30) contains the default Vercel text. Neither file proves the current production host.
- No Bolt-specific configuration file, Bolt SDK, Bolt project ID, database URL, Supabase project ref, GitHub Actions workflow, Dockerfile, or infrastructure-as-code file was found.

### Repository and GitHub state

At review time, local `main` tracked `origin/main` at commit `35e8caa` in `https://github.com/Tedbits99/RFZ-LaunchSite`. The working tree contained uncommitted/untracked documentation changes. This proves the repository-side branch relationship only; it does not prove that GitHub `main` matches the published Bolt project.

### Infrastructure classification

| Evidence | Classification |
|---|---|
| Supabase clients, migrations, RPC calls, RLS migrations, Edge Functions | Active application integration in source; production deployment is unverified |
| Netlify plugin/configuration | Repository configuration or historical target; not proof of current hosting |
| Default Vercel README text | Scaffold documentation; not proof of deployment |
| `.env.example` comment mentioning Bolt auto-configuration | A hint about a development workflow, not proof of Bolt Database identity or production wiring |
| Bolt Cloud/Bolt Database | User-stated production infrastructure; not independently verifiable from this repository |

The code is not demonstrably “Bolt-native.” It is a conventional Next.js application whose runtime expects Supabase-compatible URL/key/API behavior and whose Edge Functions expect Supabase deployment/secrets. Bolt can host it only if the existing Bolt project supplies compatible Next.js server execution, environment variables, database/API compatibility, and function/webhook support.

## 2. GitHub-to-Bolt synchronization process

Use this controlled path:

```text
Codex feature branch
  -> local static checks/tests/build
  -> GitHub pull request
  -> review and merge to GitHub main
  -> existing Bolt project fetches/selects the intended commit
  -> Bolt preview/build verification
  -> manual Bolt Publish/Update approval
  -> production smoke tests
```

Do not connect a new Bolt project, replace the existing GitHub integration, or allow a merge hook to publish automatically until the existing project has been positively identified.

### Feature branch rules

1. Start from the known GitHub `main` commit shown in the Bolt project, not merely from a stale local checkout.
2. Keep application changes and database migrations reviewable and separate in the PR description, even when they are delivered together.
3. Do not place production secrets, Bolt tokens, database dumps, or private URLs in Git.
4. Run the relevant tests, `npm run lint`, and `npm run build` before requesting merge.
5. Explicitly identify whether the change affects customer orders, payment webhooks, supplier fulfillment, RLS, Auth, or migrations.

### How to identify the correct existing Bolt project

In the Bolt dashboard, manually confirm all of the following before linking or updating anything:

- Project name and Bolt project ID match the original RunFazone.com project.
- The connected GitHub repository is `Tedbits99/RFZ-LaunchSite` and the intended branch is `main`.
- The displayed deployed commit is known and can be compared with GitHub.
- The production domain is RunFazone.com and no DNS change is requested.
- The project’s database connection is the existing Bolt Database, not a newly created database.
- The project’s environment variable names match the repository’s required names without exposing values.
- Existing Edge Functions, webhooks, scheduled jobs, Auth settings, storage, and payment/supplier integrations are still present.

Record the project ID, connected repository/branch, deployed commit SHA, database identity label, and last publish time in the release record. Do not infer identity from a similar project name.

## 3. Bolt compatibility assessment

### What can be inferred

The app uses standard Next.js App Router pages and route handlers, so it is structurally compatible with a host that supports the declared Next.js version and server-side route execution. It also needs runtime environment variables and outbound network access to Supabase/PayMongo/FazerCards/FX/SMTP-related services.

### What cannot be verified from the repository

- Whether the existing Bolt project runs this exact repository or a different snapshot.
- Whether Bolt supports this project’s Next.js 13 route handlers, middleware, dynamic server rendering, and long-running/async server operations as deployed.
- Whether Bolt Database exposes the Supabase-compatible API/Auth/Realtime/SQL/RPC behavior used by the application.
- Whether Bolt hosts or proxies the seven Supabase Edge Functions, or whether those functions remain deployed in a separate Supabase project.
- Whether Bolt preserves current environment variables, secrets, scheduled reconciliation, payment webhook URLs, Auth redirect URLs, storage, and Realtime publication.
- Whether Bolt’s GitHub integration builds every merged commit automatically or requires manual import/publish.
- Whether the published Bolt commit and GitHub `main` have diverged.
- Whether the repository migrations match the production database schema/RLS/RPC definitions.

These questions require dashboard access and safe read-only inspection. No compatibility claim should be upgraded from “possible” to “verified” without those checks.

## 4. Database identity and schema verification

### Repository evidence

The repository contains chronological-looking migrations for catalog, orders, vouchers, payment, supplier fulfillment, RLS, Realtime, Vault credentials, and email logs. It also contains duplicated/suffixed migration filenames. The repository’s [supabase/config.toml](/workspaces/RFZ-LaunchSite/supabase/config.toml:1) configures Edge Function JWT behavior but does not identify a Supabase project reference. No Bolt Database identifier is present.

The application’s key database flows are described in [DATABASE.md](/workspaces/RFZ-LaunchSite/docs/codebase-analysis/DATABASE.md) and [DATA_FLOW.md](/workspaces/RFZ-LaunchSite/docs/codebase-analysis/DATA_FLOW.md): `create_order`, `submit_payment`, `validate_voucher`, `verify_payment`, `complete_fulfillment`, admin status functions, RLS policies, order/timeline Realtime, and supplier/payment transaction tables.

### Safe comparison procedure

Perform this only from the Bolt dashboard or an approved read-only database connection:

1. Identify the Bolt Database instance by dashboard metadata, not by guessing from a URL or project name.
2. Confirm the database is the existing production database and record its identity without copying secrets into Git.
3. Obtain a provider-approved schema-only export or read-only inventory of tables, columns, indexes, constraints, functions/RPCs, triggers, RLS enablement/policies, Realtime publication membership, Auth configuration, storage buckets, and Edge Function/webhook settings.
4. Compare that inventory to [supabase/migrations/](/workspaces/RFZ-LaunchSite/supabase/migrations) and the application queries. Do not assume every repository migration was applied, applied once, or applied in filename order.
5. Classify each difference as: repository-only, production-only, equivalent-but-different, unknown, or destructive-risk.
6. Resolve identity and drift before proposing any migration. Never use `supabase db push`, reset, seed, or a blind migration runner against production.

### Database migration strategy

Use expand → migrate/backfill → validate → contract:

1. Write a backward-compatible migration that adds nullable/defaulted structures first.
2. Deploy code that can work with both old and new schema during the transition.
3. Backfill in bounded, observable batches only after a verified backup and rollback plan.
4. Validate counts, constraints, RLS, RPC behavior, Auth, payment state, supplier state, and Realtime.
5. Deploy the code that starts using the new structure.
6. Remove old structures only in a later, separately approved change after retention and rollback windows expire.

Every production schema change must be manually approved and executed through the Bolt-supported database workflow. A GitHub merge or Bolt code publish must never implicitly run migrations.

## 5. Required backups and preservation checks

Before any production code publish or database change, the operator must confirm:

- A restorable full Bolt Database backup/snapshot exists and its restore procedure has been tested or documented.
- A schema-only export exists for comparison.
- Customer/Auth records, orders/order timelines, payment transactions/submissions, vouchers/usages, games/packages/prices, suppliers/mappings/transactions, admins, promotions, announcements, support data, storage references, and Realtime configuration are included in the preservation scope.
- Payment webhook event IDs and supplier idempotency records are retained; do not replay them casually.
- Current environment variable names, secret ownership, webhook endpoints, Auth redirect URLs, scheduled jobs, and Edge Function versions are recorded without exposing secret values.
- A restore owner, maintenance window, rollback decision-maker, and validation owner are identified.

Do not treat a code repository backup as a database backup. Do not export sensitive data into the repository or an unsecured local file.

## 6. Deployment checklist

### Pre-merge

- Read [ARCHITECTURE.md](/workspaces/RFZ-LaunchSite/docs/codebase-analysis/ARCHITECTURE.md), [DATABASE.md](/workspaces/RFZ-LaunchSite/docs/codebase-analysis/DATABASE.md), [AUTHENTICATION.md](/workspaces/RFZ-LaunchSite/docs/codebase-analysis/AUTHENTICATION.md), and [CHANGE_IMPACT_GUIDE.md](/workspaces/RFZ-LaunchSite/docs/codebase-analysis/CHANGE_IMPACT_GUIDE.md).
- Confirm the PR targets the intended repository and branch.
- Run `npm test`, `npm run lint`, and `npm run build` as applicable.
- Review the diff for secrets, destructive SQL, accidental payment/supplier calls, and environment-name changes.
- Identify migration files and state clearly that they require a separate database approval.

### Before Bolt update

- Confirm the existing Bolt project identity, GitHub repository, branch, and intended commit.
- Confirm the Bolt Database is unchanged and that the required environment variable names remain configured.
- Confirm the update is previewable and that automatic publish is disabled or manually gated.
- Ensure payment webhook and supplier fulfillment endpoints will not be invoked by preview traffic or test orders.

### Bolt preview and publish

- Import/select the reviewed commit in the existing Bolt project.
- Run the Bolt build/preview and inspect build logs for Next.js route, middleware, environment, and server-function failures.
- Test only safe read paths and non-mutating flows first.
- Use a staging/test payment configuration and a non-production supplier sandbox for any write-path tests.
- Manually compare the preview commit SHA to the approved GitHub commit.
- Publish only after a named operator approves the exact preview and confirms no database migration is bundled into the publish.

### Post-publish

- Check homepage, active game/package catalog, legal pages, login/admin access, order lookup, checkout rendering, and static metadata.
- Confirm no unexpected payment webhook, email, supplier, or reconciliation activity occurred.
- Validate one approved low-risk production read path and monitor errors/logs.
- Record Bolt project ID, commit SHA, publish time, operator, validation results, and rollback decision.

## 7. Testing checklist

### Repository checks

```bash
npm test
npm run lint
npm run build
```

Use focused tests where available, especially [lib/suppliers/adapters.test.ts](/workspaces/RFZ-LaunchSite/lib/suppliers/adapters.test.ts:1). Do not run supplier controlled-test orders against live credentials.

### Safe application checks

- Customer catalog and package display use the expected database-backed values.
- Required player fields, voucher preview, server-side price calculation, and order reference behavior are correct.
- Manual payment and QR UI render without submitting real payment data.
- Tracking rejects incorrect reference/email combinations and does not expose another customer’s data.
- Admin access rejects unauthenticated/non-admin users.
- Admin order/payment/supplier pages are read-only during preview unless a staging/sandbox setup is confirmed.
- Webhook signature, amount, event-id idempotency, order-state, and supplier-fulfillment behavior are validated with provider test fixtures only.
- Realtime and polling behavior are checked without creating duplicate events or supplier orders.

## 8. Rollback procedure

### Code rollback

1. Stop the Bolt publish/update process if still pending.
2. Identify the last known-good Bolt deployment and GitHub commit SHA.
3. Revert the Bolt project to that known-good commit using the existing project’s rollback/version controls.
4. Do not roll back database schema automatically with code.
5. Re-run read-only smoke tests and monitor payment/webhook/supplier logs.

### Database recovery

1. Freeze further schema/application changes and preserve logs.
2. Determine whether the issue is code-only, data-only, or schema-related.
3. Prefer a forward-compatible corrective migration when data is intact.
4. Restore the verified Bolt Database backup only under an approved incident procedure when restoration is necessary.
5. Validate Auth, orders, payments, vouchers, catalog/pricing, suppliers, fulfillment, admins, promotions, announcements, webhooks, and Realtime after recovery.
6. Reconcile payment webhook events and supplier transactions carefully; never blindly replay events or recreate supplier orders.

The safe rollback unit is not necessarily “application code plus database.” Expand/contract migrations must preserve compatibility with the previous code version.

## 9. Remaining configuration questions

These cannot be answered from the repository and must be answered manually in Bolt:

1. What is the exact Bolt project ID and which GitHub repository/branch/commit does it use?
2. Does the existing Bolt project deploy this repository, a fork, or a different Bolt workspace snapshot?
3. What exact runtime/build mode does Bolt use for Next.js 13 route handlers and middleware?
4. Is the production database genuinely Bolt Database, Supabase, or a compatibility layer? What is its immutable identity?
5. Does Bolt Database support the Supabase Auth, PostgREST, Realtime, RLS, Vault, SQL RPC, and Edge Function behavior used here?
6. Where are the seven Edge Functions deployed, and which versions/secrets are active?
7. Which webhook URLs, cron schedules, Auth redirect URLs, storage buckets, payment providers, and supplier credentials are production-active?
8. Does Bolt automatically publish on GitHub changes, and can that behavior be disabled or manually gated?
9. What is the supported Bolt Database backup/export/restore process and retention policy?
10. Does Bolt provide a staging/preview environment connected to a safe database and sandbox payment/supplier credentials?

## Exact manual steps inside the existing Bolt.new project

1. Open the original RunFazone.com Bolt.new project; do not create a new project.
2. Record the Bolt project ID, current published commit/version, connected GitHub repository, branch, production domain, and last publish time.
3. Confirm the repository is `Tedbits99/RFZ-LaunchSite` and compare the Bolt-connected commit SHA with GitHub `main`.
4. Disable or document any automatic publish-on-merge behavior before merging future PRs.
5. Inspect environment configuration by variable name only. Confirm the required Supabase/public, service-role, app URL, payment, supplier, storage, and email secrets exist in the correct runtime scopes; do not copy secret values into Git or chat.
6. Confirm which database the Bolt project uses and record its dashboard identity. Do not replace the connection.
7. Create/verify a restorable production backup and schema-only export using Bolt’s supported database controls. Do not reset, seed, recreate tables, or run repository migrations.
8. Inventory production tables, RPCs, RLS policies, Auth, Realtime publication, storage, Edge Functions, scheduled jobs, payment webhooks, and supplier integrations, then compare them with this repository’s migrations and [DATABASE.md](/workspaces/RFZ-LaunchSite/docs/codebase-analysis/DATABASE.md).
9. Confirm Bolt preview/build support for this Next.js app, including middleware, dynamic routes, route handlers, and server-side environment variables.
10. For the next change, merge only an approved GitHub PR, select that exact commit in the existing Bolt project, run a preview, and review build/runtime logs.
11. Test only non-destructive/read-only paths in preview. Use staging/sandbox payment and supplier credentials for write-path testing; never trigger live supplier fulfillment.
12. Manually approve Bolt Publish/Update only after the preview commit, environment names, database identity, and safety checklist match the approved release.
13. After publishing, run the post-publish smoke checks, monitor logs, and record the deployment evidence and rollback target.
14. Apply database migrations later as a separate, manually approved Bolt Database operation using the backup, schema comparison, backward-compatible migration, validation, and rollback process above. Never let GitHub merge or Bolt code publish run migrations automatically.
