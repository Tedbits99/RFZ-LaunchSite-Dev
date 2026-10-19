# Deployment dependencies and existing assets

**Status: source/public observations verified where stated; account configuration Pending Verification.** No deployment is authorized by this report.

| Dependency | Evidence | Required verification / owner action |
|---|---|---|
| Development source | Correct origin/main and HEAD verified | Review documentation commit; preserve existing source edits |
| GitHub protection | Branch API returned `protected: false` and repository rulesets returned `[]` on 2026-10-19 | Phase 1: review applicable rulesets/required checks; no rule changed |
| Push side effects | Repository hooks API returned HTTP 403; deployments API returned an empty list | Empty deployments does not exclude Cloudflare/GitHub App/legacy integrations. Owner must prove development pushes cannot deploy production before push |
| Cloudflare Workers | Owner-selected target; no Worker/Wrangler deployment exists locally | Account/Worker identity, OpenNext adapter build, branch mapping, secrets, plan, certificate, observability and rollback identity |
| Legacy Netlify | Repo config exists only as preserved source evidence | `netlify.toml`, plugin and any account integration must be removed or explicitly archived in a later authorized phase after reference checks |
| Backend | Supabase source APIs/functions | Independent ownership, applied schema/ledger, Auth redirects, secrets metadata, backup and restore |
| PayMongo/FazerCards | Source integrations | Actual production/test identities, callback config, signing secrets presence and safe sandbox access |
| Z.com domain | Owner-confirmed paid asset | Renewal and lock/control-panel rights; no registrar automation |
| Authoritative DNS | Public NS response: `01.dnsv.jp` through `04.dnsv.jp` | Full-zone export and owner panel access; delegation indicates DNS.JP/GMO, not automatic Z.com DNS authority |
| Titan | Owner-confirmed mailbox and public MX/SPF/DKIM | Exact reseller plan/limits, third-party SMTP permission, Auth SMTP settings and approved delivery test |

## Refreshed public DNS observations (2026-10-19)

Read-only Google DNS-over-HTTPS queries: apex A `75.2.60.5` (TTL 3600); `www` CNAME `site-dns.bolt.host` (3600); NS four `dnsv.jp` servers (21600); MX `10 mx1.titan.email` and `20 mx2.titan.email` (3600); SPF `v=spf1 include:spf.titan.email ~all`; `titan1._domainkey` public DKIM key present; `_dmarc` returned NXDOMAIN. These selected recursive answers are not a complete authoritative-zone export or proof of account ownership. A shared apex IP does not identify the serving site.

Preserve all records and nameservers. The [existing DNS/email plan](../operations/DOMAIN_DNS_EMAIL_CUTOVER_PLAN.md) describes current-versus-future website records and rollback. Obtain exact future DNS targets from the approved host account; do not guess them or accept a flow that changes nameservers.

## Titan transport and capacity

**Verified transport-only:** from this development environment, a credential-free TLS connection to `smtp.titan.email:465` completed using TLSv1.2, certificate validation succeeded, the certificate reported expiry 2027-03-25, and the SMTP server returned greeting code 220. No AUTH, MAIL, RCPT or DATA command was sent. This proves neither mailbox credentials nor Edge runtime egress nor delivery.

**Verified published limits, not this account's quota:** Titan's external-recipient table lists Starter 50/hour and 300/day; Pro 200/hour and 500/day; Premium 300/hour and 1,000/day; Ultra 500/hour and 2,000/day; Free/trial 50/hour and 100/day. Paid domain totals combine active mailbox allowances; new-domain limits may be lower. The owner's exact Business/reseller plan remains unknown. [Titan limits](https://support.titan.email/hc/en-us/articles/360038836914-How-many-emails-can-I-send-and-receive).

**Proposed workload test:** budget customer support mail + Auth confirmation/recovery/resend + order lifecycle messages + bounded retries against both hourly and daily limits, with headroom. For illustration only, 50 orders/day × 3 order emails + 20 Auth emails = 170/day, excluding support and retries; this fits some published daily quotas but does not establish hourly burst capacity or the actual account plan. Do not buy another sender until an approved test demonstrates a gap.

Application code defaults to implicit TLS on 465; it does not implement port-587 STARTTLS. Supabase Auth custom SMTP is separate and its [default custom-provider rate limit](https://supabase.com/docs/guides/auth/auth-smtp) must be considered alongside Titan's quota. Auth and transactional mail compatibility remain Pending Verification until owner-approved credentialed tests, sender alignment and controlled send/receive evidence exist.

## Critical launch dependencies

Current canonical intent is apex `runfazone.com` with `www` redirect. Verify certificates for both names, renewal, callback origins, exact deployed commit, monitoring, backup/restore and rollback before any cutover. Existing legacy availability must be preserved without new Bolt development/deployment. See [staging plan](STAGING_TEST_PLAN.md) and [launch requirements](PRODUCTION_LAUNCH_REQUIREMENTS.md).
