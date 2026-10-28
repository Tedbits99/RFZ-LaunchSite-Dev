import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const workflow = readFileSync('.github/workflows/runfazone-development-db.yml', 'utf8');
const query = readFileSync('supabase/tests/hosted-acl-metadata-audit.sql', 'utf8');
const runner = readFileSync('scripts/audit-hosted-acl-metadata.sh', 'utf8');
const documentation = readFileSync('docs/HOSTED_ACL_METADATA_AUDIT.md', 'utf8');
const databaseHarness = readFileSync('scripts/test-github-actions-database-security.sh', 'utf8');

describe('trusted hosted ACL metadata audit', () => {
  it('is manual, main-only, fixed-project, and uses the protected existing environment', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain('name: runfazone-development-db');
    expect(workflow).toContain("expected_project='ketdhcmwowzztcdlmris'");
    expect(workflow).toContain('          - metadata-acl-audit');
    expect(workflow).toContain('"$OPERATION" = metadata-acl-audit ||');
    expect(workflow).toContain('ref: main');
  });

  it('runs a distinct ACL-only operation and uploads only its bounded metadata artifact', () => {
    const step = workflow.match(/- name: Capture trusted hosted ACL provenance \(metadata only\)[\s\S]*?(?=\n {6}- name:)/)?.[0];
    expect(step).toBeTruthy();
    expect(step).toContain("if: inputs.operation == 'metadata-acl-audit'");
    expect(step).toContain('bash scripts/audit-hosted-acl-metadata.sh');
    expect(step).not.toMatch(/db dump|db push|migration repair|functions deploy|apply/i);
    expect(workflow).toContain('${{ runner.temp }}/hosted-acl-metadata.json');
    expect(workflow).toContain('retention-days: 90');
    expect(workflow).toContain('HOSTED_ACL_AUDIT_MIGRATION_HISTORY_UNCHANGED=true');
  });

  it('queries catalogs only and does not execute application functions or access customer rows', () => {
    const executableSql = query
      .replace(/^\s*--.*$/gm, '')
      .replace(/^\s*\\(?:gset|if|else|endif).*$/gm, '');
    expect(executableSql).not.toMatch(/^\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO)\b/im);
    expect(executableSql).not.toMatch(/FROM\s+(?:public\.(?:orders|customers|profiles|payment_transactions)|auth\.users)\b/i);
    expect(query).toContain('configuration_keys');
    expect(query).not.toContain("'configuration', p.proconfig");
    for (const required of [
      "'section', 'database'",
      "'section', 'tables'",
      "'section', 'effective_table_privileges'",
      "'section', 'direct_relation_acl'",
      "'section', 'default_acl'",
      "'section', 'role_memberships'",
      "'section', 'payment_transactions'",
      "'section', 'public_functions'",
      "'section', 'scheduled_jobs'",
      'pg_catalog.aclexplode',
      'pg_catalog.pg_default_acl',
      "'MAINTAIN'",
    ]) expect(query).toContain(required);
    expect(query).not.toContain('pg_get_functiondef');
  });

  it('executes every metadata query against a disposable PostgreSQL 17+ fixture', async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN;
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
          GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated;
        CREATE TABLE public.payment_transactions (id integer PRIMARY KEY);
        ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
        CREATE POLICY payment_admin_read ON public.payment_transactions
          FOR SELECT TO authenticated USING (true);
        GRANT TRUNCATE, TRIGGER, REFERENCES, MAINTAIN
          ON TABLE public.payment_transactions TO anon, authenticated;
        CREATE FUNCTION public.audit_acl_contract_probe()
          RETURNS integer LANGUAGE sql SECURITY DEFINER
          SET search_path = public AS $$ SELECT 1 $$;
      `);

      const sqlBeforePsqlBranch = query
        .replace(/^\s*--.*$/gm, '')
        .split("SELECT to_regclass('cron.job') IS NOT NULL")[0];
      expect(sqlBeforePsqlBranch).toBeTruthy();
      const statements = sqlBeforePsqlBranch.split(/;\s*/).map((statement) => statement.trim()).filter(Boolean);
      const records: Array<Record<string, unknown>> = [];
      for (const statement of statements) {
        const result = await db.query(statement);
        records.push(Object.values(result.rows[0] ?? {})[0] as Record<string, unknown>);
      }
      const scheduled = await db.query(`
        SELECT jsonb_build_object('section', 'scheduled_jobs',
          'data', jsonb_build_object('cron_relation_present', false, 'job_count', 0))
      `);
      records.push(Object.values(scheduled.rows[0] ?? {})[0] as Record<string, unknown>);

      expect(records).toHaveLength(9);
      const section = (name: string): unknown => records.find((record) => record.section === name)?.data;
      const database = section('database') as {
        server_version_num: number;
        required_roles_present: boolean;
        public_table_count: number;
      };
      expect(database.server_version_num).toBeGreaterThanOrEqual(170000);
      expect(database.required_roles_present).toBe(true);
      expect(database.public_table_count).toBe(1);
      expect(section('tables')).toHaveLength(1);

      const effective = section('effective_table_privileges') as Array<{
        table: string;
        role: string;
        privileges: Record<string, boolean>;
      }>;
      const anonPayment = effective.find((entry) => entry.table === 'payment_transactions' && entry.role === 'anon');
      if (!anonPayment) throw new Error('anonymous payment_transactions privilege row is missing');
      expect(anonPayment.privileges.TRUNCATE).toBe(true);
      expect(anonPayment.privileges.TRIGGER).toBe(true);
      expect(anonPayment.privileges.REFERENCES).toBe(true);
      expect(anonPayment.privileges.MAINTAIN).toBe(true);

      const directAcl = section('direct_relation_acl') as Array<{
        entries: Array<{ grantor: string; grantee: string; privilege: string }>;
      }>;
      expect(directAcl[0].entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ grantor: 'postgres', grantee: 'anon', privilege: 'MAINTAIN' }),
        expect.objectContaining({ grantor: 'postgres', grantee: 'authenticated', privilege: 'TRUNCATE' }),
      ]));
      const defaults = section('default_acl') as Array<{
        creator: string;
        schema: string;
        grantee: string;
        privilege: string;
      }>;
      expect(defaults).toEqual(expect.arrayContaining([
        expect.objectContaining({ creator: 'postgres', schema: 'public', grantee: 'anon', privilege: 'MAINTAIN' }),
      ]));

      const payment = section('payment_transactions') as {
        rls_enabled: boolean;
        policies: Array<{ name: string; command: string }>;
      };
      expect(payment.rls_enabled).toBe(true);
      expect(payment.policies).toEqual([
        expect.objectContaining({ name: 'payment_admin_read', command: 'SELECT' }),
      ]);
      const functions = section('public_functions') as Array<{
        identity: string;
        security_definer: boolean;
        configuration_keys: string[];
      }>;
      expect(functions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          identity: 'audit_acl_contract_probe()',
          security_definer: true,
          configuration_keys: ['search_path'],
        }),
      ]));
    } finally {
      await db.close();
    }
  }, 30_000);

  it('runs the same catalog query in the isolated PostgreSQL 17 security harness', () => {
    expect(databaseHarness).toContain('major_version = 17');
    expect(databaseHarness).toContain('cp "$project_root/supabase/tests/hosted-acl-metadata-audit.sql"');
    expect(databaseHarness).toContain('--file supabase/tests/hosted-acl-metadata-audit.sql');
    expect(databaseHarness).toContain('HOSTED_ACL_METADATA_POSTGRES17_FIXTURE_PASS');
  });

  it('requires trusted SHA provenance, validates complete sections, and bounds output', () => {
    expect(runner).toContain('GITHUB_REF:-');
    expect(runner).toContain('SOURCE_SHA" = "$GITHUB_SHA');
    expect(runner).toContain('4194304');
    expect(runner).toContain('head -c 4194305');
    expect(runner).toContain('record_count" -eq 9');
    expect(runner).toContain('effective_acl_inventory_incomplete');
    expect(runner).toContain('direct_acl_inventory_incomplete');
    expect(runner).toContain('workflow_run_id: $run_id');
    expect(runner).toContain('captured_at_utc: $captured_at');
    expect(runner).toContain('data_rows_exported: false');
    expect(runner).not.toMatch(/set -x|echo .*SUPABASE_DB_PASSWORD|--data-only|supabase db dump/i);
    expect(documentation).toContain('prepared for review only');
    expect(documentation).toContain('no application rows or function bodies');
  });
});
