import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261031052548_admin_ops_001_backoffice.sql'), 'utf8')
const SUPER = '11111111-1111-4111-8111-111111111111'
const STAFF = '22222222-2222-4222-8222-222222222222'
const OTHER_SUPER = '55555555-5555-4555-8555-555555555555'
const PACKAGE = '33333333-3333-4333-8333-333333333333'
const TICKET = '44444444-4444-4444-8444-444444444444'
let db: PGlite

async function asDbOwner() {
  await db.exec('RESET ROLE')
}

async function asServiceRole() {
  await db.exec('RESET ROLE')
  await db.exec("SELECT set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false)")
  await db.exec('SET ROLE service_role')
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid;
    $$;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

    CREATE TABLE public.admins (
      id uuid PRIMARY KEY, email text NOT NULL, name text NOT NULL DEFAULT '',
      role text NOT NULL, is_active boolean NOT NULL DEFAULT true, claimed_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.support_tickets (
      id uuid PRIMARY KEY, reference text NOT NULL, email text NOT NULL, subject text NOT NULL,
      status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','WAITING_CUSTOMER','RESOLVED','CLOSED')),
      priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.support_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id uuid NOT NULL REFERENCES public.support_tickets(id),
      author text NOT NULL DEFAULT 'CUSTOMER', body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.packages (
      id uuid PRIMARY KEY, price_cents integer NOT NULL, original_price_cents integer,
      supplier_cost_usd numeric, supplier_offer_id text, supplier_category_id text,
      supplier_review_required boolean NOT NULL DEFAULT false, markup_percent numeric,
      catalog_status text NOT NULL DEFAULT 'PUBLISHED', is_active boolean NOT NULL DEFAULT true,
      published_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.app_settings (
      id integer PRIMARY KEY CHECK (id = 1), reference_usd_php_rate numeric NOT NULL DEFAULT 56,
      payment_fee_reserve_bps integer, payment_fee_fixed_cents integer, updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.payment_config (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), method_key text NOT NULL, display_name text NOT NULL,
      provider text NOT NULL DEFAULT 'manual', is_enabled boolean NOT NULL DEFAULT false,
      is_test_mode boolean NOT NULL DEFAULT true
    );
    CREATE TABLE public.promotions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, body text NOT NULL DEFAULT '',
      target_type text NOT NULL DEFAULT 'GLOBAL', game_id uuid, package_id uuid, image_url text,
      cta_text text, cta_href text, starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz,
      is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0,
      placement text NOT NULL DEFAULT 'HOMEPAGE_HERO', target_game_id uuid, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.announcements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, body text NOT NULL DEFAULT '',
      variant text NOT NULL DEFAULT 'INFO', starts_at timestamptz DEFAULT now(), ends_at timestamptz,
      is_active boolean NOT NULL DEFAULT true, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.global_announcement (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enabled boolean NOT NULL DEFAULT false,
      display_mode text NOT NULL DEFAULT 'normal', type text NOT NULL DEFAULT 'Maintenance',
      title text NOT NULL DEFAULT '', message text NOT NULL DEFAULT '', button_text text NOT NULL DEFAULT 'OK',
      button_link text, return_date_time timestamptz, show_countdown boolean NOT NULL DEFAULT false,
      image_url text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO public.app_settings (id, reference_usd_php_rate, payment_fee_reserve_bps, payment_fee_fixed_cents)
      VALUES (1, 56, 250, 100);
    INSERT INTO public.admins (id, email, name, role) VALUES
      ('${SUPER}', 'root@example.invalid', 'Root', 'SUPER_ADMIN'),
      ('${STAFF}', 'staff@example.invalid', 'Staff', 'STAFF');
    INSERT INTO public.support_tickets (id, reference, email, subject) VALUES
      ('${TICKET}', 'RFZ-T-TEST', 'customer@example.invalid', 'Synthetic issue');
    INSERT INTO public.packages (id, price_cents, original_price_cents, supplier_cost_usd, supplier_offer_id, supplier_category_id)
      VALUES ('${PACKAGE}', 10000, 12000, 1.00, 'synthetic-offer', 'synthetic-category');
    GRANT SELECT, INSERT, UPDATE ON public.admins TO service_role;
    GRANT SELECT, UPDATE ON public.support_tickets, public.packages, public.app_settings TO service_role;
    GRANT SELECT ON public.support_messages TO service_role;
    GRANT INSERT ON public.support_messages TO anon, authenticated;

    ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Admins can read own record" ON public.admins FOR SELECT TO authenticated USING (id = auth.uid());
    CREATE POLICY "Public can read own support tickets" ON public.support_tickets FOR SELECT TO anon, authenticated USING (length(email) > 3);
    CREATE POLICY "Public can read own support messages" ON public.support_messages FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY "admin_select_support_tickets" ON public.support_tickets FOR SELECT TO authenticated USING (true);
    CREATE POLICY "admin_update_support_tickets" ON public.support_tickets FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
    ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.global_announcement ENABLE ROW LEVEL SECURITY;
    CREATE POLICY promo_public_select ON public.promotions FOR SELECT TO anon, authenticated USING (is_active);
    CREATE POLICY announcement_public_select ON public.global_announcement FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY announcement_public_write ON public.global_announcement FOR INSERT TO anon, authenticated WITH CHECK (true);
    GRANT SELECT ON public.promotions, public.announcements, public.global_announcement TO anon, authenticated;
    INSERT INTO public.promotions (title, is_active) VALUES ('Visible promotion', true), ('Hidden promotion', false);
    INSERT INTO public.global_announcement (title, message) VALUES ('Store notice', 'fixture');
    CREATE FUNCTION public.claim_first_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION public.admin_update_catalog_pricing_assumptions(numeric, integer, integer)
      RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE FUNCTION public.admin_get_all_payment_config() RETURNS SETOF public.payment_config
      LANGUAGE sql AS $$ SELECT * FROM public.payment_config $$;
    CREATE FUNCTION public.admin_upsert_payment_config(
      uuid, text, text, text, text, text, boolean, text, text, text, text,
      text, boolean, text, text[], integer, integer, integer, text, text, text
    ) RETURNS TABLE(out_id uuid, out_error text)
      LANGUAGE plpgsql AS $$
      DECLARE v_id uuid;
      BEGIN
        IF $1 IS NULL THEN
          INSERT INTO public.payment_config (method_key, display_name, provider, is_enabled, is_test_mode)
          VALUES ($2, $3, $4, $7, $13) RETURNING id INTO v_id;
        ELSE
          UPDATE public.payment_config SET method_key = $2, display_name = $3, provider = $4, is_enabled = $7, is_test_mode = $13
          WHERE id = $1 RETURNING id INTO v_id;
        END IF;
        RETURN QUERY SELECT v_id, NULL::text;
      END $$;
    CREATE FUNCTION public.admin_delete_payment_config(uuid) RETURNS TABLE(out_success boolean, out_error text)
      LANGUAGE plpgsql AS $$ BEGIN DELETE FROM public.payment_config WHERE id = $1; RETURN QUERY SELECT FOUND, NULL::text; END $$;
  `)
  await db.exec(migration)
})

afterAll(async () => { await db?.close() })

describe('ADMIN-OPS-001 database migration security and workflow', () => {
  it('revokes public admin, role, audit, task, and support reads while retaining service access', async () => {
    await db.exec('RESET ROLE')
    await db.exec('SET ROLE anon')
    await expect(db.query('SELECT * FROM public.admin_audit_events')).rejects.toThrow(/permission denied/i)
    await expect(db.query('SELECT * FROM public.admin_tasks')).rejects.toThrow(/permission denied/i)
    await expect(db.query('SELECT * FROM public.admin_role_permissions')).rejects.toThrow(/permission denied/i)
    await expect(db.query('SELECT * FROM public.support_tickets')).rejects.toThrow(/permission denied/i)
    await expect(db.query('SELECT * FROM public.support_messages')).rejects.toThrow(/permission denied/i)
    await expect(db.query("INSERT INTO public.promotions (title, created_by, updated_by) VALUES ('spoofed', $1, $1)", [SUPER])).rejects.toThrow(/permission denied/i)
    await db.exec('RESET ROLE')
    await db.exec('SET ROLE anon')
    const storefrontPromos = await db.query<{ title: string }>('SELECT title FROM public.promotions ORDER BY title')
    expect(storefrontPromos.rows).toEqual([{ title: 'Visible promotion' }])
    const publicAnnouncement = await db.query<{ title: string }>('SELECT title FROM public.global_announcement')
    expect(publicAnnouncement.rows).toEqual([{ title: 'Store notice' }])
    await asDbOwner()
    await asServiceRole()
    const { rows } = await db.query<{ role: string }>('SELECT role FROM public.admins ORDER BY role')
    expect(rows).toEqual([{ role: 'STAFF' }, { role: 'SUPER_ADMIN' }])
    await asDbOwner()
  })

  it('allows audited admin ticket and task operations without storing free-text bodies in audit metadata', async () => {
    await asServiceRole()
    await db.query('UPDATE public.support_tickets SET status = $1, last_admin_actor_id = $2 WHERE id = $3', ['IN_PROGRESS', SUPER, TICKET])
    await db.query(`INSERT INTO public.admin_tasks (title, description, created_by, updated_by)
      VALUES ('Review test fixture', 'synthetic private note should not be copied', $1, $1)`, [SUPER])
    await asDbOwner()
    await asServiceRole()
    const { rows } = await db.query<{ action: string; metadata: Record<string, unknown> }>(
      "SELECT action, metadata FROM public.admin_audit_events WHERE target_type IN ('support_ticket','task') ORDER BY created_at, action",
    )
    expect(rows.map((row) => row.action)).toEqual(['ticket.updated', 'task.created'])
    expect(JSON.stringify(rows)).not.toContain('synthetic private note')
    expect(rows[0].metadata).toMatchObject({ status: 'IN_PROGRESS' })
    await asDbOwner()
  })

  it('rejects self-role elevation, prevents last-super-admin removal, and protects immutable audit history', async () => {
    await asServiceRole()
    await expect(db.query('UPDATE public.admins SET role = $1, updated_by = id WHERE id = $2', ['SUPER_ADMIN', STAFF])).rejects.toThrow(/ADMIN_SELF_ROLE_CHANGE_FORBIDDEN/i)
    await expect(db.query('UPDATE public.admins SET is_active = false, updated_by = $1 WHERE id = $1', [SUPER])).rejects.toThrow(/ADMIN_SELF_ROLE_CHANGE_FORBIDDEN|LAST_ACTIVE_SUPER_ADMIN/i)
    await asDbOwner()
    await expect(db.query("UPDATE public.admin_audit_events SET action = 'tampered' WHERE action = 'task.created'")).rejects.toThrow(/ADMIN_AUDIT_APPEND_ONLY/i)
  })

  it('allows removing a redundant super admin and preserves at least one active super admin', async () => {
    await asServiceRole()
    await db.query(`INSERT INTO public.admins (id,email,name,role,updated_by)
      VALUES ($1,'second-root@example.invalid','Second root','SUPER_ADMIN',$2)`, [OTHER_SUPER, SUPER])
    await db.query('UPDATE public.admins SET is_active = false, updated_by = $1 WHERE id = $2', [SUPER, OTHER_SUPER])
    const active = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM public.admins WHERE role = 'SUPER_ADMIN' AND is_active")
    expect(active.rows[0].count).toBe(1)
    await expect(db.query('UPDATE public.admins SET is_active = false, updated_by = $1 WHERE id = $1', [SUPER]))
      .rejects.toThrow(/ADMIN_SELF_ROLE_CHANGE_FORBIDDEN/i)
    await asDbOwner()
  })

  it('requires a super-admin actor for persisted role permission changes and audits them', async () => {
    await asServiceRole()
    await expect(db.query(`UPDATE public.admin_role_permissions
      SET is_enabled = false, updated_by = $1 WHERE role = 'STAFF' AND permission_key = 'tasks.manage'`, [STAFF]))
      .rejects.toThrow(/ROLE_PERMISSION_SUPER_ADMIN_REQUIRED/i)
    await db.query(`UPDATE public.admin_role_permissions
      SET is_enabled = false, updated_by = $1 WHERE role = 'STAFF' AND permission_key = 'tasks.manage'`, [SUPER])
    await asDbOwner()
    await asServiceRole()
    const { rows } = await db.query<{ action: string; metadata: Record<string, unknown> }>(
      "SELECT action,metadata FROM public.admin_audit_events WHERE target_type = 'role_permission'",
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: 'role_permission.disabled', metadata: { role: 'STAFF', permission: 'tasks.manage', enabled: false } })
    await asDbOwner()
  })

  it('reprices with row locking, safe publication state, role checks, and transactional audit', async () => {
    await asServiceRole()
    const { rows } = await db.query<{ result: { updated_count: number; updated_ids: string[] } }>(
      'SELECT public.admin_bulk_reprice_packages($1, $2::uuid[], $3, $4) AS result',
      [SUPER, [PACKAGE], 'set_price', 11000],
    )
    expect(rows[0].result.updated_count).toBe(1)
    const packageRow = await db.query<{ price_cents: number; catalog_status: string; is_active: boolean; supplier_review_required: boolean }>(
      'SELECT price_cents,catalog_status,is_active,supplier_review_required FROM public.packages WHERE id = $1', [PACKAGE],
    )
    expect(packageRow.rows[0]).toMatchObject({ price_cents: 11000, catalog_status: 'DRAFT', is_active: false, supplier_review_required: true })
    await expect(db.query('SELECT public.admin_bulk_reprice_packages($1, $2::uuid[], $3, $4)', [STAFF, [PACKAGE], 'set_price', 1000])).rejects.toThrow(/CATALOG_ADMIN_REQUIRED/i)
    await asDbOwner()
    await asServiceRole()
    const audit = await db.query<{ action: string }>("SELECT action FROM public.admin_audit_events WHERE action = 'catalog.package_price_bulk_updated'")
    expect(audit.rows).toHaveLength(1)
    await asDbOwner()
  })

  it('audits single price and pricing-assumption updates and keeps supplier offers draft for review', async () => {
    await asServiceRole()
    await db.query('SELECT public.admin_update_package_price($1, $2, $3, $4, $5)', [SUPER, PACKAGE, 11500, 12500, true])
    const { rows } = await db.query('SELECT * FROM public.admin_update_catalog_pricing_assumptions_audited($1, $2, $3, $4)', [SUPER, 57, 300, 125])
    expect(rows[0]).toMatchObject({ out_fx_rate: '57', out_fee_reserve_bps: 300, out_fixed_fee_cents: 125, out_supplier_packages_for_review: 1 })
    const audits = await db.query<{ action: string }>("SELECT action FROM public.admin_audit_events WHERE action IN ('catalog.package_price_updated','catalog.pricing_assumptions_updated') ORDER BY action")
    expect(audits.rows.map((row) => row.action)).toEqual(['catalog.package_price_updated', 'catalog.pricing_assumptions_updated'])
    await asDbOwner()
  })

  it('routes payment configuration mutations through the server-role audit boundary', async () => {
    await asServiceRole()
    const created = await db.query<{ out_id: string; out_error: string | null }>(
      `SELECT * FROM public.admin_ops_upsert_payment_config(
        $1, NULL, 'test_manual', 'Synthetic Manual', 'manual', 'manual', 'manual', true,
        '', '', NULL, 'synthetic fixture', '', true, 'PHP', ARRAY[]::text[], 1, NULL, NULL, '', NULL, NULL
      )`, [SUPER],
    )
    expect(created.rows[0].out_id).toMatch(/[0-9a-f-]{36}/i)
    const row = await db.query<{ updated_by: string; is_enabled: boolean }>(
      'SELECT updated_by,is_enabled FROM public.payment_config WHERE id = $1', [created.rows[0].out_id],
    )
    expect(row.rows[0]).toEqual({ updated_by: SUPER, is_enabled: true })
    const audit = await db.query<{ action: string; metadata: Record<string, unknown> }>(
      "SELECT action,metadata FROM public.admin_audit_events WHERE target_type = 'payment_config'",
    )
    expect(audit.rows[0]).toMatchObject({ action: 'payment_method.created', metadata: { method_key: 'test_manual', enabled: true, test_mode: true } })

    await db.exec('RESET ROLE')
    await db.exec('SET ROLE authenticated')
    await expect(db.query('SELECT * FROM public.admin_get_all_payment_config()')).rejects.toThrow(/permission denied/i)
    await expect(db.query('UPDATE public.payment_config SET is_enabled = false')).rejects.toThrow(/permission denied/i)
    await asDbOwner()
  })

  it('audits existing promotion and global announcement workflows without copying customer-facing text', async () => {
    await asServiceRole()
    await db.query(`INSERT INTO public.promotions (title,body,created_by,updated_by,is_active)
      VALUES ('Synthetic campaign','private banner copy', $1,$1,true)`, [SUPER])
    await db.query(`INSERT INTO public.global_announcement (title,message,enabled,updated_by)
      VALUES ('Synthetic notice','private announcement copy',true,$1)`, [SUPER])
    await asDbOwner()
    await asServiceRole()
    const { rows } = await db.query<{ action: string; metadata: Record<string, unknown> }>(
      "SELECT action,metadata FROM public.admin_audit_events WHERE action IN ('promotion.created','announcement.created') ORDER BY action",
    )
    expect(rows.map((row) => row.action)).toEqual(['announcement.created', 'promotion.created'])
    expect(JSON.stringify(rows)).not.toContain('private banner copy')
    expect(JSON.stringify(rows)).not.toContain('private announcement copy')
    await asDbOwner()
  })
})
