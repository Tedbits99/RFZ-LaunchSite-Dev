import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import postgres from 'postgres';
import { URL } from 'node:url';

const connection = process.env.CATALOG_LOCAL_DB_URL || '';
assert(connection, 'VOUCHERS-001 requires a disposable local PostgreSQL URL');
const database = new URL(connection);
assert(['postgres:', 'postgresql:'].includes(database.protocol)
  && database.hostname === '127.0.0.1'
  && database.port === process.env.E2E_LOCAL_DB_PORT,
'VOUCHERS-001 security checks refuse a non-loopback database');

const sql = postgres(connection, { max: 1, prepare: false, idle_timeout: 2, connect_timeout: 10 });
const functionPolicies = [
  ['public.evaluate_promotion_voucher(text,uuid,text,boolean)', 'none'],
  ['public.validate_campaign_voucher(text,uuid,text)', 'service-only'],
  ['public.validate_campaign_voucher_for_server(text,uuid,text,uuid)', 'service-only'],
  ['public.list_public_promotion_offers(uuid,text)', 'public-read'],
  ['public.admin_create_promotion_campaign(uuid,jsonb)', 'service-only'],
  ['public.admin_update_promotion_campaign(uuid,uuid,jsonb)', 'service-only'],
  ['public.admin_transition_promotion_campaign(uuid,uuid,text)', 'service-only'],
  ['public.admin_duplicate_promotion_campaign(uuid,uuid,text)', 'service-only'],
  ['public.admin_list_promotion_campaigns(uuid)', 'service-only'],
  ['public.admin_get_promotion_campaign_report(uuid,uuid,integer)', 'service-only'],
  ['public.admin_preview_promotion_campaign(uuid,uuid,uuid)', 'service-only'],
  ['public.consume_voucher_validation_rate_limit(text)', 'service-only'],
  ['public.create_order(uuid,uuid,text,text,jsonb,text,text,text)', 'checkout'],
  ['public.create_order_idempotent(uuid,uuid,text,text,jsonb,text,text,text,uuid)', 'checkout'],
  ['public.validate_voucher(text,integer,uuid,text)', 'service-only'],
  ['public.validate_and_reserve_voucher_usage()', 'none'],
  ['public.reconcile_voucher_usage_with_order()', 'none'],
  ['voucher_private.consume_checkout_rate_bucket(text,integer)', 'none'],
  ['voucher_private.consume_checkout_voucher_attempt(text)', 'none'],
];

