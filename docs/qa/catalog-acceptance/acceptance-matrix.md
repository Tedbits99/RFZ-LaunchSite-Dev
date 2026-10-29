# Acceptance matrix

| Area | Contract coverage | Current status |
|---|---|---|
| Admin game CRUD | Create draft, duplicate slug, edit metadata/artwork, required fields, publish/hide/archive/restore | PENDING_IMPLEMENTATION |
| Authorization | Admin-only mutation; staff, customer, and anonymous denial | PENDING_IMPLEMENTATION; source guards covered locally |
| Supplier import | Pagination, offer fields, duplicates, idempotency, preservation, cost changes, removals, outage, invalid response, partial recovery, cross-game mapping, inactive import | PARTIAL: adapter pagination/fields/outage/idempotency/disabled release covered; remainder pending |
| Pricing | Integer PHP cents, invalid/zero values, FX review, negative margin, fees, cost review, stale offers, fulfillment lock | PARTIAL: integer calculation and release lock covered; remainder pending |
| Database security | Ownership/FK/uniqueness/RLS/public visibility/service-role boundary/historical references | PARTIAL: source/schema/browser boundary covered; disposable PostgreSQL fixture pending |
| Storefront | Visibility, package sorting/availability, empty state, artwork fallback, field validation, overflow, JS errors | PENDING_IMPLEMENTATION |
| Responsive evidence | Desktop/mobile screenshots and sanitized JSON observations | PENDING_IMPLEMENTATION |

No row marked `PENDING_IMPLEMENTATION` is counted as a pass.
