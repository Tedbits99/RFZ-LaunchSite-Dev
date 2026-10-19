# RunFazone master roadmap 2026 — Phases 0–20

**Authoritative sequence:** 0 → 1 → … → 20, one phase at a time. The attachment lists 21 items using 1-based list numbering; this document retains the original Phase 0–20 identifiers and full original scope. Current execution is Phase 0. Prior Phase 1 edits are preserved historical work, not permission to continue implementation.

## Common gate for every phase

Each phase requires implemented mandatory scope (except Phase 0 audit deliverables), appropriate admin controls, verified database/security/integration behavior, applicable unit/regression/integration/browser checks, zero failing mandatory tests, zero TypeScript/lint/build errors, zero unresolved scoped security vulnerabilities or blocking warnings, and evidence for every acceptance criterion. Do not suppress assertions or skip failures to obtain PASS. Missing mandatory verification means BLOCKED; a failed requirement means FAIL. Future implementation gaps properly recorded do not themselves fail Phase 0.

**Approval:** after PASS, publish evidence and wait for explicit owner approval of the next numerical phase. Separate approval remains required for production changes, paid services, credentials, real email/payments/supplier transactions and RF Coins activation/prepaid sales. Infrastructure execution is Phase 2, not this audit.

## Phase 0 — Full codebase, database and feature inventory

- **Required deliverables:** Reconciled source/control/schema inventory, ownership/portability, security, costs and all phase gates.
- **Reusable functionality:** Existing source, prior audit, tests and DNS/email plan.
- **Missing / unverified:** Live backend inventory, complete target behavior, isolated DB tests and push safety evidence.
- **Assigned defects:** A0-001–A0-004; P0-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Read-only account/project metadata; no production mutation.
- **Required tests:** All safe baseline commands and classified failures/skips; every mandatory audit item evidenced.
- **Objective acceptance:** No mandatory audit unknown/blocker remains; future implementation defects fully recorded and assigned.
- **Cost impact:** No new paid services or production actions; public research/local validation only.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 1 — Production security, credential recovery and deployment integrity

- **Required deliverables:** Supported dependency/runtime baseline, secret recovery plan, data-layer authorization, protected release controls.
- **Reusable functionality:** Auth guards/recovery tests and prior uncommitted hardening.
- **Missing / unverified:** Deployed correction verification, supported ESLint, complete permission checks and safe push/deploy mapping.
- **Assigned defects:** P1-001–P1-007; A1-001–A1-007 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Verified Phase 0; owner-controlled secrets/configuration; RLS metadata.
- **Required tests:** Auth/role/origin/recovery regressions, advisory/secret scans, supported CI runtime and staged denial tests.
- **Objective acceptance:** Zero mandatory security/release defects and failing checks; target corrections evidenced.
- **Cost impact:** No new subscription assumed; targeted tooling/runtime changes require cost review.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 2 — Database architecture, background jobs, monitoring, migrations and backups

- **Required deliverables:** Independent infrastructure, reconciled migrations, durable jobs, observable health, proven backup/restore.
- **Reusable functionality:** Postgres migrations/RPCs, outbox, cron and reconciliation workers; Cloudflare/OpenNext deployment configuration to be added only after compatibility gates. Existing Netlify config is legacy evidence and not the selected host.
- **Missing / unverified:** Backend ownership/transfer outcome, complete receipt worker, real health checks and recovery evidence.
- **Assigned defects:** P2-001/P2-002; A2-001–A2-003 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 1 PASS/approval; ownership/export rights; safe isolated environment.
- **Required tests:** Fresh/upgrade schema tests, RPC/RLS roles, worker leases/retries, restore and alert drills.
- **Objective acceptance:** Supported migration path, verified jobs/alerts/backups and approved independent hosting; no duplicate workers.
- **Cost impact:** Use the approved architecture budget; migrations, storage, backups and staging compute can change costs.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 3 — Customer authentication, account security and staff access controls

- **Required deliverables:** Complete verified identity lifecycle and staff permission/approval matrix.
- **Reusable functionality:** Customer/admin namespaces, login/signup/recovery, staff/roles pages.
- **Missing / unverified:** Real staff invite/revoke UI, full account security and staged Auth/mail settings.
- **Assigned defects:** P3-001; A3-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 2 PASS/approval; Auth/RLS and SMTP readiness.
- **Required tests:** Signup/recovery/replay/rate limits; user A/B; inactive/role escalation and offboarding.
- **Objective acceptance:** Every required account/staff action works and denies unauthorized contexts with audit evidence.
- **Cost impact:** No fixed added subscription assumed; measure usage/storage/email/operations impacts and obtain approval before spend.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 4 — Complete product catalog, game packages, digital inventory and item management

