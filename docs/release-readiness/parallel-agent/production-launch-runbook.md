# Production launch runbook (execute only after approval)

This runbook is a controlled approval procedure, not deployment permission.
Development readiness and financial activation are separate gates.

## 1. Owner review and signoff

Record repository, PR URLs, exact application SHA, migration manifest/hash,
host/Worker identity, Supabase project identity, backup ID, rollback owner,
monitoring owner, and maintenance window. Confirm PR #82 is independently
reviewed and that this preflight PR is a draft until owner approval.

## 2. CI and protection gate

Require exact-SHA success for the repository's required frontend, database
security, migration/release-safety, and acceptance checks. Confirm branch/ruleset
requires review, prevents force-push, blocks stale approvals as appropriate,
and has auto-merge disabled. Record check-run URLs, not secrets.

## 3. SHA, backup, and migration gate

Verify GitHub `main`, checkout, artifact, and intended deploy reference are the
same full SHA. Capture a restorable database backup and schema-only inventory;
verify recovery owner and restoration path. Compare hosted migration history
to the canonical manifest and classify drift. Apply only the approved sequence
through the authorized Supabase workflow, with a dry-run/plan first. Abort on
unknown drift, missing backup, checksum mismatch, or any outbound/scheduled
side effect. Do not deploy from this branch and do not apply pending/deferred
RF Coins migrations.

## 4. Authorized merge and controlled deployment

An owner merges the separately approved PRs under protection; no agent enables
auto-merge. After merge, re-read the new `main` SHA and rerun exact-head checks.
Publish the immutable application artifact to the verified Cloudflare target
using the owner-approved workflow. Verify Worker version, bindings, route,
custom domain, TLS, Access policy, and logs. Do not assume the Netlify config
is the production target.

## 5. Smoke tests

Run read-only homepage/catalog/legal checks, then approved synthetic/customer
auth checks: signup/confirmation, login/logout, callback, recovery, and account
read paths. Run admin login and read-only dashboard checks with a designated
admin. Verify order lookup and checkout rendering without creating a payable
order. Capture timestamps and sanitized results. Any unexpected provider,
email, supplier, or database write aborts the launch.

## 6. Financial activation remains disabled

Keep PayMongo, FazerCards fulfillment, RF Coins funding/spending, schedulers,
and real transactional email disabled until a separate owner-approved financial
activation plan exists. Never use a production credential for a smoke test;
use synthetic fixtures or provider sandboxes only.

## 7. Monitoring and rollback

## Rollback trigger

Rollback on auth outage, data integrity/security regression, payment mismatch,
unexpected supplier/email activity, or inability to observe the system.

Monitor Worker/Edge errors, auth failures, webhook rejects, database errors,
queue/dead-letter state, and unexpected outbound activity for the agreed window.
Rollback on auth outage, data integrity/security regression, payment mismatch,
unexpected supplier/email activity, or inability to observe the system. Record
the trigger and decision, restore the prior immutable Worker/application SHA,
and use the approved database recovery procedure; do not reverse migrations by
guessing or reset production. Re-run smoke tests and document closure.

## Rollback procedure

Restore the prior immutable application/Worker version, follow the approved
database recovery procedure, then rerun smoke tests and record the decision.

## Recovery owner

The owner must name the release decision-maker and database recovery operator
before launch; an unassigned role blocks release.

## Readiness versus activation

`READINESS`: code/build/checks, identity, Access, Auth, backup/recovery,
monitoring, and disabled-provider smoke tests pass.

`FINANCIAL_ACTIVATION`: separate explicit approval, fresh provider credentials,
revocation evidence for the exposed FazerCards key, webhook verification,
supplier/payment sandbox evidence, limits, alerts, and rollback rehearsal pass.
Readiness never implies activation.
