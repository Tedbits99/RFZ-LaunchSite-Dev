-- Drop duplicate unique constraint; voucher_usages_voucher_id_order_id_key already enforces (voucher_id, order_id).
ALTER TABLE public.voucher_usages DROP CONSTRAINT IF EXISTS voucher_usages_voucher_order_key;
