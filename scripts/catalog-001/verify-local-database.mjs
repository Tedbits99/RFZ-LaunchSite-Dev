import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import postgres from 'postgres';
import { URL } from 'node:url';

const connection = process.env.CATALOG_LOCAL_DB_URL || '';
assert(connection, 'missing disposable PostgreSQL connection');
const dbUrl = new URL(connection);
assert(['postgres:', 'postgresql:'].includes(dbUrl.protocol) && dbUrl.hostname === '127.0.0.1' && dbUrl.port === process.env.E2E_LOCAL_DB_PORT, 'database verification refuses non-loopback targets');
const sql = postgres(connection, { max: 1, prepare: false, idle_timeout: 2, connect_timeout: 10 });

try {
  const [{ server_version_num: version }] = await sql`select current_setting('server_version_num')::integer as server_version_num`;
  assert(Number(version) >= 170000 && Number(version) < 180000, 'catalog disposable database is not PostgreSQL 17');

  const rpcNames = [
    ['admin_get_games_with_package_counts', []],
    ['is_catalog_admin', []],
    ['admin_create_catalog_game', ['jsonb', 'jsonb']],
    ['admin_update_catalog_game', ['uuid', 'jsonb', 'jsonb']],
    ['admin_update_catalog_pricing_assumptions', ['numeric', 'integer', 'integer']],
    ['guard_order_catalog_saleability', []],
  ];
  for (const [name, argumentTypes] of rpcNames) {
    const functionIdentity = `public.${name}(${argumentTypes.join(',')})`;
    const rows = await sql`
      select p.oid::regprocedure::text as identity, p.prosecdef, p.proconfig,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec,
        exists (
          select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'
        ) as public_exec,
        pg_get_functiondef(p.oid) as definition
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = ${name}
        and p.oid = to_regprocedure(${functionIdentity})
    `;
    assert(rows.length === 1, `expected exactly one ${functionIdentity} function identity`);
    const fn = rows[0];
    assert(fn.prosecdef === true, `${name} must remain SECURITY DEFINER`);
    assert(Array.isArray(fn.proconfig) && fn.proconfig.includes('search_path=public'), `${name} must use fixed public search_path`);
    assert(fn.anon_exec === false && fn.public_exec === false, `${name} must not be executable by anon or PUBLIC`);
    if (name === 'guard_order_catalog_saleability') assert(fn.authenticated_exec === false && fn.service_exec === false, 'trigger guard must not be directly executable by API roles');
    else if (name === 'admin_update_catalog_pricing_assumptions') assert(fn.authenticated_exec === false && fn.service_exec === true, 'legacy catalog pricing RPC must be service-role-only');
    else assert(fn.authenticated_exec === true && fn.service_exec === true, `${name} must preserve authenticated/service-role execution`);
    if (name === 'admin_get_games_with_package_counts') assert(fn.definition.includes('is_payment_operator'), 'catalog read RPC must preserve the database-side is_payment_operator guard');
    if (['admin_create_catalog_game', 'admin_update_catalog_game', 'admin_update_catalog_pricing_assumptions'].includes(name)) assert(fn.definition.includes('is_catalog_admin'), `${name} must enforce the catalog-specific admin guard`);
  }

  const auditedPricingIdentity = 'public.admin_update_catalog_pricing_assumptions_audited(uuid,numeric,integer,integer)';
  const [auditedPricing] = await sql`
    select p.prosecdef, p.proconfig,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
      has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec,
      exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_exec
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.oid = to_regprocedure(${auditedPricingIdentity})
  `;
  assert(auditedPricing, 'audited catalog pricing RPC is missing');
  assert(auditedPricing.prosecdef === true, 'audited catalog pricing RPC must remain SECURITY DEFINER');
  assert(Array.isArray(auditedPricing.proconfig) && auditedPricing.proconfig.includes('search_path=public'), 'audited catalog pricing RPC must use fixed public search_path');
  assert(auditedPricing.anon_exec === false && auditedPricing.public_exec === false && auditedPricing.authenticated_exec === false && auditedPricing.service_exec === true,
    'audited catalog pricing RPC must be service-role-only');

  const importIdentity = 'public.admin_import_supplier_catalog(uuid,uuid,text,jsonb,jsonb,text,text,boolean,uuid,text)';
  const importRows = await sql`
    select p.oid::regprocedure::text as identity, p.prosecdef, p.proconfig,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
      has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec,
      exists (
        select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'
      ) as public_exec
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_import_supplier_catalog'
      and p.oid = to_regprocedure(${importIdentity})
  `;
  assert(importRows.length === 1, 'expected the multi-game supplier import RPC');
  const importRpc = importRows[0];
  assert(importRpc.prosecdef === false, 'multi-game import RPC must remain SECURITY INVOKER');
  assert(Array.isArray(importRpc.proconfig) && importRpc.proconfig.some((value) => /^search_path=(?:""|)$/.test(value)), 'multi-game import RPC must use an empty search_path');
  assert(importRpc.anon_exec === false && importRpc.authenticated_exec === false && importRpc.public_exec === false && importRpc.service_exec === true, 'multi-game import RPC must be service-role-only');

  const [{ rls_enabled: auditRls }] = await sql`
    select c.relrowsecurity as rls_enabled
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'supplier_catalog_import_runs'
  `;
  assert(auditRls === true, 'supplier catalog audit table must have RLS enabled');
  const [{ anon_read: auditAnonRead, auth_read: auditAuthRead, service_read: auditServiceRead,
    service_insert: auditServiceInsert, service_update: auditServiceUpdate, service_delete: auditServiceDelete }] = await sql`
    select has_table_privilege('anon', 'public.supplier_catalog_import_runs', 'SELECT') as anon_read,
      has_table_privilege('authenticated', 'public.supplier_catalog_import_runs', 'SELECT') as auth_read,
      has_table_privilege('service_role', 'public.supplier_catalog_import_runs', 'SELECT') as service_read,
      has_table_privilege('service_role', 'public.supplier_catalog_import_runs', 'INSERT') as service_insert,
      has_table_privilege('service_role', 'public.supplier_catalog_import_runs', 'UPDATE') as service_update,
      has_table_privilege('service_role', 'public.supplier_catalog_import_runs', 'DELETE') as service_delete
  `;
  assert(auditAnonRead === false && auditAuthRead === false, 'catalog import audit must not be readable by browser roles');
  assert(auditServiceRead === true && auditServiceInsert === true && auditServiceUpdate === false && auditServiceDelete === false, 'catalog import audit must be service-role-readable, insert-only evidence');
  const [{ offer_identity_index: offerIndex, package_identity_index: packageIndex }] = await sql`
    select to_regclass('public.supplier_package_mappings_offer_identity_uidx') is not null as offer_identity_index,
      to_regclass('public.packages_supplier_offer_identity_uidx') is not null as package_identity_index
  `;
  assert(offerIndex === true && packageIndex === true, 'supplier/category/offer uniqueness indexes are required');

  for (const table of ['games', 'game_input_fields', 'packages']) {
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) {
      const [{ anon_write: anonWrite, auth_write: authWrite }] = await sql`
        select has_table_privilege('anon', ${`public.${table}`}, ${privilege}) as anon_write,
          has_table_privilege('authenticated', ${`public.${table}`}, ${privilege}) as auth_write
      `;
      assert(anonWrite === false && authWrite === false, `client role has direct ${privilege} on ${table}`);
    }
  }

  const [settings] = await sql`select supplier_fulfillment_release_enabled from public.app_settings where id = 1`;
  assert(settings?.supplier_fulfillment_release_enabled === false, 'supplier fulfillment release must remain disabled');
  const [{ enabled, topups_enabled, spending_enabled }] = await sql`select enabled, topups_enabled, spending_enabled from public.rf_coin_settings where id = 1`;
  assert(enabled === false && topups_enabled === false && spending_enabled === false, 'RF Coins release flags must remain disabled');
  const [{ is_enabled: coinPaymentEnabled }] = await sql`select is_enabled from public.payment_config where method_key = 'rf_coin_wallet'`;
  assert(coinPaymentEnabled === false, 'RF Coins payment method must remain disabled');
  const [{ fazercards_enabled: supplierEnabled }] = await sql`select coalesce(bool_or(enabled) filter (where code = 'fazercards'), false) as fazercards_enabled from public.suppliers`;
  assert(supplierEnabled === false, 'synthetic supplier must remain disabled');
  console.log('CATALOG_POSTGRES17_SECURITY_PASS rpc_acl=7 direct_browser_dml=revoked catalog_audit=service-role-append-only supplier_release=off rf_coins=off');
} catch (error) {
  const safeMessage = error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[LOCAL_DATABASE_URL]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[LOCAL_JWT]') : 'unknown error';
  console.error(`CATALOG_POSTGRES17_SECURITY_FAIL ${safeMessage}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}
