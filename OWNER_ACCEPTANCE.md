# PR #82 owner acceptance — pre-merge record

Updated 2026-10-28. This report distinguishes automated evidence from owner acceptance; it does not authorize merge, deployment, or hosted writes.

## Candidate and evidence

- PR #82 is **OPEN/DRAFT**, unmerged. The previous candidate `55fa5c647ae6461246b64497c6413eed26475edb` is historical and does not represent the recovery candidate. The recovery candidate is the PR branch head after the recovery changes are pushed; verify its exact SHA and Actions status in GitHub before considering any further gate.
- Recovery source changes add a fail-closed supplier fulfillment release gate, disable live FazerCards diagnostic/test-order endpoints, and add the scoped `service_role` read grant needed by signed webhook lookups. These source changes are not deployed and do not establish hosted containment or apply the migration.
- Local verification on the recovery source: `npm test` passed (89 files; 1,086 passed, 1 skipped), `npx tsc --noEmit` passed, `npm run lint` exited 0 (165 existing warnings), `npm run cloudflare:build` passed, `git diff --check` passed, and the disposable migration manifest passed with 105 entries. A temporary isolated PostgreSQL 17 ACL rehearsal passed the new grant assertions. The full database-security harness could not complete because the environment lacks host `psql`; the Supabase CLI was supplied ephemerally and no hosted database was changed.
- The recovery candidate has not yet passed exact-head GitHub Actions. Wait for and inspect checks tied to the pushed SHA; do not rely on older runs listed below.
- Exact-head Frontend validation: [run 40694965402](https://github.com/Tedbits99/RFZ-LaunchSite-Dev/actions/runs/40694965402) — PASS.
- Exact-head Development/security validation: [run 40694965405](https://github.com/Tedbits99/RFZ-LaunchSite-Dev/actions/runs/40694965405) — PASS, including isolated RPC/RLS/security and production-release-safety jobs. The Supabase Preview check is skipped by design.
- Read-only hosted schema/migration audit on verified `main` `0fde4cf946c85150fc0a607657e4a9e18f8c4afe`: [run 40697179241 and sanitized artifacts](https://github.com/Tedbits99/RFZ-LaunchSite-Dev/actions/runs/40697179241#artifacts) — PASS. Migration history was identical before and after; no data rows were exported and no migrations were applied.
- Read-only Auth preview-configuration audit for this exact candidate: [run 40697769091](https://github.com/Tedbits99/RFZ-LaunchSite-Dev/actions/runs/40697769091) — PASS. The candidate callback matches the protected PR #82 wildcard; confirmation and recovery templates use token-hash links; the recovery URL contract passed. This verifies configuration only, not email arrival or an end-to-end reset.
- The reported eight-store desktop/mobile browser baseline is 16/16 on synthetic PostgREST fixtures. It is not real Supabase Auth acceptance. The prior CI runs contain no downloadable browser screenshot/trace artifacts, and local synthetic captures are not a substitute for an owner review.

## Gate matrix

| Gate | Status | Evidence / gap |
| --- | --- | --- |
| A — technical and isolated authenticated acceptance | **BLOCKED** | Historical CI below is green for an older candidate. Recovery-source local checks pass, but exact-head CI and the full database-security harness remain pending. No isolated browser journey has exercised real Supabase Auth, customer sessions, or admin sessions. Existing route tests/mocks do not prove those flows. |
| B — owner experience acceptance | **BLOCKED** | No reviewable exact-candidate authenticated browser session or screenshot artifact was produced, and the owner has not accepted this exact candidate. Historical acceptance on older SHAs does not transfer. |
| C — post-merge hosted verification | **NOT STARTED** | No merge, hosted migration, or post-merge verification was performed. |

## Read-only hosted findings

- Project identity: `ketdhcmwowzztcdlmris`.
- 101 migration versions; before/after lists are identical.
- 36/36 public tables have RLS enabled; metadata summary: 136 policies, 40 functions, 90 indexes, 7 triggers.
- No public table named for RF Coins, wallet, or top-up exists. The three RF Coins migrations are not installed. This is expected for this pre-merge audit; it is not evidence that the hosted wallet is operational.
- Auth configuration audit passed for the candidate callback origin. It did not send email, change Auth settings, test a password, or verify email delivery.
- Source release constants for RF Coins funding and spending are hard-false and their tests pass. No live payment or supplier operation was run. Hosted financial configuration values were not read by the metadata-only audit.
- No Worker was deployed or activated. No SQL, rows, or hosted configuration were changed.

The metadata audit artifacts contain schema/security summaries and migration versions, not customer rows. They are available from the linked Actions run while GitHub retains the artifact.

## Safe acceptance plan — not executed

1. Use an isolated, disposable Supabase test backend with synthetic customer A/B, synthetic admin, and non-privileged staff identities. Do not reuse owner or customer identities. Use a local email catcher for signup/reset links; do not send real customer mail. Seed only identified fixtures and remove those fixtures on success or failure.
2. Build the exact reviewed PR SHA with only the isolated backend’s public URL/anon key in browser configuration. Keep service-role/provider credentials server-side and test-only. Keep payment, wallet funding/spending, supplier fulfillment, email delivery, and financial jobs disabled. Verify positive and negative RLS/session cases, expiry/refresh/logout, recovery-link reuse rejection, wallet unavailable versus real-zero behavior, and admin authorization.
3. Run desktop/mobile browser journeys and capture sanitized screenshots, traces, console/network status summaries, and accessibility/overflow assertions. Redact identities and tokens. Publish only those sanitized files as an Actions artifact if the test job supports artifact upload.
4. For remote owner review, do not point the candidate at the existing hosted development database. First establish an isolated backend reachable by the protected candidate and adapt the trusted candidate configuration to that backend without weakening exact-SHA checks. The present candidate workflow is pinned to the existing development Supabase project; therefore it cannot meet the isolated-data requirement as currently configured.
5. Only after a separate explicit authorization, use the protected immutable-candidate workflow for the exact SHA, verify Cloudflare Access/anonymous denial, and test the version URL without activating the normal Worker. Do not alter routes/DNS or enable financial integrations. If the disposable backend or candidate is exposed, stop access, preserve sanitized diagnostics, and remove only the candidate/test resources. Confirm candidate-version cleanup through the supported Cloudflare API before deleting anything.
6. Supabase Free-plan limits may constrain temporary hosted projects or concurrent compute. Prefer an ephemeral local Supabase stack for engineering tests; it is not equivalent to the remote protected preview. If remote authenticated owner acceptance is required, availability and cost of a disposable isolated backend must be established before deployment. No paid plan is assumed or authorized here.

## Required acceptance before advancing

- **Gate A:** real Supabase Auth-backed, isolated customer and admin browser journeys pass on the candidate; all CI remains green.
- **Gate B:** owner receives sanitized, exact-candidate evidence and personally accepts customer/admin UX, or completes an explicitly authorized Access-protected preview review.
- **Gate C:** only after a separately authorized merge, verify exact deployed SHA, migrations, RLS, Auth, compatibility, and financial release locks. Do not infer Gate C from this pre-merge audit.

Until these conditions are met, keep PR #82 OPEN/DRAFT. Funding and spending remain disabled; do not merge, deploy, apply migrations, or run financial/supplier operations.
