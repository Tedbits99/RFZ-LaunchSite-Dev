-- Idempotent voucher usage: one usage record per (voucher, order).
ALTER TABLE public.voucher_usages
  ADD CONSTRAINT voucher_usages_voucher_order_key UNIQUE (voucher_id, order_id);
