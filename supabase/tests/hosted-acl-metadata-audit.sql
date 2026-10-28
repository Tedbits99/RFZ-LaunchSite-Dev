-- Trusted, metadata-only report. This file is run only by the manually
-- dispatched main-branch database workflow against the fixed development
-- project. It reads PostgreSQL catalogs; it never selects application rows,
-- executes application functions, changes ACLs, or exports table contents.

SELECT jsonb_build_object(
  'section', 'database',
  'data', jsonb_build_object(
    'database_name', current_database(),
    'audit_role', current_user,
    'server_version', current_setting('server_version'),
    'server_version_num', current_setting('server_version_num')::integer,
    'public_table_count', (
      SELECT count(*)
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND c.relpersistence <> 't'
    ),
    'required_roles_present', (
      SELECT count(*) = 3
      FROM pg_catalog.pg_roles r
      WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
    ),
    'extensions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', e.extname, 'version', e.extversion)
                       ORDER BY e.extname)
      FROM pg_catalog.pg_extension e
    ), '[]'::jsonb),
    'rf_coin_tables', COALESCE((
      SELECT jsonb_agg(c.relname ORDER BY c.relname)
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND c.relname LIKE 'rf_coin\_%' ESCAPE '\'
    ), '[]'::jsonb),
    'rf_coin_functions', COALESCE((
      SELECT jsonb_agg(p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
                       ORDER BY p.proname, p.oid)
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'rf_coin\_%' ESCAPE '\'
    ), '[]'::jsonb)
  )
);

SELECT jsonb_build_object(
  'section', 'tables',
  'data', COALESCE(jsonb_agg(jsonb_build_object(
    'name', c.relname,
    'kind', c.relkind,
    'owner', pg_catalog.pg_get_userbyid(c.relowner),
    'rls_enabled', c.relrowsecurity,
    'rls_forced', c.relforcerowsecurity,
    'relacl_is_null', c.relacl IS NULL
  ) ORDER BY c.relname), '[]'::jsonb)
)
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND c.relpersistence <> 't';

SELECT jsonb_build_object(
  'section', 'effective_table_privileges',
  'data', COALESCE(jsonb_agg(jsonb_build_object(
    'table', c.relname,
    'role', roles.role_name,
    'privileges', jsonb_build_object(
      'SELECT', has_table_privilege(roles.role_name, c.oid, 'SELECT'),
      'INSERT', has_table_privilege(roles.role_name, c.oid, 'INSERT'),
      'UPDATE', has_table_privilege(roles.role_name, c.oid, 'UPDATE'),
      'DELETE', has_table_privilege(roles.role_name, c.oid, 'DELETE'),
      'TRUNCATE', has_table_privilege(roles.role_name, c.oid, 'TRUNCATE'),
      'REFERENCES', has_table_privilege(roles.role_name, c.oid, 'REFERENCES'),
      'TRIGGER', has_table_privilege(roles.role_name, c.oid, 'TRIGGER'),
      'MAINTAIN', has_table_privilege(roles.role_name, c.oid, 'MAINTAIN')
    )
  ) ORDER BY c.relname, roles.role_name), '[]'::jsonb)
)
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS roles(role_name)
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND c.relpersistence <> 't';

SELECT jsonb_build_object(
  'section', 'direct_relation_acl',
  'data', COALESCE(jsonb_agg(jsonb_build_object(
    'table', c.relname,
    'relacl_is_null', c.relacl IS NULL,
    'entries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'grantor', pg_catalog.pg_get_userbyid(a.grantor),
        'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                        ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
        'privilege', a.privilege_type,
        'grantable', a.is_grantable
      ) ORDER BY a.grantee, a.privilege_type, a.grantor)
      FROM pg_catalog.aclexplode(c.relacl) a
    ), '[]'::jsonb)
  ) ORDER BY c.relname), '[]'::jsonb)
)
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND c.relpersistence <> 't';

SELECT jsonb_build_object(
  'section', 'default_acl',
  'data', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'creator', creator.rolname,
      'schema', COALESCE(n.nspname, '<global>'),
      'object_type', CASE d.defaclobjtype
        WHEN 'r' THEN 'table' WHEN 'S' THEN 'sequence' WHEN 'f' THEN 'function'
        WHEN 'T' THEN 'type' WHEN 'n' THEN 'schema' ELSE d.defaclobjtype::text END,
      'grantor', pg_catalog.pg_get_userbyid(a.grantor),
      'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                      ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
      'privilege', a.privilege_type,
      'grantable', a.is_grantable
    ) ORDER BY COALESCE(n.nspname, ''), creator.rolname, d.defaclobjtype,
               a.grantee, a.privilege_type, a.grantor)
    FROM pg_catalog.pg_default_acl d
    JOIN pg_catalog.pg_roles creator ON creator.oid = d.defaclrole
    LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
  ), '[]'::jsonb)
);