- **Required deliverables:** Complete catalog, SKU mapping, digital stock/reservation lifecycle and admin management.
- **Reusable functionality:** Game/package/input schemas, catalog APIs and admin managers.
- **Missing / unverified:** Verified catalog completeness, inventory allocation/expiry and reconciliation.
- **Assigned defects:** P4-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 3 PASS/approval; supplier IDs and authoritative inventory schema.
- **Required tests:** CRUD permissions, invalid/missing SKU, reservation races, exhausted/expired stock.
- **Objective acceptance:** All offered products have valid pricing/mapping/stock and tested admin lifecycle.
- **Cost impact:** No fixed added subscription assumed; measure usage/storage/email/operations impacts and obtain approval before spend.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 5 — Intelligent pricing, costs, margins, fees and promotional pricing

- **Required deliverables:** Cost provenance, fee/margin calculations, promotions, price history and guardrails.
- **Reusable functionality:** Integer-cent order logic, package/bulk price tools, FX route.
- **Missing / unverified:** Landed supplier costs, tested FX freshness and loss-prevention controls.
- **Assigned defects:** P5-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 4 PASS/approval; verified costs and catalog identifiers.
- **Required tests:** Rounding, stale FX, discounts/fees, margin boundaries and price-tampering tests.
- **Objective acceptance:** Order totals and margin reports reconcile to authoritative costs with no unsafe negative-margin path.
- **Cost impact:** No fixed added subscription assumed; measure usage/storage/email/operations impacts and obtain approval before spend.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 6 — Universal checkout, cart, player validation and payment eligibility

- **Required deliverables:** Cart/multi-item requirements, eligibility and player-validation failure handling.
- **Reusable functionality:** Single-order checkout, voucher RPCs, player checks and guest capability.
- **Missing / unverified:** Universal cart and complete game/provider eligibility matrix.
- **Assigned defects:** P6-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 5 PASS/approval; server prices and inventory constraints.
- **Required tests:** Tampering, duplicate submit, validation outages, multi-item eligibility and ownership.
- **Objective acceptance:** Every accepted cart/order has correct prices, verified inputs and deterministic recovery.
- **Cost impact:** No fixed added subscription assumed; measure usage/storage/email/operations impacts and obtain approval before spend.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 7 — Payment gateway, webhook security, refunds and reconciliation

- **Required deliverables:** Verified selected gateway, webhook/security, refunds and settlement reconciliation.
- **Reusable functionality:** PayMongo QR/webhook, adapters, transactions, admin verification/refund records.
- **Missing / unverified:** Complete provider refunds, active-path proof and placeholder-adapter handling.
- **Assigned defects:** P7-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 6 PASS/approval; provider sandbox access and schema invariants.
- **Required tests:** Wrong signature/amount/currency, duplicates/late events, refund failures and settlement assertions.
- **Objective acceptance:** No unverified payment can fulfill; every payment/refund is traceable, idempotent and reconciled.
- **Cost impact:** Consume the existing approved platform budget; measure compute/storage/log growth before upgrades. Provider transaction/fulfillment costs require separately approved test budgets.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 8 — Multi-supplier integration, fulfillment automation and recovery

- **Required deliverables:** Real adapter contracts, safe fulfillment, bounded recovery and manual controls.
- **Reusable functionality:** FazerCards adapter, mappings, captured snapshots, atomic claims and retries.
- **Missing / unverified:** Verified additional suppliers/failover and dead-letter workflows.
- **Assigned defects:** P8-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 7 PASS/approval; approved supplier sandbox/contract and paid-state proof.
- **Required tests:** Concurrent claims, timeout-after-acceptance, duplicate callbacks, SKU changes and recovery.
- **Objective acceptance:** No duplicate/unpaid top-up; every attempt/outcome is auditable and recoverable.
- **Cost impact:** Consume the existing approved platform budget; measure compute/storage/log growth before upgrades. Provider transaction/fulfillment costs require separately approved test budgets.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 9 — RF Coins wallet with an immutable double-entry ledger

- **Required deliverables:** Balanced double-entry accounting for closed-loop nontransferable reward credits.
- **Reusable functionality:** Movement ledger, wallet projection, idempotency/adjustment RPC tests.
- **Missing / unverified:** Journal/accounts model, invariant proof and regulatory/accounting review.
- **Assigned defects:** P9-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 8 PASS/approval; finance/security sign-off; production flags checked read-only.
- **Required tests:** Balanced postings, append-only enforcement, races, overdraft, projection rebuild and reversals.
- **Objective acceptance:** All movements balance and reconcile; activation approved; prepaid sales remain off absent separate approval.
- **Cost impact:** No fixed added subscription assumed; measure usage/storage/email/operations impacts and obtain approval before spend.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 10 — RF Coins redemption, product purchasing, split payments and wallet refunds

