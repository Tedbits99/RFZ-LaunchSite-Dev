# Voucher System Documentation

## Architecture Overview

The voucher system is a full-stack feature integrated into the existing RunFazone game top-up platform. It follows a strict server-side validation model where the frontend never computes or trusts discount values.

### Flow

```
Admin creates voucher → Database
                           ↓
Customer enters voucher code at checkout
                           ↓
Frontend calls POST /api/vouchers/validate
                           ↓
Backend loads package price from DB (never trusts frontend subtotal)
                           ↓
Backend validates voucher rules (active, dates, limits, restrictions)
                           ↓
Backend computes discount + final total
                           ↓
Frontend displays discount preview
                           ↓
Customer confirms order → POST /api/orders
                           ↓
Backend REVALIDATES voucher (does not trust prior validation)
                           ↓
Backend computes authoritative final_total
                           ↓
Order created with final_total
                           ↓
Atomic voucher consumption (consume_voucher DB function)
                           ↓
Payment QR generated from order.total_cents
```

## Database Tables

### `vouchers`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | Unique identifier |
| code | text UNIQUE | Voucher code (case-insensitive via expression index) |
| name | text | Optional display name |
| description | text | Optional description |
| discount_type | text | `PERCENTAGE` or `FIXED` |
| discount_value | integer | Percentage (0-100) or fixed amount in centavos |
| min_order_cents | integer | Minimum purchase required (0 = none) |
| max_discount_cents | integer | Cap on discount for percentage type (null = none) |
| usage_limit | integer | Max total uses (null = unlimited) |
| usage_count | integer | Current usage count (atomically incremented) |
| per_user_limit | integer | Max uses per customer email |
| starts_at | timestamptz | When voucher becomes valid |
| ends_at | timestamptz | When voucher expires (null = never) |
| is_active | boolean | Admin toggle |
| applies_to_game_id | uuid FK | Restrict to specific game (null = all games) |
| created_by | text | Admin email who created it |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `voucher_usages`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| voucher_id | uuid FK | References vouchers |
| order_id | uuid FK | References orders |
| email | text | Customer email |
| discount_amount_cents | integer | Actual discount applied (snapshot) |
| code | text | Voucher code at time of use (snapshot) |
| subtotal_cents | integer | Order subtotal (snapshot) |
| final_total_cents | integer | Final total after discount (snapshot) |
| created_at | timestamptz | |

### `orders` (extended with voucher snapshot columns)

| Column | Type | Description |
|--------|------|-------------|
| voucher_id | uuid | Links to voucher (null if no voucher) |
| voucher_code | text | Code snapshot |
| voucher_discount_type | text | Type snapshot |
| voucher_discount_value | integer | Value snapshot |
| voucher_discount_cents | integer | Actual discount applied |

These snapshot columns ensure historical orders remain accurate even if the voucher is later edited or deleted.

## Security

### Server-Side Validation Only
- The frontend never computes discounts, totals, or validates vouchers.
- All calculations happen on the server using database-sourced prices.
- The `/api/vouchers/validate` endpoint loads the actual package price from the database.

### Admin-Only Management
- All voucher CRUD operations (`/api/admin/vouchers/*`) require admin authentication.
- The `requireAdmin` helper verifies the request comes from an active admin user.
- Customers calling admin endpoints receive a 403 Forbidden response.

### Atomic Usage Control
- The `consume_voucher()` PostgreSQL function (SECURITY DEFINER) atomically increments `usage_count` with a `WHERE usage_count < usage_limit` guard.
- This prevents race conditions where two customers consume the final voucher simultaneously.
- The function inserts the usage record in the same operation.

### Rate Limiting
- The validate endpoint includes per-IP/email rate limiting (10 attempts per minute).
- Prevents voucher brute-force attacks.

### Case-Insensitive Codes
- Voucher codes are normalized to uppercase and matched case-insensitively.
- A unique expression index on `upper(code)` prevents duplicates.

## Discount Calculation

```
if discount_type == PERCENTAGE:
    discount = round(subtotal * discount_value / 100)
    if max_discount_cents is set:
        discount = min(discount, max_discount_cents)
else:  # FIXED
    discount = discount_value

discount = min(discount, subtotal)  # never exceed subtotal
discount = max(discount, 0)         # never negative
final_total = max(0, subtotal - discount)
```

## Payment QR Synchronization

The payment QR amount always equals the order's `total_cents`:

- **No voucher**: `total_cents = subtotal_cents` → QR amount = subtotal
- **Valid voucher**: `total_cents = subtotal_cents - discount_cents` → QR amount = discounted total
- **Voucher removed**: Order created without voucher → QR amount = original subtotal

The checkout page (`/checkout?order=...`) loads the order from the database and generates the QR from `order.total_cents`. The QR is never computed from frontend values.

## Voucher Status

Effective status is calculated from multiple fields:

| Status | Condition |
|--------|-----------|
| Active | `is_active = true` AND `starts_at <= now` AND (`ends_at` is null OR `ends_at >= now`) AND (`usage_limit` is null OR `usage_count < usage_limit`) |
| Inactive | `is_active = false` |
| Scheduled | `starts_at > now` |
| Expired | `ends_at < now` |
| Usage Limit Reached | `usage_limit` is not null AND `usage_count >= usage_limit` |

## API Endpoints

### `POST /api/vouchers/validate`
Customer-facing. Validates a voucher code and returns the computed discount.

### `POST /api/orders`
Customer-facing. Creates an order. If `voucherCode` is provided, revalidates and applies the discount server-side, then atomically consumes the voucher.

### `GET /api/admin/vouchers`
Admin-only. Lists all vouchers.

### `POST /api/admin/vouchers`
Admin-only. Creates a new voucher.

### `GET /api/admin/vouchers/[id]`
Admin-only. Gets a voucher with its usage history.

### `PATCH /api/admin/vouchers/[id]`
Admin-only. Updates a voucher. Cannot change the code (to preserve historical references).

### `DELETE /api/admin/vouchers/[id]`
Admin-only. Deletes a voucher only if it has no usage records. Otherwise, deactivate instead.
