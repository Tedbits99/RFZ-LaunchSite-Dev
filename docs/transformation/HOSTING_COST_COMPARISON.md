# Cloudflare and Supabase cost model

**Research date:** 2026-10-19. **Status:** planning evidence only. No account, subscription, Worker, database project, DNS record or paid service was created.

## Published plan limits

| Service | Free | Paid / production reference | Runfazone implication |
|---|---|---|---|
| Cloudflare Workers | 100,000 requests/day; 10 ms CPU per HTTP invocation; 128 MB memory; 50 subrequests/request; 3 MiB compressed Worker size | Workers Paid has a $5/month minimum; 10 million requests/month and 30 million CPU-ms included, $0.30 per additional million requests and $0.02 per additional million CPU-ms; default 30 seconds CPU/request, configurable up to 5 minutes | Free is suitable for bounded development or very low traffic only. SSR, auth, webhook parsing and supplier orchestration need measured CPU, bundle and subrequest results before production selection. |
| Cloudflare Logs | 200,000 events/day; 3-day retention | 20 million events/month; 7-day retention in the current published plan | Retention may be insufficient for payment/fulfillment investigations without an approved export/retention plan. |
| Cloudflare Cron/Queues/Workflows | Shared limits apply; Cron is limited to 10 ms CPU on Free | Paid Cron/Queue invocations allow up to 15 minutes wall time; Workflows have separate included usage and overage pricing | Reconciliation and fulfillment must be durable and idempotent; do not put them in a request tail or assume Free is sufficient. |
| Supabase Free | 2 projects per organization; 500 MB database; 5 GB egress; 1 GB storage; 50,000 MAU; 500,000 Edge Function invocations; projects may pause after inactivity; no downloadable database backups | Supabase Pro is the owner’s account decision; published reference includes 8 GB database, 250 GB egress, 100 GB storage, 100,000 MAU and 2 million Edge Function invocations, with overages/add-ons | Retain the existing project if owner-controlled. Free is not a production recovery plan because downloadable backups are unavailable and inactivity pauses are possible. |
| Z.com / Titan | Existing owner-confirmed assets | Existing renewals and quotas remain unknown | Preserve them; do not double-charge or replace them. |

Sources: [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/), [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod), and [Supabase backups](https://supabase.com/docs/guides/platform/backups).

## Cloudflare deployment assumptions

The selected adapter is `@opennextjs/cloudflare` with Wrangler. Cloudflare’s current OpenNext documentation supports Next.js 16, App Router, route handlers, SSR, RSC and middleware, but does not support Node.js middleware. OpenNext’s Cloudflare runtime uses the Next.js Node.js runtime and requires explicit testing of Node APIs, request cookies, raw webhook bodies and server-only secrets.

The current application has no Wrangler/OpenNext configuration. Future implementation will need a reviewed Wrangler configuration, `open-next.config.ts`, adapter/Wrangler dependencies, preview scripts and Cloudflare secret/environment mapping. These are not added in Phase 0.

## Scenario model

| Scenario | Cloudflare | Supabase | Existing Z.com/Titan | Total treatment |
|---|---:|---:|---:|---|
| Local development | $0 incremental | $0 incremental if disposable/local tests work | $0 new purchase | No live services or production credentials |
| Pre-launch isolated preview | Paid plan not yet authorized | Separate staging/free project only if owner confirms | $0 new purchase | Unknown until account ownership, usage and backup policy are verified |
| Small commercial launch | $5/month minimum reference, before usage | Existing plan retained; Pro cost must be confirmed from the owner’s invoice | Existing renewals | `Cloudflare $5 + existing Supabase invoice + existing renewals + provider/supplier fees`; no invented total |
| Recovery-capable production | Paid Workers likely required if CPU/log/durability limits exceed Free | Pro or higher may be required for backups, no-pausing and operational support | Existing renewals | Exact total remains unknown until traffic, data size, backup and log-retention requirements are measured |

No payment processing, supplier inventory, email volume, tax, FX, domain renewal, mailbox renewal, backup add-on, PITR, observability export or overage cost is included. PayMongo and FazerCards fees remain business costs, not hosting costs.

## Required cost gates

1. Confirm the existing Supabase organization/project and current plan before adding any project.
2. Measure Worker bundle size, CPU, requests, subrequests and log volume with mocked payment/supplier calls.
3. Establish database export/restore and object-storage recovery; Free Supabase has no downloadable database backups.
4. Set usage alerts and explicit spend caps before any production deployment.
5. Keep Z.com registration and Titan mailbox; do not purchase replacements.

The selected production architecture is [Cloudflare Workers/OpenNext plus retained Supabase](INFRASTRUCTURE_ARCHITECTURE.md). No Phase 0 document authorizes spending or deployment.