WITH RECURSIVE membership_paths AS (
  SELECT r.oid AS root_oid, r.oid AS member_oid, r.oid AS granted_oid,
         0 AS depth, ARRAY[r.oid] AS path, jsonb_build_array(r.rolname) AS path_names,
         true AS all_edges_inherit
  FROM pg_catalog.pg_roles r
  WHERE r.rolname IN ('anon', 'authenticated')
  UNION ALL
  SELECT mp.root_oid, m.member, m.roleid, mp.depth + 1,
         mp.path || m.roleid, mp.path_names || to_jsonb(granted.rolname),
         mp.all_edges_inherit AND m.inherit_option
  FROM membership_paths mp
  JOIN pg_catalog.pg_auth_members m ON m.member = mp.granted_oid
  JOIN pg_catalog.pg_roles granted ON granted.oid = m.roleid
  WHERE mp.depth < 16 AND NOT m.roleid = ANY(mp.path)
)
SELECT jsonb_build_object(
  'section', 'role_memberships',
  'data', COALESCE(jsonb_agg(jsonb_build_object(
    'root_role', root.rolname,
    'member_role', member.rolname,
    'granted_role', granted.rolname,
    'membership_path', mp.path_names,
    'depth', mp.depth,
    'inherit_option', m.inherit_option,
    'set_option', m.set_option,
    'admin_option', m.admin_option,
    'all_edges_inherit', mp.all_edges_inherit,
    'member_rolinherit', member.rolinherit,
    'granted_role_rolinherit', granted.rolinherit
  ) ORDER BY root.rolname, mp.depth, granted.rolname), '[]'::jsonb)
)
FROM membership_paths mp
JOIN pg_catalog.pg_roles root ON root.oid = mp.root_oid
JOIN pg_catalog.pg_auth_members m ON m.member = mp.member_oid AND m.roleid = mp.granted_oid
JOIN pg_catalog.pg_roles member ON member.oid = m.member
JOIN pg_catalog.pg_roles granted ON granted.oid = m.roleid
WHERE mp.depth > 0;

SELECT jsonb_build_object(
  'section', 'payment_transactions',
  'data', jsonb_build_object(
    'exists', c.oid IS NOT NULL,
    'owner', CASE WHEN c.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_userbyid(c.relowner) END,
    'rls_enabled', COALESCE(c.relrowsecurity, false),
    'rls_forced', COALESCE(c.relforcerowsecurity, false),
    'constraints', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', con.conname,
        'type', con.contype,
        'definition', pg_catalog.pg_get_constraintdef(con.oid, true)
      ) ORDER BY con.conname)
      FROM pg_catalog.pg_constraint con WHERE con.conrelid = c.oid
    ), '[]'::jsonb),
    'indexes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', index_class.relname,
        'definition', pg_catalog.pg_get_indexdef(index_class.oid)
      ) ORDER BY index_class.relname)
      FROM pg_catalog.pg_index idx
      JOIN pg_catalog.pg_class index_class ON index_class.oid = idx.indexrelid
      WHERE idx.indrelid = c.oid
    ), '[]'::jsonb),
    'policies', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', p.policyname, 'command', p.cmd, 'roles', p.roles,
        'permissive', p.permissive
      ) ORDER BY p.policyname)
      FROM pg_catalog.pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = 'payment_transactions'
    ), '[]'::jsonb)
  )
)
FROM (SELECT to_regclass('public.payment_transactions') AS oid) target
LEFT JOIN pg_catalog.pg_class c ON c.oid = target.oid;

SELECT jsonb_build_object(
  'section', 'public_functions',
  'data', COALESCE(jsonb_agg(jsonb_build_object(
    'identity', p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
    'owner', pg_catalog.pg_get_userbyid(p.proowner),
    'kind', p.prokind,
    'security_definer', p.prosecdef,
    'configuration_keys', COALESCE((
      SELECT jsonb_agg(split_part(setting, '=', 1) ORDER BY split_part(setting, '=', 1))
      FROM unnest(p.proconfig) AS config(setting)
    ), '[]'::jsonb),
    'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
    'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    'service_role_execute', has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) ORDER BY p.proname, p.oid), '[]'::jsonb)
)
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p');

SELECT to_regclass('cron.job') IS NOT NULL AS audit_cron_relation_present \gset
\if :audit_cron_relation_present
SELECT jsonb_build_object(
  'section', 'scheduled_jobs',
  'data', jsonb_build_object(
    'cron_relation_present', true,
    'job_count', (SELECT count(*) FROM cron.job)
  )
);
\else
SELECT jsonb_build_object(
  'section', 'scheduled_jobs',
  'data', jsonb_build_object('cron_relation_present', false, 'job_count', 0)
);
\endif