- **Required deliverables:** Approved redemption, split tender and unified wallet/provider refund operations.
- **Reusable functionality:** Full-wallet order settlement, handoff and reversal code.
- **Missing / unverified:** Split payments and comprehensive failure/refund accounting.
- **Assigned defects:** P10-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 9 PASS/approval; accepted ledger and gateway invariants.
- **Required tests:** Partial failures, replay, split settlement/refund, handoff crash and race tests.
- **Objective acceptance:** No lost/double funds; every tender/refund reconciles and fulfillment occurs once.
- **Cost impact:** Consume the existing approved platform budget; measure compute/storage/log growth before upgrades. Provider transaction/fulfillment costs require separately approved test budgets.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 11 — Rewards, loyalty tiers, referrals and promotional coin issuance

- **Required deliverables:** Defined earn/burn rules, tiers/referrals, abuse prevention and admin campaign controls.
- **Reusable functionality:** Voucher/promotion and adjustment primitives.
- **Missing / unverified:** Complete reward/referral lifecycle and campaign accounting.
- **Assigned defects:** P11-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 10 PASS/approval; verified ledger and reward-only scope.
- **Required tests:** Referral replay/abuse, expiry, tier boundaries, issuance authorization and campaign reconciliation.
- **Objective acceptance:** Every award is authorized, bounded, auditable and reconcilable.
- **Cost impact:** No fixed added subscription assumed; measure usage/storage/email/operations impacts and obtain approval before spend.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 12 — Complete customer dashboard, purchases, security and wallet management

- **Required deliverables:** Complete customer history, settings/security and wallet statements.
- **Reusable functionality:** Account order/profile/wallet pages and APIs.
- **Missing / unverified:** Full staged ownership/privacy/responsive proof and remaining dashboard flows.
- **Assigned defects:** P12-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 11 PASS/approval; verified customer/ledger data.
- **Required tests:** Cross-account IDs, sessions, history pagination, profile updates, statements and responsive tests.
- **Objective acceptance:** Customers see only their own complete accurate records and can use all required controls.
- **Cost impact:** No fixed added subscription assumed; measure usage/storage/email/operations impacts and obtain approval before spend.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 13 — Customer support, disputes, cancellations and refund operations

- **Required deliverables:** Customer/staff support lifecycle, SLA/escalation, cancellation and disputes.
- **Reusable functionality:** Support schema/admin tickets and refund records.
- **Missing / unverified:** Complete ticket flow and gateway/wallet refund integration.
- **Assigned defects:** P13-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 12 PASS/approval; tested refund/accounting transitions.
- **Required tests:** Ticket authorization, attachments, cancellation races, dispute escalation and refunds.
- **Objective acceptance:** Every support/refund case has authorized states, audit trail and consistent financial outcome.
- **Cost impact:** No fixed added subscription assumed; measure usage/storage/email/operations impacts and obtain approval before spend.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 14 — Complete Admin Command Center with functional controls for every system

- **Required deliverables:** Complete role-aware controls, filters, pagination, approvals and audit.
- **Reusable functionality:** 32 admin pages and indexed actions.
- **Missing / unverified:** All placeholder/unbound controls, including task creation; cross-module consistency.
- **Assigned defects:** P14-001; A14-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 13 PASS/approval; each underlying module and privilege matrix.
- **Required tests:** Every control happy/failure/permission path, destructive confirmations and audit events.
- **Objective acceptance:** No fake data or inactive required buttons; all admin controls function securely.
- **Cost impact:** No fixed added subscription assumed; measure usage/storage/email/operations impacts and obtain approval before spend.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 15 — Finance, accounting, profitability, settlements and reports

- **Required deliverables:** Chart of accounts, settlements, profitability, fees/refunds and liabilities.
- **Reusable functionality:** Analytics/export, transaction/cost and ledger records.
- **Missing / unverified:** Balanced accounting/reporting and independently reconciled settlement data.
- **Assigned defects:** P15-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 14 PASS/approval; approved accounting rules and tested ledger/payment data.
- **Required tests:** Independent fixtures, reconciliation differences, exports, fees/FX and refunds.
- **Objective acceptance:** Reports reproduce verified balances/settlements and expose every unexplained difference.
- **Cost impact:** No fixed added subscription assumed; measure usage/storage/email/operations impacts and obtain approval before spend.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 16 — Marketing, CMS, SEO, promotions and customer retention

