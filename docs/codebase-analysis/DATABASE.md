# Database and data model

## Core entities

The migration history establishes `games`, `packages`, and `game_input_fields`; `orders` references the selected game/package and stores email, customer/player inputs, cents amounts, payment method/reference, status, voucher snapshot, payment state, fulfillment state, supplier mapping snapshot, archive fields, and timestamps. `order_timeline` is the append-oriented audit trail.

Payment entities include `payment_config`, `payment_transactions`, `payment_submissions`, `refunds`, and `email_sent_log`. Promotion/catalog support includes `promotions`, `announcements`, and `global_announcement`. Voucher support includes `vouchers` and `voucher_usages` with unique `(voucher_id, order_id)`.

Supplier support includes `suppliers`, `supplier_package_mappings`, `supplier_transactions`, and `supplier_test_runs`. Admin/support entities include `admins`, `app_settings`, `notifications`, `support_tickets`, and `support_messages`. Player verification uses `player_cache`, `verified_users`, and `verification_attempts`.

## Relationships and authoritative writes

- Game → packages and input fields.
- Package → orders and supplier mappings.
- Order → timeline, payment submissions/transactions, refunds, voucher usage, supplier transactions, and optional captured supplier mapping.
- Supplier → mappings, transactions, and test runs.
- Promotions can target games/packages; voucher applicability can target a game.

The principal transactional functions are `create_order`, `submit_payment`, `validate_voucher`, `verify_payment`, `complete_fulfillment`, `admin_change_order_status`, `admin_get_all_payment_config`, and supplier/payment helper functions. The migrations explicitly use `SECURITY DEFINER` and set `search_path` in later hardening work.

## State model

Order `status` is the overall lifecycle. Later migrations separate `payment_status` (`UNPAID`, `PENDING`, `VERIFIED`, `FAILED`, `REFUNDED`) and `fulfillment_status` (`NOT_STARTED`, `PROCESSING`, `COMPLETED`, `FAILED`). Payment verification locks the row and is idempotent; fulfillment uses a row-lock/claim RPC to prevent duplicate supplier orders. Supplier completion is intended to be the only source of `COMPLETED`.

## RLS and Realtime

RLS is enabled broadly, with public enabled-catalog/promotion reads and server/admin paths for sensitive writes. Later migrations add admin policies, deny direct voucher access, lock down order/timeline/payment writes, and publish `orders` and `order_timeline` for Realtime. The migration sequence contains duplicated/re-suffixed SQL files and changing policy definitions; the live database must be checked before assuming the final policy set.

## Money and consistency

Money is integer cents. The database recomputes package price and voucher discount instead of trusting the browser. Order payment configuration snapshots preserve historical instructions. Supplier mapping capture similarly protects an order from later catalog remapping.
