# Code quality, performance, and risk assessment

## Confirmed strengths

- Database-side price/voucher computation prevents the browser from being authoritative.
- Separate payment and fulfillment statuses clarify state and gate supplier side effects.
- Row locking, idempotency keys, unique voucher usage, provider event IDs, and terminal-state guards address duplicate processing.
- Server-side service keys are separated from public browser keys in the client modules.
- Customer order updates use both Realtime and polling, reducing perceived delay while retaining a fallback.
- Supplier adapter and payment adapter contracts make provider replacement possible.

## Confirmed gaps/risks

- Ordinary login/register, password reset, and profile save are incomplete based on their rendered forms and missing/empty handlers.
- Generic `getPaymentProvider()` falls back to `MockPaymentProvider` for every non-mock setting ([lib/paymentProvider.ts](/workspaces/RFZ-LaunchSite/lib/paymentProvider.ts:31)); production behavior depends on the separate QR/webhook path rather than this abstraction.
- Payment and fulfillment logic is duplicated between Next modules and Edge Functions, increasing drift risk.
- Extensive `any` casts and no generated Supabase schema types reduce compile-time protection for joins and RPC payloads.
- Many UI components use raw `<img>` URLs with lint suppressions; this affects image optimization and potentially LCP.
- Logging includes admin user IDs/emails and verbose polling logs; production log retention/privacy should be reviewed.
- Error handling often collapses upstream/database failures to generic messages, which is safe for users but makes observability dependent on server logs.
- No broad application test suite was found; the visible focused test is supplier adapter behavior.
- Public/email-only account and order paths should be threat-modeled for enumeration and privacy.

## Performance observations

The home page performs client-side catalog/promotion reads and uses fallback data, while game pages make several sequential server reads. Admin screens frequently fetch related records directly. Supplier polling has immediate backoff plus scheduled reconciliation, which is operationally sound but should be rate-limited/monitored. `next.config.js` serializes build parallelism, likely to control resource usage but increasing build time.

## Accessibility/SEO

Metadata, robots, sitemap, alt text on core logos, responsive Tailwind breakpoints, and legal pages are present. Some decorative images intentionally have empty alt/aria-hidden attributes. The analysis did not run browser accessibility tooling, so keyboard focus, contrast, and screen-reader behavior remain partially unverified.

## Test and verification limits

No source files were modified. The full test/build commands were not run as part of this read-only audit because dependency/network/runtime availability was not established. Live Supabase policies, deployed Edge Function versions, secrets, cron schedules, and provider dashboards remain unverified.
