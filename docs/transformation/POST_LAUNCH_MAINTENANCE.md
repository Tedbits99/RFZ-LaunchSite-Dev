# Post-launch maintenance

**Proposed; launch has not been approved or performed.** The canonical operational runbook is [MAINTENANCE.md](../MAINTENANCE.md), covering daily order/worker checks, weekly quotas/backups/access, monthly dependency/security/renewal review, incident response and recovery.

Before using it, assign the operator, confirm retention/alerting and backup/restore capabilities, approve RPO/RTO and budgets, and execute a restoration rehearsal. Static dashboard status cards are not service monitoring. Do not add paid tools or enable unattended financial/supplier automation without evidence and approval.

Record incidents, tests and release identities in the [issue register](MASTER_ISSUE_REGISTER.md) and [phase status](PHASE_STATUS.md). Reuse [database guidance](../DATABASE_AND_MIGRATIONS.md) and [deployment rollback](../DEPLOYMENT.md); preserve domain and Titan service throughout recovery. No new Bolt development/deployment is permitted.
