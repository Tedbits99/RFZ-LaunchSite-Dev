# Production launch requirements

**Requires Owner Approval; Pending Verification.** The canonical detailed checklist is [PRODUCTION_LAUNCH_CHECKLIST.md](../PRODUCTION_LAUNCH_CHECKLIST.md). It covers security, functional/admin behavior, database/backup integrity, payments/suppliers, email, domains, monitoring and cost approval without duplicating a second set of checkboxes.

Launch requires sequential verified PASS through Phase 20, the exact staged release identity, safe restoration/rollback evidence and explicit production authorization. No current document authorizes production deployment, database changes, DNS/email/payment settings or credential changes. Existing legacy website availability must be preserved; future Bolt tooling/deployment is prohibited.

Use [deployment runbook](../DEPLOYMENT.md), [deployment dependencies](DEPLOYMENT_DEPENDENCIES.md), [staging plan](STAGING_TEST_PLAN.md), [cost comparison](HOSTING_COST_COMPARISON.md) and the preserved [domain/DNS/email plan](../operations/DOMAIN_DNS_EMAIL_CUTOVER_PLAN.md). Any regression reopens the relevant verification gate. No verified PASS means no next phase.
