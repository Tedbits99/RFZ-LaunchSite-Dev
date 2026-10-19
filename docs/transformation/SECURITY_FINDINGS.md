# Security findings

**Scope:** current working-tree source, existing regression tests, safe dependency/static/history checks and limited public/account metadata. No live exploitation or production secret inspection. **Phase 0 records issues; it does not authorize source or production remediation.**

## Confirmed findings and retained corrections

| Finding | Severity / evidence | Phase and disposition |
|---|---|---|
| FazerCards public-key authorization formerly allowed sensitive operations | Historical critical source boundary; prior local change adds verified active admin and super-admin/confirmation checks | P1-001, fixed locally only; deployed state unknown |
| Public archive worker/RPC permissions | Historical high source boundary; local bearer/grant corrections and PGlite test exist | P1-002, migration not applied hosted |
| Inactive/admin server access | Historical critical concern; local active-admin and server-layout checks added | P1-003 + A1-004; full data-layer/runtime denial still pending |
| Public fallback candidate reads | Historical high privacy concern; local protected API replaces fallback | P1-004; target verification pending |
| main protected:false, rulesets [] | High release integrity finding from GitHub API | A1-002; no settings changed |
| ESLint 9 unsupported | Medium maintenance/supply-chain risk; npm warning and official EOL policy | A1-001; Phase 1 upgrade review required |
| Generic env files not ignored | Medium exposure-prevention gap, not confirmed disclosure | A1-003; only example tracked |
| Hardcoded security/health claims | High operational assurance problem | A2-002/A17-001; dashboards are not security evidence |

The [ESLint support policy](https://eslint.org/version-support/) marks v9 end-of-life on 2026-08-06. The current dependency audit reports zero registered advisories; unsupported software still requires review. No application changes were made in this audit.

The full database harness additionally fails closed on the RF Coins migration's outbound hosted-function helper (A1-007). Prerequisites were installed, but the guard stopped execution before database startup. Do not bypass it to obtain a green result.

## Boundary review and remaining evidence

- **Auth/session/recovery:** namespaced customer/admin/recovery clients, verified-user checks, origin handling and HMAC recovery/resend helpers exist with local tests. Real Auth configuration, redirect allow-lists, email and browser flows remain unverified.
- **Admin privileges:** current orders/supplier routes call `requireAdmin`, contrary to older documentation. Per-action staff roles and privileged server data access need a complete denial matrix. Do not rely solely on layout/UI hiding.
- **RLS/RPCs:** grants, PUBLIC execution, SECURITY DEFINER ownership/search_path, prior policy replacements and Auth role dependencies are inventoried. Live effective policies cannot be reconstructed with certainty from source history alone.
- **Injection/XSS:** parameterized Supabase/RPC calls and HTML escaping in the mail sender are visible; this is not a complete taint analysis. Stored content, URL validation, SQL dynamic expressions, uploads and exports still need scoped tests.
- **CSRF/CORS:** source includes Auth origin checks; several Edge functions allow `*` CORS. CORS is not authentication. All `verify_jwt=false` endpoints need explicit tested signature/user/service authorization. Broad CORS alone is not proof of an exploit.
- **Webhooks/financial integrity:** signature/amount/order/idempotency and atomic claim code/tests exist. Provider sandbox replay, mismatched events, concurrent fulfillment and refund accounting remain pending. No transaction or supplier purchase was executed.
- **Logging/secrets:** server/Edge error logs can contain upstream error detail; review redaction and retention before launch. No actual secret values were copied. Private credentials must never use a public variable prefix.
- **Storage/uploads:** source/config does not establish live bucket policies, object limits, content validation or recovery. Mark pending, do not assume storage is ready from a dashboard label.
- **RF Coins:** movement-ledger and prepaid-top-up code exists; full double-entry/regulatory readiness and production flags remain unverified. Activation is prohibited until assigned gates and approvals.

## Secret/history scan limits

A local heuristic scan read 914 reachable historical text blobs across Git refs for private-key markers and selected high-confidence provider-token formats. It found zero candidates for those patterns. It did not print matching values. Only the env example is currently tracked; no history entries for the specifically checked `.env`, `.env.local` or `.env.production` paths were returned. This does **not** prove all history is secret-free: generic passwords, JWT/service-role formats, unreferenced objects, renamed files and provider-side revocation were not comprehensively verified. Use an approved full secret scanner in Phase 1; no history rewrite or credential rotation is authorized here.

See [validation evidence](VALIDATION_EVIDENCE.md), [current issue register](MASTER_ISSUE_REGISTER.md) and [retained detailed findings](../roadmap/MASTER_ISSUE_REGISTER.md). There is no verified zero-vulnerability or production-security PASS claim.
