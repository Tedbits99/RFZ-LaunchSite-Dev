-- ADMIN-OPS-001: isolated persisted admin operations and append-only audit.
-- Browser roles never receive privileges on these operational tables; all
-- writes go through authenticated Next.js handlers using the server client.

CREATE TABLE IF NOT EXISTS public.admin_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
  actor_email text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  target_type text NOT NULL CHECK (length(target_type) BETWEEN 1 AND 80),
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_events_created_idx
  ON public.admin_audit_events (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS admin_audit_events_target_idx
  ON public.admin_audit_events (target_type, target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_role_permissions (
  role text NOT NULL CHECK (role IN ('STAFF', 'ADMIN')),
  permission_key text NOT NULL CHECK (permission_key IN (
    'orders.view', 'orders.edit', 'orders.refund', 'games.manage',
    'pricing.manage', 'customers.view', 'customers.manage',
    'payments.view', 'payments.refund', 'staff.manage', 'tickets.manage',
    'tasks.manage', 'analytics.view', 'marketing.manage', 'suppliers.view',
    'suppliers.manage', 'payments.manage', 'settings.manage', 'system.view'
  )),
  is_enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.admins(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission_key)
);

-- Seed from the pre-existing Roles & Permissions page, retaining only
-- permissions that current server routes can actually enforce. Task access
-- is added for the already-present admin task-management surface.
INSERT INTO public.admin_role_permissions (role, permission_key) VALUES
  ('STAFF', 'orders.view'),
  ('STAFF', 'orders.edit'),
  ('STAFF', 'customers.view'),
  ('STAFF', 'tickets.manage'),
  ('STAFF', 'tasks.manage'),
  ('ADMIN', 'orders.view'),
  ('ADMIN', 'orders.edit'),
  ('ADMIN', 'orders.refund'),
  ('ADMIN', 'games.manage'),
  ('ADMIN', 'pricing.manage'),
  ('ADMIN', 'customers.view'),
  ('ADMIN', 'customers.manage'),
  ('ADMIN', 'payments.view'),
  ('ADMIN', 'payments.refund'),
  ('ADMIN', 'payments.manage'),
  ('ADMIN', 'staff.manage'),
  ('ADMIN', 'tickets.manage'),
  ('ADMIN', 'tasks.manage'),
  ('ADMIN', 'analytics.view'),
  ('ADMIN', 'marketing.manage'),
  ('ADMIN', 'suppliers.view'),
  ('ADMIN', 'suppliers.manage'),
  ('ADMIN', 'settings.manage'),
  ('ADMIN', 'system.view')
ON CONFLICT (role, permission_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.admin_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  assigned_to_id uuid REFERENCES public.admins(id) ON DELETE SET NULL,
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  status text NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO', 'IN_PROGRESS', 'DONE')),
  due_date date,
  created_by uuid NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS admin_tasks_active_created_idx
  ON public.admin_tasks (archived_at, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_tasks_assignee_idx
  ON public.admin_tasks (assigned_to_id, status) WHERE archived_at IS NULL;

ALTER TABLE public.admins
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.admins(id) ON DELETE SET NULL;

-- Ticket schema already defines the allowed statuses and priorities. Add an
-- actor column for auditable admin changes; do not invent customer ownership
-- or public ticket-lookup semantics that the current schema cannot enforce.
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS last_admin_actor_id uuid REFERENCES public.admins(id) ON DELETE SET NULL;

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.admins(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.admins(id) ON DELETE SET NULL;
ALTER TABLE public.global_announcement
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.admins(id) ON DELETE SET NULL;

ALTER TABLE public.admin_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_tasks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_audit_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.admin_audit_events TO service_role;
REVOKE ALL ON TABLE public.admin_role_permissions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admin_role_permissions TO service_role;
REVOKE ALL ON TABLE public.admin_tasks FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admin_tasks TO service_role;

-- Admin membership and role changes are server-managed only. An active admin
-- may still read their own row for session validation, but cannot write any
-- membership or permission record directly through PostgREST.
DROP POLICY IF EXISTS "admin_select_all_admins" ON public.admins;
DROP POLICY IF EXISTS "admin_insert_admins" ON public.admins;
DROP POLICY IF EXISTS "admin_update_admins" ON public.admins;
DROP POLICY IF EXISTS "admin_delete_admins" ON public.admins;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.admins FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admins TO service_role;

-- The old public-read policies were named "own" but only checked that an
-- email had a few characters, exposing every ticket and message. No secure
-- customer lookup token or ownership column exists, so public reads are shut
-- off until such a contract is explicitly designed.
DROP POLICY IF EXISTS "Public can read own support tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Public can read own support messages" ON public.support_messages;
DROP POLICY IF EXISTS "admin_select_support_tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "admin_insert_support_tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "admin_update_support_tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "admin_delete_support_tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "admin_select_support_messages" ON public.support_messages;
DROP POLICY IF EXISTS "admin_insert_support_messages" ON public.support_messages;
DROP POLICY IF EXISTS "admin_update_support_messages" ON public.support_messages;
DROP POLICY IF EXISTS "admin_delete_support_messages" ON public.support_messages;
REVOKE SELECT, UPDATE, DELETE ON TABLE public.support_tickets FROM PUBLIC, anon, authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.support_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.support_tickets TO service_role;
GRANT SELECT ON TABLE public.support_messages TO service_role;

-- Storefront reads remain public under the existing active-row RLS policies;
-- admin writes are restricted to permission-checked server routes.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.promotions, public.announcements, public.global_announcement FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.promotions, public.announcements, public.global_announcement TO service_role;

DROP POLICY IF EXISTS "Public can create support tickets" ON public.support_tickets;
CREATE POLICY "Public can create support tickets" ON public.support_tickets
  FOR INSERT TO anon, authenticated WITH CHECK (length(btrim(email)) BETWEEN 5 AND 254);
DROP POLICY IF EXISTS "Public can create support messages" ON public.support_messages;
CREATE POLICY "Public can create support messages" ON public.support_messages
  FOR INSERT TO anon, authenticated
  WITH CHECK (author = 'CUSTOMER' AND length(btrim(body)) BETWEEN 1 AND 5000);
GRANT INSERT ON TABLE public.support_tickets, public.support_messages TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.rfz_admin_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ADMIN_AUDIT_APPEND_ONLY';
END;
$$;

REVOKE ALL ON FUNCTION public.rfz_admin_audit_immutable() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS admin_audit_events_no_row_mutation ON public.admin_audit_events;
CREATE TRIGGER admin_audit_events_no_row_mutation
  BEFORE UPDATE OR DELETE ON public.admin_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.rfz_admin_audit_immutable();
DROP TRIGGER IF EXISTS admin_audit_events_no_truncate ON public.admin_audit_events;
CREATE TRIGGER admin_audit_events_no_truncate
  BEFORE TRUNCATE ON public.admin_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.rfz_admin_audit_immutable();

CREATE OR REPLACE FUNCTION public.rfz_admin_membership_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid;
  v_actor public.admins%ROWTYPE;
  v_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role NOT IN ('STAFF', 'ADMIN', 'SUPER_ADMIN') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ADMIN_ROLE';
    END IF;
    v_actor_id := COALESCE(NEW.updated_by, NEW.id);
    IF NEW.updated_by IS NULL AND EXISTS (SELECT 1 FROM public.admins WHERE id <> NEW.id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ADMIN_BOOTSTRAP_ONLY_WHEN_EMPTY';
    END IF;
    IF NEW.updated_by IS NOT NULL THEN
      SELECT * INTO v_actor FROM public.admins WHERE id = NEW.updated_by AND is_active;
      IF NOT FOUND OR (v_actor.role <> 'SUPER_ADMIN' AND NOT (v_actor.role = 'ADMIN' AND NEW.role = 'STAFF')) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ADMIN_STAFF_MANAGEMENT_FORBIDDEN';
      END IF;
    END IF;
    v_action := CASE WHEN NEW.updated_by IS NULL THEN 'admin.bootstrap' ELSE 'staff.created' END;
    INSERT INTO public.admin_audit_events (actor_id, actor_email, actor_role, action, target_type, target_id, metadata)
    VALUES (v_actor_id, COALESCE(v_actor.email, NEW.email), COALESCE(v_actor.role, NEW.role), v_action,
      'admin', NEW.id::text, jsonb_build_object('role', NEW.role, 'is_active', NEW.is_active));
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.name IS DISTINCT FROM OLD.name OR NEW.email IS DISTINCT FROM OLD.email THEN
    IF NEW.role NOT IN ('STAFF', 'ADMIN', 'SUPER_ADMIN') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ADMIN_ROLE';
    END IF;
    v_actor_id := NEW.updated_by;
    IF v_actor_id IS NULL OR v_actor_id = NEW.id THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ADMIN_SELF_ROLE_CHANGE_FORBIDDEN';
    END IF;
    SELECT * INTO v_actor FROM public.admins WHERE id = v_actor_id AND is_active;
    IF NOT FOUND OR NOT (
      v_actor.role = 'SUPER_ADMIN'
      OR (v_actor.role = 'ADMIN' AND OLD.role = 'STAFF' AND NEW.role = 'STAFF')
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ADMIN_STAFF_MANAGEMENT_FORBIDDEN';
    END IF;
    IF OLD.role = 'SUPER_ADMIN' AND OLD.is_active
       AND (NEW.role <> 'SUPER_ADMIN' OR NOT NEW.is_active) THEN
      -- Serialize concurrent demotions/deactivations so two transactions
      -- cannot both observe two active super admins and remove both.
      PERFORM pg_catalog.pg_advisory_xact_lock(9412, 3101);
      IF (SELECT count(*) FROM public.admins WHERE role = 'SUPER_ADMIN' AND is_active) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'LAST_ACTIVE_SUPER_ADMIN';
      END IF;
    END IF;
    v_action := CASE
      WHEN NEW.role IS DISTINCT FROM OLD.role THEN 'staff.role_changed'
      WHEN NEW.is_active IS DISTINCT FROM OLD.is_active THEN CASE WHEN NEW.is_active THEN 'staff.activated' ELSE 'staff.deactivated' END
      ELSE 'staff.profile_updated'
    END;
    INSERT INTO public.admin_audit_events (actor_id, actor_email, actor_role, action, target_type, target_id, metadata)
    VALUES (v_actor_id, v_actor.email, v_actor.role, v_action, 'admin', NEW.id::text,
      jsonb_build_object('role', NEW.role, 'is_active', NEW.is_active));
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.rfz_admin_membership_audit() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS admins_audit_membership_changes ON public.admins;
CREATE TRIGGER admins_audit_membership_changes
  AFTER INSERT OR UPDATE ON public.admins
  FOR EACH ROW EXECUTE FUNCTION public.rfz_admin_membership_audit();

CREATE OR REPLACE FUNCTION public.rfz_admin_role_permission_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.admins%ROWTYPE;
BEGIN
  IF NEW.updated_by IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ROLE_PERMISSION_ACTOR_REQUIRED';
  END IF;
  SELECT * INTO v_actor FROM public.admins WHERE id = NEW.updated_by AND is_active AND role = 'SUPER_ADMIN';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ROLE_PERMISSION_SUPER_ADMIN_REQUIRED';
  END IF;
  INSERT INTO public.admin_audit_events (actor_id, actor_email, actor_role, action, target_type, target_id, metadata)
  VALUES (NEW.updated_by, v_actor.email, v_actor.role,
    CASE WHEN NEW.is_enabled THEN 'role_permission.enabled' ELSE 'role_permission.disabled' END,
    'role_permission', NEW.role || ':' || NEW.permission_key,
    jsonb_build_object('role', NEW.role, 'permission', NEW.permission_key, 'enabled', NEW.is_enabled));
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.rfz_admin_role_permission_audit() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS admin_role_permissions_audit_changes ON public.admin_role_permissions;
CREATE TRIGGER admin_role_permissions_audit_changes
  BEFORE INSERT OR UPDATE ON public.admin_role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.rfz_admin_role_permission_audit();

CREATE OR REPLACE FUNCTION public.rfz_admin_task_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid;
  v_actor public.admins%ROWTYPE;
  v_action text;
  v_fields text[] := ARRAY[]::text[];
BEGIN
  v_actor_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by ELSE NEW.updated_by END;
  SELECT * INTO v_actor FROM public.admins WHERE id = v_actor_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ADMIN_TASK_ACTOR_REQUIRED';
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_action := 'task.created';
    v_fields := ARRAY['title', 'description', 'assigned_to_id', 'priority', 'status', 'due_date'];
  ELSE
    IF NEW.title IS DISTINCT FROM OLD.title THEN v_fields := array_append(v_fields, 'title'); END IF;
    IF NEW.description IS DISTINCT FROM OLD.description THEN v_fields := array_append(v_fields, 'description'); END IF;
    IF NEW.assigned_to_id IS DISTINCT FROM OLD.assigned_to_id THEN v_fields := array_append(v_fields, 'assigned_to_id'); END IF;
    IF NEW.priority IS DISTINCT FROM OLD.priority THEN v_fields := array_append(v_fields, 'priority'); END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN v_fields := array_append(v_fields, 'status'); END IF;
    IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN v_fields := array_append(v_fields, 'due_date'); END IF;
    IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN v_fields := array_append(v_fields, 'archived_at'); END IF;
    IF cardinality(v_fields) = 0 THEN RETURN NEW; END IF;
    v_action := CASE
      WHEN NEW.archived_at IS DISTINCT FROM OLD.archived_at AND NEW.archived_at IS NOT NULL THEN 'task.archived'
      WHEN NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN 'task.restored'
      ELSE 'task.updated'
    END;
  END IF;
  INSERT INTO public.admin_audit_events (actor_id, actor_email, actor_role, action, target_type, target_id, metadata)
  VALUES (v_actor_id, v_actor.email, v_actor.role, v_action, 'task', NEW.id::text,
    jsonb_build_object('changed_fields', to_jsonb(v_fields), 'status', NEW.status, 'priority', NEW.priority));
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.rfz_admin_task_audit() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS admin_tasks_audit_changes ON public.admin_tasks;
CREATE TRIGGER admin_tasks_audit_changes
  BEFORE INSERT OR UPDATE ON public.admin_tasks
  FOR EACH ROW EXECUTE FUNCTION public.rfz_admin_task_audit();

CREATE OR REPLACE FUNCTION public.rfz_support_ticket_admin_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.admins%ROWTYPE;
  v_fields text[] := ARRAY[]::text[];
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN v_fields := array_append(v_fields, 'status'); END IF;
  IF NEW.priority IS DISTINCT FROM OLD.priority THEN v_fields := array_append(v_fields, 'priority'); END IF;
  IF cardinality(v_fields) = 0 THEN RETURN NEW; END IF;
  SELECT * INTO v_actor FROM public.admins WHERE id = NEW.last_admin_actor_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SUPPORT_TICKET_ADMIN_ACTOR_REQUIRED';
  END IF;
  NEW.updated_at := now();
  INSERT INTO public.admin_audit_events (actor_id, actor_email, actor_role, action, target_type, target_id, metadata)
  VALUES (NEW.last_admin_actor_id, v_actor.email, v_actor.role, 'ticket.updated', 'support_ticket', NEW.id::text,
    jsonb_build_object('changed_fields', to_jsonb(v_fields), 'status', NEW.status, 'priority', NEW.priority));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.rfz_support_ticket_admin_audit() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS support_tickets_admin_audit ON public.support_tickets;
CREATE TRIGGER support_tickets_admin_audit
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.rfz_support_ticket_admin_audit();

CREATE OR REPLACE FUNCTION public.rfz_admin_promotion_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid;
  v_actor public.admins%ROWTYPE;
  v_fields text[] := ARRAY[]::text[];
BEGIN
  v_actor_id := COALESCE(NEW.updated_by, NEW.created_by);
  SELECT * INTO v_actor FROM public.admins WHERE id = v_actor_id AND is_active;
  IF NOT FOUND OR NOT (
    v_actor.role = 'SUPER_ADMIN'
    OR EXISTS (SELECT 1 FROM public.admin_role_permissions WHERE role = v_actor.role AND permission_key = 'marketing.manage' AND is_enabled)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MARKETING_ADMIN_REQUIRED';
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_fields := ARRAY['title', 'target_type', 'placement', 'is_active'];
  ELSE
    IF NEW.title IS DISTINCT FROM OLD.title THEN v_fields := array_append(v_fields, 'title'); END IF;
    IF NEW.body IS DISTINCT FROM OLD.body THEN v_fields := array_append(v_fields, 'body'); END IF;
    IF NEW.target_type IS DISTINCT FROM OLD.target_type THEN v_fields := array_append(v_fields, 'target_type'); END IF;
    IF NEW.placement IS DISTINCT FROM OLD.placement THEN v_fields := array_append(v_fields, 'placement'); END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN v_fields := array_append(v_fields, 'is_active'); END IF;
    IF NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at THEN v_fields := array_append(v_fields, 'schedule'); END IF;
    IF cardinality(v_fields) = 0 THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO public.admin_audit_events (actor_id, actor_email, actor_role, action, target_type, target_id, metadata)
  VALUES (v_actor.id, v_actor.email, v_actor.role,
    CASE WHEN TG_OP = 'INSERT' THEN 'promotion.created' ELSE 'promotion.updated' END,
    'promotion', NEW.id::text,
    jsonb_build_object('changed_fields', to_jsonb(v_fields), 'target_type', NEW.target_type,
                       'placement', NEW.placement, 'enabled', NEW.is_active));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.rfz_admin_promotion_audit() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS promotions_admin_audit ON public.promotions;
CREATE TRIGGER promotions_admin_audit BEFORE INSERT OR UPDATE ON public.promotions
  FOR EACH ROW EXECUTE FUNCTION public.rfz_admin_promotion_audit();

CREATE OR REPLACE FUNCTION public.rfz_admin_announcement_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.admins%ROWTYPE;
  v_fields text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v_actor FROM public.admins WHERE id = NEW.updated_by AND is_active;
  IF NOT FOUND OR NOT (
    v_actor.role = 'SUPER_ADMIN'
    OR EXISTS (SELECT 1 FROM public.admin_role_permissions WHERE role = v_actor.role AND permission_key = 'marketing.manage' AND is_enabled)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MARKETING_ADMIN_REQUIRED';
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_fields := ARRAY['title', 'type', 'display_mode', 'enabled', 'schedule'];
  ELSE
    IF NEW.title IS DISTINCT FROM OLD.title THEN v_fields := array_append(v_fields, 'title'); END IF;
    IF NEW.message IS DISTINCT FROM OLD.message THEN v_fields := array_append(v_fields, 'message'); END IF;
    IF NEW.type IS DISTINCT FROM OLD.type THEN v_fields := array_append(v_fields, 'type'); END IF;
    IF NEW.display_mode IS DISTINCT FROM OLD.display_mode THEN v_fields := array_append(v_fields, 'display_mode'); END IF;
    IF NEW.enabled IS DISTINCT FROM OLD.enabled THEN v_fields := array_append(v_fields, 'enabled'); END IF;
    IF NEW.return_date_time IS DISTINCT FROM OLD.return_date_time THEN v_fields := array_append(v_fields, 'schedule'); END IF;
    IF cardinality(v_fields) = 0 THEN RETURN NEW; END IF;
  END IF;
  NEW.updated_at := now();
  INSERT INTO public.admin_audit_events (actor_id, actor_email, actor_role, action, target_type, target_id, metadata)
  VALUES (v_actor.id, v_actor.email, v_actor.role,
    CASE WHEN TG_OP = 'INSERT' THEN 'announcement.created' ELSE 'announcement.updated' END,
    'announcement', NEW.id::text,
    jsonb_build_object('changed_fields', to_jsonb(v_fields), 'type', NEW.type,
                       'display_mode', NEW.display_mode, 'enabled', NEW.enabled));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.rfz_admin_announcement_audit() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS announcements_admin_audit ON public.global_announcement;
CREATE TRIGGER announcements_admin_audit BEFORE INSERT OR UPDATE ON public.global_announcement
  FOR EACH ROW EXECUTE FUNCTION public.rfz_admin_announcement_audit();

CREATE OR REPLACE FUNCTION public.admin_bulk_reprice_packages(
  p_actor_id uuid,
  p_package_ids uuid[],
  p_action text,
  p_value numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.admins%ROWTYPE;
  v_package record;
  v_price integer;
  v_updated integer := 0;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_fx_rate numeric;
  v_markup numeric;
BEGIN
  SELECT * INTO v_actor FROM public.admins WHERE id = p_actor_id AND is_active;
  IF NOT FOUND OR NOT (
    v_actor.role = 'SUPER_ADMIN'
    OR EXISTS (
      SELECT 1 FROM public.admin_role_permissions
      WHERE role = v_actor.role AND permission_key = 'pricing.manage' AND is_enabled
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CATALOG_ADMIN_REQUIRED';
  END IF;
  IF COALESCE(p_action, '') NOT IN ('set_price', 'percentage_adjust') OR p_value IS NULL
     OR p_value::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_BULK_PRICE_ACTION';
  END IF;
  IF p_package_ids IS NULL OR cardinality(p_package_ids) = 0 OR cardinality(p_package_ids) > 200
     OR array_position(p_package_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_BULK_PACKAGE_IDS';
  END IF;
  IF (SELECT count(*) FROM unnest(p_package_ids) AS id) <>
     (SELECT count(DISTINCT id) FROM unnest(p_package_ids) AS id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DUPLICATE_BULK_PACKAGE_IDS';
  END IF;
  IF p_action = 'set_price' AND (p_value <> trunc(p_value) OR p_value < 1 OR p_value > 2147483647) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_BULK_PRICE_VALUE';
  END IF;
  IF p_action = 'percentage_adjust' AND (p_value < -99.99 OR p_value > 10000) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_BULK_PERCENTAGE';
  END IF;
  IF (SELECT count(*) FROM public.packages WHERE id = ANY(p_package_ids)) <> cardinality(p_package_ids) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'BULK_PACKAGE_NOT_FOUND';
  END IF;

  SELECT reference_usd_php_rate INTO v_fx_rate FROM public.app_settings WHERE id = 1;
  v_fx_rate := COALESCE(v_fx_rate, 56);

  FOR v_package IN
    SELECT id, price_cents, original_price_cents, supplier_cost_usd,
           supplier_offer_id, supplier_category_id, supplier_review_required
    FROM public.packages WHERE id = ANY(p_package_ids) ORDER BY id FOR UPDATE
  LOOP
    IF p_action = 'set_price' THEN
      v_price := p_value::integer;
    ELSE
      v_price := round(v_package.price_cents::numeric * (1 + p_value / 100))::integer;
    END IF;
    IF v_price < 1 OR v_price > 2147483647 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'BULK_PRICE_OUT_OF_RANGE';
    END IF;
    IF v_package.original_price_cents IS NOT NULL AND v_package.original_price_cents < v_price THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'BULK_PRICE_EXCEEDS_ORIGINAL_PRICE';
    END IF;
    IF v_price = v_package.price_cents THEN
      CONTINUE;
    END IF;

    v_markup := NULL;
    IF v_package.supplier_cost_usd IS NOT NULL AND v_package.supplier_cost_usd > 0 AND v_fx_rate > 0 THEN
      v_markup := round((((v_price / 100.0) / (v_package.supplier_cost_usd * v_fx_rate)) - 1) * 100, 2);
    END IF;

    UPDATE public.packages
    SET price_cents = v_price,
        markup_percent = COALESCE(v_markup, markup_percent),
        catalog_status = 'DRAFT',
        is_active = false,
        published_at = NULL,
        supplier_review_required = supplier_review_required
          OR supplier_offer_id IS NOT NULL OR supplier_category_id IS NOT NULL
    WHERE id = v_package.id;

    INSERT INTO public.admin_audit_events
      (actor_id, actor_email, actor_role, action, target_type, target_id, metadata)
    VALUES
      (v_actor.id, v_actor.email, v_actor.role, 'catalog.package_price_bulk_updated', 'package', v_package.id::text,
       jsonb_build_object('old_price_cents', v_package.price_cents, 'new_price_cents', v_price,
                          'catalog_status_after', 'DRAFT'));
    v_updated := v_updated + 1;
    v_ids := array_append(v_ids, v_package.id);
  END LOOP;

  RETURN jsonb_build_object('updated_count', v_updated, 'updated_ids', to_jsonb(v_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_bulk_reprice_packages(uuid, uuid[], text, numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_bulk_reprice_packages(uuid, uuid[], text, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_update_package_price(
  p_actor_id uuid,
  p_package_id uuid,
  p_price_cents integer,
  p_original_price_cents integer DEFAULT NULL,
  p_update_original_price boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.admins%ROWTYPE;
  v_package public.packages%ROWTYPE;
  v_next_original integer;
  v_old_price integer;
  v_markup numeric;
  v_fx_rate numeric;
BEGIN
  SELECT * INTO v_actor FROM public.admins WHERE id = p_actor_id AND is_active;
  IF NOT FOUND OR NOT (
    v_actor.role = 'SUPER_ADMIN'
    OR EXISTS (
      SELECT 1 FROM public.admin_role_permissions
      WHERE role = v_actor.role AND permission_key = 'pricing.manage' AND is_enabled
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CATALOG_ADMIN_REQUIRED';
  END IF;
  IF p_price_cents IS NULL OR p_price_cents < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PACKAGE_PRICE';
  END IF;
  IF p_update_original_price AND p_original_price_cents IS NOT NULL AND p_original_price_cents < p_price_cents THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ORIGINAL_PRICE_BELOW_RETAIL_PRICE';
  END IF;

  SELECT * INTO v_package FROM public.packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'PACKAGE_NOT_FOUND'; END IF;
  v_old_price := v_package.price_cents;
  v_next_original := CASE WHEN p_update_original_price THEN p_original_price_cents ELSE v_package.original_price_cents END;
  IF v_next_original IS NOT NULL AND v_next_original < p_price_cents THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ORIGINAL_PRICE_BELOW_RETAIL_PRICE';
  END IF;
  IF p_price_cents = v_package.price_cents AND v_next_original IS NOT DISTINCT FROM v_package.original_price_cents THEN
    RETURN to_jsonb(v_package);
  END IF;

  SELECT reference_usd_php_rate INTO v_fx_rate FROM public.app_settings WHERE id = 1;
  IF v_package.supplier_cost_usd IS NOT NULL AND v_package.supplier_cost_usd > 0 AND COALESCE(v_fx_rate, 56) > 0 THEN
    v_markup := round((((p_price_cents / 100.0) / (v_package.supplier_cost_usd * COALESCE(v_fx_rate, 56))) - 1) * 100, 2);
  END IF;

  UPDATE public.packages
  SET price_cents = p_price_cents,
      original_price_cents = v_next_original,
      markup_percent = COALESCE(v_markup, markup_percent),
      catalog_status = CASE WHEN p_price_cents <> v_package.price_cents THEN 'DRAFT' ELSE catalog_status END,
      is_active = CASE WHEN p_price_cents <> v_package.price_cents THEN false ELSE is_active END,
      published_at = CASE WHEN p_price_cents <> v_package.price_cents THEN NULL ELSE published_at END,
      supplier_review_required = supplier_review_required OR (
        p_price_cents <> v_package.price_cents AND (supplier_offer_id IS NOT NULL OR supplier_category_id IS NOT NULL)
      )
  WHERE id = p_package_id
  RETURNING * INTO v_package;

  INSERT INTO public.admin_audit_events
    (actor_id, actor_email, actor_role, action, target_type, target_id, metadata)
  VALUES
    (v_actor.id, v_actor.email, v_actor.role, 'catalog.package_price_updated', 'package', v_package.id::text,
     jsonb_build_object('old_price_cents', v_old_price,
                        'new_price_cents', v_package.price_cents,
                        'original_price_cents', v_package.original_price_cents,
                        'catalog_status_after', v_package.catalog_status));
  RETURN to_jsonb(v_package);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_package_price(uuid, uuid, integer, integer, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_package_price(uuid, uuid, integer, integer, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_update_catalog_pricing_assumptions_audited(
  p_actor_id uuid,
  p_fx_rate numeric DEFAULT NULL,
  p_fee_reserve_bps integer DEFAULT NULL,
  p_fixed_fee_cents integer DEFAULT NULL
)
RETURNS TABLE (
  out_fx_rate numeric,
  out_fee_reserve_bps integer,
  out_fixed_fee_cents integer,
  out_supplier_packages_for_review integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.admins%ROWTYPE;
  v_current public.app_settings%ROWTYPE;
  v_changed_fields text[] := ARRAY[]::text[];
  v_review_count integer := 0;
BEGIN
  SELECT * INTO v_actor FROM public.admins WHERE id = p_actor_id AND is_active;
  IF NOT FOUND OR NOT (
    v_actor.role = 'SUPER_ADMIN'
    OR EXISTS (
      SELECT 1 FROM public.admin_role_permissions
      WHERE role = v_actor.role AND permission_key = 'pricing.manage' AND is_enabled
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CATALOG_ADMIN_REQUIRED';
  END IF;
  IF p_fx_rate IS NOT NULL AND (p_fx_rate <= 0 OR p_fx_rate > 1000 OR p_fx_rate::text IN ('NaN', 'Infinity', '-Infinity')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FX_RATE';
  END IF;
  IF p_fee_reserve_bps IS NOT NULL AND p_fee_reserve_bps NOT BETWEEN 0 AND 9999 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FEE_RESERVE';
  END IF;
  IF p_fixed_fee_cents IS NOT NULL AND p_fixed_fee_cents < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FIXED_FEE';
  END IF;
  IF p_fx_rate IS NULL AND p_fee_reserve_bps IS NULL AND p_fixed_fee_cents IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'NO_PRICING_SETTINGS_PROVIDED';
  END IF;

  SELECT * INTO v_current FROM public.app_settings WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'PRICING_SETTINGS_NOT_INITIALIZED'; END IF;
  IF p_fx_rate IS NOT NULL AND p_fx_rate IS DISTINCT FROM v_current.reference_usd_php_rate THEN v_changed_fields := array_append(v_changed_fields, 'reference_usd_php_rate'); END IF;
  IF p_fee_reserve_bps IS NOT NULL AND p_fee_reserve_bps IS DISTINCT FROM v_current.payment_fee_reserve_bps THEN v_changed_fields := array_append(v_changed_fields, 'payment_fee_reserve_bps'); END IF;
  IF p_fixed_fee_cents IS NOT NULL AND p_fixed_fee_cents IS DISTINCT FROM v_current.payment_fee_fixed_cents THEN v_changed_fields := array_append(v_changed_fields, 'payment_fee_fixed_cents'); END IF;

  UPDATE public.app_settings SET
    reference_usd_php_rate = COALESCE(p_fx_rate, reference_usd_php_rate),
    payment_fee_reserve_bps = COALESCE(p_fee_reserve_bps, payment_fee_reserve_bps),
    payment_fee_fixed_cents = COALESCE(p_fixed_fee_cents, payment_fee_fixed_cents),
    updated_at = now()
  WHERE id = 1;

  IF cardinality(v_changed_fields) > 0 THEN
    UPDATE public.packages SET
      is_active = false,
      catalog_status = 'DRAFT',
      published_at = NULL,
      supplier_review_required = true
    WHERE supplier_offer_id IS NOT NULL OR supplier_category_id IS NOT NULL;
    GET DIAGNOSTICS v_review_count = ROW_COUNT;
    INSERT INTO public.admin_audit_events
      (actor_id, actor_email, actor_role, action, target_type, target_id, metadata)
    VALUES
      (v_actor.id, v_actor.email, v_actor.role, 'catalog.pricing_assumptions_updated', 'app_settings', '1',
       jsonb_build_object(
         'changed_fields', to_jsonb(v_changed_fields),
         'old_fx_rate', v_current.reference_usd_php_rate,
         'new_fx_rate', COALESCE(p_fx_rate, v_current.reference_usd_php_rate),
         'old_fee_reserve_bps', v_current.payment_fee_reserve_bps,
         'new_fee_reserve_bps', COALESCE(p_fee_reserve_bps, v_current.payment_fee_reserve_bps),
         'old_fixed_fee_cents', v_current.payment_fee_fixed_cents,
         'new_fixed_fee_cents', COALESCE(p_fixed_fee_cents, v_current.payment_fee_fixed_cents),
         'supplier_packages_moved_to_review', v_review_count));
  END IF;

  RETURN QUERY SELECT a.reference_usd_php_rate, a.payment_fee_reserve_bps,
    a.payment_fee_fixed_cents, v_review_count
  FROM public.app_settings a WHERE a.id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_catalog_pricing_assumptions_audited(uuid, numeric, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_catalog_pricing_assumptions_audited(uuid, numeric, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.admin_update_catalog_pricing_assumptions(numeric, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_catalog_pricing_assumptions(numeric, integer, integer) TO service_role;

-- Payment config writes are routed through a permission-checked service-role
-- boundary so direct authenticated PostgREST RPC/table writes cannot bypass
-- the persisted role matrix. The wrapper and its audit insert are atomic.
ALTER TABLE public.payment_config
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.admins(id) ON DELETE SET NULL;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.payment_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_config TO service_role;
REVOKE EXECUTE ON FUNCTION public.admin_get_all_payment_config() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_all_payment_config() TO service_role;
REVOKE EXECUTE ON FUNCTION public.admin_upsert_payment_config(
  uuid, text, text, text, text, text, boolean, text, text, text, text,
  text, boolean, text, text[], integer, integer, integer, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_payment_config(
  uuid, text, text, text, text, text, boolean, text, text, text, text,
  text, boolean, text, text[], integer, integer, integer, text, text, text
) TO service_role;
REVOKE EXECUTE ON FUNCTION public.admin_delete_payment_config(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_payment_config(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_ops_upsert_payment_config(
  p_actor_id uuid,
  p_id uuid DEFAULT NULL,
  p_method_key text DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_provider text DEFAULT 'manual',
  p_provider_type text DEFAULT 'manual',
  p_provider_name text DEFAULT 'manual',
  p_is_enabled boolean DEFAULT true,
  p_account_name text DEFAULT '',
  p_account_number text DEFAULT '',
  p_qr_data text DEFAULT NULL,
  p_instructions text DEFAULT '',
  p_api_url text DEFAULT '',
  p_is_test_mode boolean DEFAULT false,
  p_currency text DEFAULT 'PHP',
  p_supported_methods text[] DEFAULT '{}',
  p_sort_order integer DEFAULT 0,
  p_min_amount_cents integer DEFAULT NULL,
  p_max_amount_cents integer DEFAULT NULL,
  p_notes text DEFAULT '',
  p_webhook_url text DEFAULT NULL,
  p_logo_url text DEFAULT NULL
)
RETURNS TABLE(out_id uuid, out_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.admins%ROWTYPE;
  v_result record;
  v_method_key text;
BEGIN
  SELECT * INTO v_actor FROM public.admins WHERE id = p_actor_id AND is_active;
  IF NOT FOUND OR NOT (
    v_actor.role = 'SUPER_ADMIN'
    OR EXISTS (
      SELECT 1 FROM public.admin_role_permissions
      WHERE role = v_actor.role AND permission_key = 'payments.manage' AND is_enabled
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYMENT_CONFIG_ADMIN_REQUIRED';
  END IF;

  SELECT COALESCE(p_method_key, method_key) INTO v_method_key
  FROM public.payment_config WHERE id = p_id;
  SELECT * INTO v_result FROM public.admin_upsert_payment_config(
    p_id, p_method_key, p_display_name, p_provider, p_provider_type, p_provider_name,
    p_is_enabled, p_account_name, p_account_number, p_qr_data, p_instructions,
    p_api_url, p_is_test_mode, p_currency, p_supported_methods, p_sort_order,
    p_min_amount_cents, p_max_amount_cents, p_notes, p_webhook_url, p_logo_url
  );
  IF v_result.out_id IS NOT NULL THEN
    UPDATE public.payment_config SET updated_by = p_actor_id WHERE id = v_result.out_id;
    INSERT INTO public.admin_audit_events
      (actor_id, actor_email, actor_role, action, target_type, target_id, metadata)
    VALUES
      (v_actor.id, v_actor.email, v_actor.role,
       CASE WHEN p_id IS NULL THEN 'payment_method.created' ELSE 'payment_method.updated' END,
       'payment_config', v_result.out_id::text,
       jsonb_build_object('method_key', COALESCE(v_method_key, p_method_key), 'enabled', p_is_enabled,
                          'test_mode', p_is_test_mode, 'provider', p_provider));
  END IF;
  RETURN QUERY SELECT v_result.out_id, v_result.out_error;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_ops_delete_payment_config(p_actor_id uuid, p_id uuid)
RETURNS TABLE(out_success boolean, out_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.admins%ROWTYPE;
  v_method_key text;
  v_result record;
BEGIN
  SELECT * INTO v_actor FROM public.admins WHERE id = p_actor_id AND is_active;
  IF NOT FOUND OR NOT (
    v_actor.role = 'SUPER_ADMIN'
    OR EXISTS (
      SELECT 1 FROM public.admin_role_permissions
      WHERE role = v_actor.role AND permission_key = 'payments.manage' AND is_enabled
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYMENT_CONFIG_ADMIN_REQUIRED';
  END IF;
  SELECT method_key INTO v_method_key FROM public.payment_config WHERE id = p_id;
  SELECT * INTO v_result FROM public.admin_delete_payment_config(p_id);
  IF v_result.out_success IS TRUE THEN
    INSERT INTO public.admin_audit_events
      (actor_id, actor_email, actor_role, action, target_type, target_id, metadata)
    VALUES
      (v_actor.id, v_actor.email, v_actor.role, 'payment_method.deleted', 'payment_config', p_id::text,
       jsonb_build_object('method_key', v_method_key));
  END IF;
  RETURN QUERY SELECT v_result.out_success, v_result.out_error;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ops_upsert_payment_config(uuid, uuid, text, text, text, text, text, boolean, text, text, text, text, text, boolean, text, text[], integer, integer, integer, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ops_upsert_payment_config(uuid, uuid, text, text, text, text, text, boolean, text, text, text, text, text, boolean, text, text[], integer, integer, integer, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_ops_delete_payment_config(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ops_delete_payment_config(uuid, uuid) TO service_role;

-- The legacy bootstrap RPC was not part of the current login flow. Retire its
-- public authenticated grant so a newly registered user cannot claim the
-- first SUPER_ADMIN role without an owner-controlled bootstrap operation.
REVOKE ALL ON FUNCTION public.claim_first_admin() FROM PUBLIC, anon, authenticated, service_role;
