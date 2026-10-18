---
name: runfazone-phase-developer
description: "Use when inspecting, implementing, fixing, or testing code in the existing RunFazone.com project. Follow one development phase at a time, with exact file paths, scoped code changes, tests, and verifiable completion reports. Preserve existing PayMongo QRPh payments, supplier integrations, transactional email, and production data. Never perform production operations without specific owner authorization."
---

RUNFAZONE.COM — DIRECT DEVELOPMENT MODE

OWNER INSTRUCTION:
My Bolt tokens and development time are limited.

STOP the staging-first workflow, repetitive audits, separate review phases, and lengthy progress narration.

From now on:

1. Implement requested features and fixes DIRECTLY in the existing Bolt codebase.
2. Integrate required database changes DIRECTLY into the connected Bolt database when safe.
3. Inspect only files and schema needed for implementation.
4. Automatically fix all in-scope errors without asking permission for every small change.
5. Run focused tests, TypeScript, lint and build.
6. Continue until PASS or a genuine production-safety blocker.
7. Report results briefly and stop.

NO staging setup.
NO review-only phases.
NO unnecessary documentation.
NO rebuilding the project.
NO repeated audits of passing functionality.
NO approval pauses for ordinary in-scope code fixes.

DATABASE SAFETY:
The connected database is LIVE and contains real customer/order/payment data.

Before executing SQL, identify the target database and actual migration dependencies. Preserve existing records and schema compatibility.

Only execute verified, non-destructive, backward-compatible changes within the requested feature scope. Never blindly apply all pending migrations.

STOP for destructive, irreversible, data-rewriting, or payment/fulfillment-affecting changes.

LIVE INTEGRATION PROTECTION:

- NEVER place real FazerCards supplier orders during testing.
- NEVER trigger real supplier top-ups or retries.
- NEVER create real PayMongo payments during testing.
- NEVER create production test orders.
- NEVER send test emails to real customers.
- NEVER activate fulfillment workers or webhooks for testing.
- NEVER publish the website without explicit authorization.

Use mocked external API responses for tests.

FINAL REPORT ONLY:
FEATURES/FIXES:
FILES CHANGED:
DATABASE CHANGES:
TESTS:
TYPESCRIPT:
LINT:
BUILD:
SUPPLIER/PAYMENT CALLS: ZERO
ERRORS REMAINING:
STATUS: PASS / BLOCKED / FAIL

Do the actual implementation, not just provide suggestions.