- **Required deliverables:** Content lifecycle, safe campaigns, SEO/consent and retention controls.
- **Reusable functionality:** Announcements, vouchers/promotions, sitemap/robots.
- **Missing / unverified:** Scheduling/rollback, attribution, consent-aware automation and measurement.
- **Assigned defects:** P16-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 15 PASS/approval; mail quota and privacy rules.
- **Required tests:** Content escaping, publication/expiry, canonical metadata, consent and campaign dedupe.
- **Objective acceptance:** Published content and campaigns are authorized, reversible, measurable and privacy-compliant.
- **Cost impact:** No fixed added subscription assumed; measure usage/storage/email/operations impacts and obtain approval before spend.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 17 — Security, fraud prevention, privacy and regulatory compliance

- **Required deliverables:** Complete threat model, fraud controls, privacy/retention and verified security reporting.
- **Reusable functionality:** RLS/guards, rate limits, block/risk/security UI and prior security tests.
- **Missing / unverified:** Effective target controls, data rights and compliance evidence.
- **Assigned defects:** P17-001; A17-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 16 PASS/approval; owner/legal/accounting decisions as applicable.
- **Required tests:** Role/RLS/abuse matrix, privacy requests, retention, fraud failures and security regression suite.
- **Objective acceptance:** No scoped unresolved security/privacy blockers; claims reflect measured controls.
- **Cost impact:** No fixed added subscription assumed; measure usage/storage/email/operations impacts and obtain approval before spend.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 18 — Intelligent automation, supplier optimization and self-healing workflows

- **Required deliverables:** Bounded optimization, circuit breakers, manual recovery and observable automation.
- **Reusable functionality:** Reconciliation, handoff, outbox and task primitives.
- **Missing / unverified:** Verified dead-letter/self-healing policies and safe optimization.
- **Assigned defects:** P18-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 17 PASS/approval; stable controls, observability and budget.
- **Required tests:** Failure injection, bounded retries, circuit-breaker recovery and human override.
- **Objective acceptance:** Automation cannot bypass financial/auth gates and every failure has a safe bounded outcome.
- **Cost impact:** No fixed added subscription assumed; measure usage/storage/email/operations impacts and obtain approval before spend.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 19 — Mobile UX, accessibility, performance and comprehensive QA

- **Required deliverables:** Supported-device/browser accessibility, performance and regression evidence.
- **Reusable functionality:** Existing responsive Tailwind UI and local tests.
- **Missing / unverified:** Current real browser/device/accessibility/load verification.
- **Assigned defects:** P19-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 18 PASS/approval; stable staged release and realistic synthetic load.
- **Required tests:** Keyboard/screen reader, responsive layouts, latency/load and complete regression tests.
- **Objective acceptance:** Owner-approved accessibility/performance targets and all mandatory scenarios verified.
- **Cost impact:** No fixed added subscription assumed; measure usage/storage/email/operations impacts and obtain approval before spend.
- **Owner approval:** common gate above; no automatic progression or production action.

## Phase 20 — End-to-end staging validation, disaster recovery and production launch gates

- **Required deliverables:** Exact-release staging PASS, recovery drill, independent host cutover and launch approval.
- **Reusable functionality:** Runbooks, local CI/tests and preserved legacy site.
- **Missing / unverified:** Provider/SMTP/browser/restore evidence and production configuration sign-off.
- **Assigned defects:** P20-001 in the [master register](MASTER_ISSUE_REGISTER.md).
- **Security/database dependencies:** Phase 19 PASS/approval; all dependency owners and rollback assets.
- **Required tests:** Full staging/end-to-end tests, restore/rollback, DNS/HTTPS/mail preservation and safe launch checks.
- **Objective acceptance:** All mandatory launch gates clear; owner separately approves production cutover; no automatic launch.
- **Cost impact:** No fixed added subscription assumed; measure usage/storage/email/operations impacts and obtain approval before spend.
- **Owner approval:** common gate above; no automatic progression or production action.

## Supporting evidence

[Current audit](PHASE_00_AUDIT.md), [source/action inventory](SOURCE_INVENTORY.md), [database declarations](DATABASE_OBJECT_INVENTORY.md), [validation evidence](VALIDATION_EVIDENCE.md), [cost comparison](HOSTING_COST_COMPARISON.md) and [phase status](PHASE_STATUS.md). The [earlier baseline](../roadmap/PHASE_0_BASELINE_AND_GAP_ANALYSIS.md) remains historical reference; current counts/status and platform policy here supersede stale statements.
