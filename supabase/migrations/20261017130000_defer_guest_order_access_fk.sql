-- ALREADY APPLIED to live database as: 20261018152301_20261017130000_defer_guest_order_access_fk.sql
-- Do not re-execute this original file. Kept for history only.

-- The order-ownership trigger must create the private capability row before
-- the parent order row is written. Defer only this existing foreign key so
-- PostgreSQL validates the pair at transaction commit, while retaining the
-- required parent relationship and ON DELETE CASCADE behavior.
--
-- The capability is still created in the same transaction as the order, the
-- internal hash is still removed before the order is stored, and a failed
-- order insert rolls back the capability row with it.

ALTER TABLE public.guest_order_access
  DROP CONSTRAINT guest_order_access_order_id_fkey;

ALTER TABLE public.guest_order_access
  ADD CONSTRAINT guest_order_access_order_id_fkey
  FOREIGN KEY (order_id)
  REFERENCES public.orders(id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;
