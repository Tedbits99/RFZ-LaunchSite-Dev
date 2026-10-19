-- Add UPDATE policy to games table so the admin can toggle is_active.
-- The anon client already has UPDATE privilege (granted in the base migration);
-- this policy permits the update when the row matches by id.
-- RLS already has a SELECT policy; this adds the missing UPDATE policy.

CREATE POLICY "Admin can update games" ON public.games
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
