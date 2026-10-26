-- Restore the minimum API-role privilege required by the server-side admin
-- identity lookup. RLS remains the authorization boundary: authenticated
-- users can only see rows permitted by the existing admin policies, while the
-- anonymous API role receives no access at all.

REVOKE ALL PRIVILEGES ON TABLE public.admins FROM anon;
GRANT SELECT ON TABLE public.admins TO authenticated, service_role;
