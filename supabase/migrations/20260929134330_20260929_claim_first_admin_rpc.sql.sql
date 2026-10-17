/*
# First-admin claim RPC

1. New Functions
- `claim_first_admin()` — atomically creates the FIRST admin record as
  SUPER_ADMIN for the calling authenticated user. If any admin row already
  exists (or the caller already has one), it does nothing. The claim is
  evaluated entirely from the real authenticated session (auth.uid()),
  never from client-supplied input.

2. Security
- SECURITY DEFINER with a fixed search_path so it can write the admins
  table regardless of RLS.
- EXECUTE granted to authenticated only; revoked from anon and PUBLIC.
  The app calls it best-effort from the server-side session route right
  after successful Bolt Auth sign-in; it can never block or reject a login.
- Second and later users can never claim: the INSERT only runs when the
  admins table is completely empty.

3. Important Notes
- Replaces the removed chain of bootstrap/authorization functions with one
  minimal, non-blocking routine.
- Idempotent and safe to re-run.
*/

CREATE OR REPLACE FUNCTION public.claim_first_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT u.email,
         COALESCE(NULLIF(u.raw_user_meta_data ->> 'name', ''), split_part(u.email, '@', 1))
    INTO v_email, v_name
  FROM auth.users u
  WHERE u.id = v_uid;

  IF v_email IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.admins (id, email, name, role, is_active)
  SELECT v_uid, lower(v_email), COALESCE(v_name, 'Admin'), 'SUPER_ADMIN', true
  WHERE NOT EXISTS (SELECT 1 FROM public.admins);

EXCEPTION WHEN unique_violation THEN
  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_first_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_first_admin() TO authenticated;