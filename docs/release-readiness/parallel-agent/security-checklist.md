# Production security checklist

Mark each item with owner, evidence link, timestamp, and approved SHA. An
unchecked or unavailable item is **BLOCKED**, not assumed safe.

## Auth and RLS

- [ ] Supabase Auth site URL and exact callback/action URLs match the approved
  production origin; preview origins are not accepted in production.
- [ ] Customer and admin cookie/session flows are smoke-tested over HTTPS;
  recovery, confirmation, logout, and callback errors fail closed.
- [ ] RLS is enabled on every customer/order/payment/supplier/credential table;
  anonymous, authenticated non-admin, admin, and service-role behavior is
  evidenced separately.
- [ ] Security-definer RPCs have fixed `search_path`, minimal grants, and
  explicit state/amount/ownership validation; migrations are applied only from
  the reviewed manifest.
- [ ] Service-role keys exist only in server/Edge bindings and are absent from
  browser bundles, artifacts, logs, and support exports.

## Workers, Access, and integrations

- [ ] Cloudflare Worker name/account/version/domain and bindings match the
  approved SHA; production API token is least-privilege and not in GitHub logs.
- [ ] Cloudflare Access protects administrative/private surfaces; customer
  public routes are intentionally reachable; bypass/service-token rules are
  documented and tested.
- [ ] Edge Functions with platform JWT disabled enforce their own authorization,
  origin, HMAC, cron-secret, and idempotency checks.
- [ ] Payment webhook signatures, event IDs, expected amounts/currency, order
  state, replay handling, and provider response validation are tested.
- [ ] FazerCards credentials are revoked upstream and replaced with a fresh
  secret. The exposed historical key is never reused; do not call the supplier
  during this checklist.
- [ ] Supplier mapping, credential Vault access, fulfillment claims, and admin
  operations are isolated from customer/browser roles.
- [ ] Transactional email sender, SMTP secret, recipient policy, and failure
  handling are verified without sending real mail during preflight.

## Operations

- [ ] Structured logs redact tokens, keys, auth headers, player identifiers,
  payment payloads, and supplier credentials.
- [ ] Alerts cover auth failures, webhook signature failures, duplicate/replayed
  events, payment mismatch, fulfillment retry/dead-letter, email failure, and
  Worker/Edge error rate.
- [ ] A restorable database backup, schema snapshot, migration ledger, owner,
  maintenance window, and tested rollback decision are recorded.
- [ ] Production lock records payments, supplier fulfillment, RF Coins, and
  auto-merge as disabled until the separate financial activation gate passes.