try {
  const [{ version }] = await sql`select current_setting('server_version_num')::integer as version`;
  assert(Number(version) >= 170000 && Number(version) < 180000, 'security fixture must use PostgreSQL 17');

  const tables = [
    'vouchers', 'voucher_usages', 'promotion_campaigns', 'promotion_campaign_games',
    'promotion_campaign_packages', 'promotion_campaign_audit',
  ];
  for (const table of tables) {
    const rows = await sql`
      select c.relrowsecurity as enabled
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = ${table}
    `;
    assert(rows.length === 1 && rows[0].enabled, `${table} must have RLS enabled`);
    for (const role of ['anon', 'authenticated']) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const [{ granted }] = await sql`select has_table_privilege(${role}, ${`public.${table}`}, ${privilege}) as granted`;
        assert(!granted, `${role} unexpectedly has ${privilege} on ${table}`);
      }
    }
  }

  for (const table of ['promotion_campaigns', 'promotion_campaign_games', 'promotion_campaign_packages', 'promotion_campaign_audit', 'voucher_usages', 'vouchers']) {
    const [{ read, insert, update, delete: del }] = await sql`
      select has_table_privilege('service_role', ${`public.${table}`}, 'SELECT') as read,
        has_table_privilege('service_role', ${`public.${table}`}, 'INSERT') as insert,
        has_table_privilege('service_role', ${`public.${table}`}, 'UPDATE') as update,
        has_table_privilege('service_role', ${`public.${table}`}, 'DELETE') as delete
    `;
    assert(read, `service_role must retain read access to ${table} for the guarded server APIs`);
    assert(!insert && !update && !del, `service_role must not directly mutate ${table}`);
  }

  for (const [identity, policy] of functionPolicies) {
    const rows = await sql`
      select p.oid::regprocedure::text as identity, p.prosecdef,
        coalesce(p.proconfig, array[]::text[]) as settings,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec,
        exists (
          select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'
        ) as public_exec
      from pg_proc p where p.oid = to_regprocedure(${identity})
    `;
    assert(rows.length === 1, `expected exact function identity ${identity}`);
    const fn = rows[0];
    assert(fn.prosecdef === true, `${identity} must be SECURITY DEFINER`);
    assert(fn.settings.some((value) => value.startsWith('search_path=')), `${identity} must pin search_path`);
    assert(!fn.public_exec, `${identity} must not be executable by PUBLIC`);
    if (policy === 'none') {
      assert(!fn.anon_exec && !fn.auth_exec && !fn.service_exec, `${identity} must not be directly executable by API roles`);
    } else if (policy === 'public-read') {
      assert(fn.anon_exec && fn.auth_exec && !fn.service_exec, `${identity} must expose only its limited browser-safe contract`);
    } else if (policy === 'service-only') {
      assert(!fn.anon_exec && !fn.auth_exec && fn.service_exec, `${identity} must be service-role-only`);
    } else {
      assert(fn.anon_exec && fn.auth_exec && !fn.service_exec, `${identity} must be callable only under the request JWT roles`);
    }
  }

  const [privateSchema] = await sql`
    select has_schema_privilege('anon', 'voucher_private', 'USAGE') as anon_usage,
      has_schema_privilege('authenticated', 'voucher_private', 'USAGE') as auth_usage,
      has_schema_privilege('service_role', 'voucher_private', 'USAGE') as service_usage
  `;
  assert(!privateSchema.anon_usage && !privateSchema.auth_usage && !privateSchema.service_usage,
    'voucher_private must not be directly usable by API roles');

  const [release] = await sql`
    select a.supplier_fulfillment_release_enabled,
      coalesce((select enabled from public.rf_coin_settings where id = 1), false) as rf_coins_enabled,
      coalesce((select topups_enabled from public.rf_coin_settings where id = 1), false) as rf_coins_topups,
      coalesce((select spending_enabled from public.rf_coin_settings where id = 1), false) as rf_coins_spending,
      coalesce((select is_enabled from public.payment_config where method_key = 'rf_coin_wallet'), false) as rf_coins_payment
    from public.app_settings a where a.id = 1
  `;
  assert(release && release.supplier_fulfillment_release_enabled === false, 'supplier release must remain disabled');
  assert(!release.rf_coins_enabled && !release.rf_coins_topups && !release.rf_coins_spending && !release.rf_coins_payment,
    'RF Coins flags and payment method must remain disabled');

  const [supplier] = await sql`select coalesce(bool_or(enabled) filter (where code = 'fazercards'), false) as enabled from public.suppliers`;
  assert(!supplier.enabled, 'FazerCards supplier record must remain disabled');

  const [accounting] = await sql`
    select count(*) filter (where u.campaign_id is null)::integer as unassigned_usage_rows,
      count(*) filter (where u.discount_cents <> coalesce(o.voucher_discount_cents, o.discount_cents, 0))::integer as bad_snapshots
    from public.voucher_usages u join public.orders o on o.id = u.order_id
  `;
  assert(accounting.unassigned_usage_rows === 0 && accounting.bad_snapshots === 0,
    'voucher history must have campaign attribution and exact order discount snapshots');

  const [{ overspent_campaigns }] = await sql`
    select count(*)::integer as overspent_campaigns from (
      select c.id
      from public.promotion_campaigns c
      left join public.voucher_usages u on u.campaign_id = c.id and u.redemption_status in ('RESERVED', 'COMMITTED')
      group by c.id
      having c.discount_budget_cents is not null and coalesce(sum(u.discount_cents), 0) > c.discount_budget_cents
         or c.total_redemption_limit is not null and count(u.id) > c.total_redemption_limit
    ) violations
  `;
  assert(overspent_campaigns === 0, `active voucher ledger exceeds a campaign limit or budget (campaigns=${overspent_campaigns})`);

  console.log('VOUCHERS_POSTGRES17_SECURITY_PASS rls=5 api_acl=16 private_schema=sealed release_locks=off accounting=reconciled');
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown error';
  console.error(`VOUCHERS_POSTGRES17_SECURITY_FAIL ${message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[LOCAL_DATABASE_URL]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[LOCAL_JWT]')}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}
