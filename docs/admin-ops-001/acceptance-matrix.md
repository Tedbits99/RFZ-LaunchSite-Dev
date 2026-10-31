# ADMIN-OPS-001 implementation and acceptance matrix

This change is based on `f7c0b48cd4e79bf6164124950357d1dbdbce5954`. It is code-level work only. The owner separately authorized a normal protected merge into `main` only after the exact final head passes all applicable acceptance, security, schema, CI, and conflict checks; this does not authorize bypassing branch protection or enabling auto-merge. No hosted database/configuration change, deployment, payment, supplier action, or RF Coins activation is authorized.

## Feature matrix

| Workstream | Implementation | Evidence required before calling it accepted | Current boundary |
| --- | --- | --- | --- |
| Staff and roles | Staff membership is stored in `admins` and can only be assigned to an existing, confirmed Auth identity. Persisted STAFF/ADMIN permission grants are managed by a super admin. Server routes and server-rendered admin pages check the same grants. Self-role changes and removal of the last active super admin are rejected. | Staff/role route tests, migration security tests, and the disposable desktop/mobile browser acceptance. | No Auth invitation or credential creation is performed. |
| Single and bulk pricing | `/admin/pricing` edits catalog prices; `/api/admin/bulk-pricing` calls a row-locked, transactional database operation. Changed packages become inactive drafts; supplier-linked packages are flagged for review. | Pricing API tests, database transaction/security tests, browser persistence and catalog visibility assertions. | No automatic publishing or checkout of unreviewed price changes. |
| Tasks | Tasks persist in `admin_tasks`; create/edit/archive/restore changes produce append-only audit events. | Migration tests and browser CRUD/audit assertions. | No external task-system integration. |
| Tickets | Ticket status and priority use the existing columns and are audited; protected admin history is read-only. Unsafe public ticket/message reads are removed. | Ticket API, database policy/audit and browser assertions. | Customer ownership, replies, and email require owner decisions (see [owner-required.md](owner-required.md)). No replies or email are sent. |
| Audit log | `admin_audit_events` records actor, role, action, target, timestamp, and allowlisted metadata. Database triggers reject row mutation and truncate; only a super admin can read the API. | PostgreSQL ACL/trigger tests and audit-feed authorization/browser assertions. | Operational database owners remain outside the application audit boundary. |
| System health and security | Server-side, read-only checks return actual local runtime/database/configuration state, checked timestamps, safe error messages, secret-presence booleans, and explicit unknown/not-tested external states. | Diagnostics route tests and browser rendering. | A local/development response is never production evidence; no external provider checks are sent. |
| Central admin settings | The hub links existing catalog, promotions, payments, and system settings rather than duplicating their systems. Guest checkout uses its existing authenticated database RPC; secret values are never returned. | Checkout policy route tests, existing feature regressions, and browser assertions. | Payment, supplier, and RF Coins activation remain locked and owner-controlled. |
| Generic approvals | Not implemented. No supported general approvals table, producer, or consumer exists. | Owner defines covered actions, actors, separation-of-duties, expiry, cancellation, and rejection semantics. | `OWNER_REQUIRED`. |
| Blocklist | Not implemented. No supported persistence contract or enforcement consumer exists. | Owner defines identity types, normalization, privacy/retention, enforcement points, exceptions, and audit/removal behavior. | `OWNER_REQUIRED`; a list without enforcement would be misleading. |
| Risk alerts | Hard-coded cards are replaced by an explicit unavailable/owner-required state. | Owner defines signals, thresholds, windows, severity, delivery, retention, and enforcement. | `OWNER_REQUIRED`. |
| Existing catalog, orders, payments, suppliers, RF Coins, email, and customer account flows | Existing systems are preserved; permission gates were aligned with the persisted permission matrix where admin routes/pages use privileged access. | Existing unit/API regressions and the exact-head PR CI workflows. | Hosted behavior is not tested or changed. Supplier fulfillment, automated payments, and RF Coins funding/spending remain disabled. |

## Disposable acceptance

Run from the repository root on a machine with Docker resources available:

```bash
bash scripts/admin-ops-001/run-local-acceptance.sh
```

The wrapper uses the Catalog disposable-stack harness: it creates an unlinked local Supabase PostgreSQL/Auth stack, applies the canonical migration sequence, provisions synthetic `.invalid` identities and fixtures, builds/starts Next.js on loopback, runs relevant database contracts and both desktop/mobile browser projects, then stops the stack and removes only its temporary directory. It refuses non-loopback test API endpoints. The application is configured for mock payment mode; the acceptance tests do not contact payment, supplier, or email providers.

The dedicated PR check runs that command on GitHub Actions with read-only repository permissions and synthetic fixture credentials only. Test artifacts contain synthetic records and sanitized UI evidence. Hosted Supabase credentials are not required.

## Final evidence policy

Only exact-head, executed checks count as PASS. Skipped tests, placeholders, mocks standing in for database behavior, a missing disposable environment, and unverified hosted configuration do not count as acceptance evidence. Owner-required and hosted-only items must remain explicit blockers; they are not upgraded to PASS by this PR.
