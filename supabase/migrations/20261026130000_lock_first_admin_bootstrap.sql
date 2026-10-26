-- The first-admin bootstrap was useful only during the original private
-- setup. It must never be callable by a normal authenticated customer: a
-- customer who can create an Auth identity must not be able to become an
-- administrator merely because the table is empty.
--
-- Keep the function for historical migration compatibility, but remove all
-- client-role execution. A separately reviewed, server-side provisioning
-- operation is required for any future administrator.
REVOKE EXECUTE ON FUNCTION public.claim_first_admin() FROM PUBLIC, anon, authenticated;
