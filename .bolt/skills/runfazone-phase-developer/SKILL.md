---
name: runfazone-phase-developer
description: "Use when inspecting, implementing, fixing, or testing code in the existing RunFazone.com project. Follow one development phase at a time, with exact file paths, scoped code changes, tests, and verifiable completion reports. Preserve existing PayMongo QRPh payments, supplier integrations, transactional email, and production data. Never perform production operations without specific owner authorization."
---

# RUNFAZONE — PHASE-BY-PHASE DEVELOPMENT SKILL

## PURPOSE

You are working on the EXISTING RunFazone.com gaming top-up e-commerce application.

Use this skill whenever the owner requests code inspection, bug fixing, feature implementation, integration, testing, or phase verification.

The application uses Next.js App Router, TypeScript, React, Tailwind CSS, Supabase-compatible services, PayMongo QRPh, manual payments, FazerCards supplier integration, and an existing Titan SMTP transactional email system.

Never recreate the application or invent a different architecture.

## RULE 1 — EXECUTE THE SPECIFIC ASSIGNED TASK

Every user prompt is a development assignment.

Identify:

- The current phase and task.
- The exact code files involved.
- The requested behavior.
- The boundaries and acceptance criteria.

If the owner specifies file paths, open those files first.

Do not investigate unrelated features, PGlite, or database setup unless directly relevant to the task.

Do not respond only with a generic acknowledgment when a concrete task was supplied.

If the required files or tools are unavailable, report the exact blocker.

## RULE 2 — READ BEFORE EDITING

Before changing code:

1. Open and read the actual implementation.
2. Inspect relevant imports, helpers, API contracts, and tests.
3. Identify the confirmed defect or missing feature.
4. Check how the change could affect existing functionality.
5. Modify only authorized files.

Do not fabricate code evidence, test results, or database findings.

## RULE 3 — ONE PHASE AT A TIME

Follow the owner's organized workflow:

Phase 0 — Preserve and verify existing Bolt development changes.
Phase 1 — Customer authentication and account features.
Phase 2 — Storefront, checkout, PayMongo QRPh, and order access.
Phase 3 — Admin, supplier fulfillment, and reconciliation.
Phase 4 — Existing transactional email integration.
Phase 5 — Isolated database staging and migration rehearsal.
Phase 6 — Controlled production migration, deployment, and verification.

Work only on the currently assigned phase or smaller task.

Never begin the next phase automatically.

## RULE 4 — PRESERVE EXISTING FUNCTIONALITY

PayMongo QRPh is the ACTIVE production payment provider. HitPay is not the active production payment provider.

Preserve:

- Existing PayMongo payment creation and webhook behavior.
- Manual payment methods.
- Game packages and order processing.
- FazerCards supplier integration.
- Supplier idempotency and reconciliation protections.
- Customer authentication and guest order access.
- Existing Titan SMTP transactional emails.
- Admin access and permissions.
- Existing Bolt-only development changes.

Do not replace working implementations with mock data.

Use mocks only inside isolated development tests.

## RULE 5 — TEST EVERY CODE CHANGE

For applicable tasks, execute:

- Focused unit tests.
- npm test.
- npx tsc --noEmit.
- npm run lint.
- npm run build.

Report actual PASS, FAIL, or NOT RUN results.

Do not claim production functionality is verified merely because code compiles or mocked tests pass.

## RULE 6 — STRICT PRODUCTION SAFETY

The connected Bolt Cloud database contains real RunFazone production data.

The owner has placed the public website in maintenance mode.

Do not assume maintenance mode also blocks direct order API or database RPC access.

Unless the owner grants specific authorization for the actual production operation, NEVER:

- Apply production database migrations.
- Modify production orders, payments, customers, or supplier data.
- Change RLS policies, database permissions, or production secrets.
- Deploy production Edge Functions.
- Publish the website.
- Run real PayMongo payments, refunds, or webhook requests.
- Execute live supplier purchases.
- Send real customer emails.
- Modify existing SMTP credentials.
- Activate the completion-receipt worker.
- Push directly to GitHub main.
- Reset, delete, or replace the project workspace.

Preserve processing and reconciliation of existing in-flight payments.

Production database changes require prior staging rehearsal, validated backup/recovery, compatibility checks, a coordinated cutover plan, and separate explicit owner approval.

## RULE 7 — PRESERVE GITHUB AND BOLT WORK

GitHub repository:
Tedbits99/RFZ-LaunchSite

The merged main branch contains the previous integration work.

The current Bolt workspace may contain additional unpublished authentication and security fixes.

Never discard, overwrite, or reset these workspace changes.

Prefer reviewable feature branches and pull requests over direct main changes.

## RULE 8 — MANDATORY FINAL REPORT

After completing the assigned task, report:

PHASE:
TASK:
FILES READ:
FILES MODIFIED:
FILES CREATED:
IMPLEMENTATION OR FINDINGS:
FOCUSED TESTS:
FULL TEST SUITE:
TYPESCRIPT:
LINT:
BUILD:
PRODUCTION CHANGES: NONE or exact authorized changes
BLOCKERS:
PHASE STATUS: PASS / FAIL / BLOCKED

If no code changes were authorized, perform read-only inspection only.

Provide actual code evidence when requested.

Stop after the report. Wait for the owner's next task.

## RULE 9 — NEVER GUESS

If project context is missing, files cannot be read, or a tool fails:

- State exactly what is unavailable.
- State which operation failed.
- Do not invent results.
- Do not silently change tasks.
- Do not start unrelated investigations.
- Do not modify production as a workaround.

Successful completion requires verifiable work, not merely an acknowledgment.