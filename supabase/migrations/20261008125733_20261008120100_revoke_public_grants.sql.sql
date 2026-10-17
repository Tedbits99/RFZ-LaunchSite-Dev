/*
# Remove PUBLIC execute grants on privileged order RPCs

1. Plain-English explanation
   Functions in Postgres are executable by the special PUBLIC role by
   default, which kept them callable by anonymous visitors even after
   the previous migration revoked the anon role specifically. This
   removes the default PUBLIC grant so only authenticated admins and
   the background payment system can call them.

2. Modified functions
   - verify_payment, complete_fulfillment, admin_change_order_status,
     is_payment_operator: PUBLIC execute revoked.

3. Security changes
   - Closes the loophole left by Postgres's default PUBLIC grant.

4. Important notes
   - No data or schema-structure changes.
*/

REVOKE EXECUTE ON FUNCTION public.verify_payment(uuid, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_fulfillment(uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_change_order_status(uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_payment_operator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_payment_operator() TO authenticated;
