import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAdapter } from '@/lib/suppliers/adapter';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/adminGuard';

function getDb() {
  if (adminSupabase) return adminSupabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function resolveCredentials(supplierCode: string): Record<string, string> {
  const prefix = `SUPPLIER_${supplierCode.toUpperCase()}_`;
  const creds: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith(prefix) && v) {
      creds[k.slice(prefix.length).toLowerCase()] = v;
    }
  }
  return creds;
}

export async function GET(req: NextRequest) {
  return pollTestRun(req);
}

export async function POST(req: NextRequest) {
  return pollTestRun(req);
}

async function pollTestRun(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session.ok) return session.response;

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  try {
    const { searchParams } = new URL(req.url);
    const runId = searchParams.get('id');

    if (!runId) {
      return NextResponse.json({ error: 'Missing test run ID' }, { status: 400 });
    }

    const { data: run, error: runError } = await db
      .from('supplier_test_runs')
      .select('*')
      .eq('id', runId)
      .maybeSingle();

    if (runError || !run) {
      return NextResponse.json({ error: 'Test run not found' }, { status: 404 });
    }

    if (!run.supplier_reference) {
      return NextResponse.json({ error: 'No supplier reference to poll' }, { status: 400 });
    }

    const { data: supplier } = await db
      .from('suppliers')
      .select('*')
      .eq('id', run.supplier_id)
      .maybeSingle();

    if (!supplier) {
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });
    }

    const config = {
      id: supplier.id,
      code: supplier.code,
      adapter: supplier.adapter,
      apiUrl: supplier.api_url,
      sandboxApiUrl: supplier.sandbox_api_url,
      environment: supplier.environment,
      timeoutMs: supplier.timeout_ms,
      retryCount: supplier.retry_count,
      authType: supplier.auth_type,
      authConfig: supplier.auth_config,
      metadata: supplier.metadata,
      credentials: resolveCredentials(supplier.code),
    };

    const adapter = getAdapter(supplier.adapter, supplier.code);
    const polledAt = new Date().toISOString();

    try {
      const statusResult = await adapter.queryStatus(config, run.supplier_reference);

      const rawStatus = statusResult.status as string;
      let localStatus = run.local_status;
      if (rawStatus === 'completed') {
        localStatus = 'SUCCESS';
      } else if (rawStatus === 'failed') {
        localStatus = 'FAILED';
      } else if (rawStatus === 'processing' || rawStatus === 'created' || rawStatus === 'pending') {
        localStatus = 'PROCESSING';
      } else {
        localStatus = 'UNKNOWN';
      }

      const { data: updated, error: updateError } = await db
        .from('supplier_test_runs')
        .update({
          local_status: localStatus,
          supplier_status: statusResult.status,
          status_payload: statusResult.rawResponse || null,
          last_polled_at: polledAt,
        })
        .eq('id', runId)
        .select()
        .single();

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      return NextResponse.json({
        data: updated,
        supplier_status: statusResult.status,
        local_status: localStatus,
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Status query failed';

      await db
        .from('supplier_test_runs')
        .update({
          local_status: 'UNKNOWN',
          error: errMsg,
          last_polled_at: polledAt,
        })
        .eq('id', runId);

      return NextResponse.json({ error: errMsg, local_status: 'UNKNOWN' }, { status: 200 });
    }
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
