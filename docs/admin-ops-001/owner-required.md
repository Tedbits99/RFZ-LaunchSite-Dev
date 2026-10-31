# ADMIN-OPS-001 — owner-required product decisions

This file records gaps that cannot safely be implemented from existing product behavior. The admin UI labels these states explicitly; no fake rows or “active” controls are presented.

## Generic approvals

- No generic `approvals` table or migration exists in the repository history; the old page's query was not backed by a repository schema.
- No general request producer/consumer exists for refunds, pricing, staff changes, or catalog publishing.
- RF Coins high-value operations have their own database-level second-distinct-super-admin rule and are not a generic approval queue.
- Owner must define covered actions, requester and approver roles, distinct-actor rules, pending-operation semantics, expiry/cancellation, and rejection reasons before a generic approval workflow is added.

## Blocklist

- No `blocklist` table, CRUD API, or checkout/auth consumer exists in repository migrations/application code.
- Owner must define identifier types, trusted identity source, normalization, privacy/retention, exact blocked operations, exception handling, and audit/removal policy. A stored list with no enforcement point is not represented as a security feature.

## Risk alerts

- Existing risk cards were constants, not measured signals. No persisted rules, signal queries, scheduler, delivery destination, or enforcement exists.
- Owner must define signal definitions and thresholds, time windows, severity, delivery, retention, false-positive handling, and whether alerts block any operation.

## Ticket replies and customer access

- Existing support tables store tickets/messages, but no secure public ticket-ownership capability or customer reply/read endpoint was found. Existing public read policies were removed by the additive security migration because they exposed every row.
- Ticket status and priority changes are implemented against existing columns and are audited. Admin message replies/email are deliberately absent until the owner specifies a customer ownership/retrieval contract, outbound communication policy, and abuse controls.
