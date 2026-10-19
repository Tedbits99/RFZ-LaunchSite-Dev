/*
# Admin identity table + orders voucher_code column

1. New Tables
- `admins` — the record of who is an admin and their role.
  - `id` (uuid, PK) — the Bolt Auth user id
  - `email` (text, unique, not null)
  - `name` (text, not null)
  - `role` (text, not null, default 'SUPER_ADMIN')
  - `claimed_at` (timestamptz, default now)
  - `is_active` (boolean, not null, default true)
  - No foreign key to auth.users: the admin identity survives auth-account
    changes (delete/recreate of the login). The app matches by user id.

2. Modified Tables
- `orders`: adds `voucher_code` (text, nullable) — records which voucher was
  applied at checkout; nullable because most orders have none.

3. Security
- RLS enabled on `admins`; a signed-in user can read ONLY their own row
  (auth.uid() = id). Role assignment happens only in the server-side session
  route (first-user SUPER_ADMIN claim) which runs with the service role,
  so no API-role write grants are needed.

4. Important Notes
- The first authenticated user to hit the session endpoint is claimed as
  SUPER_ADMIN server-side; subsequent users get no claim.
- Replaces the superseded chain of bootstrap/authorization migrations, the
  custom admin_sessions system, and the activity_log table.
- Idempotent: safe to re-run.
*/

CREATE TABLE IF NOT EXISTS public.admins (
  id uuid PRIMARY KEY,
  email text UNIQUE NOT NULL,
  name text NOT NULL DEFAULT 'Admin',
  role text NOT NULL DEFAULT 'SUPER_ADMIN',
  claimed_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read own record" ON public.admins;

CREATE POLICY "Admins can read own record" ON public.admins FOR SELECT
TO authenticated
USING (auth.uid() = id);

DO $$
BEGIN
IF NOT EXISTS (
SELECT 1 FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'orders'
AND column_name = 'voucher_code'
) THEN
ALTER TABLE public.orders ADD COLUMN voucher_code text;
END IF;
END $$;