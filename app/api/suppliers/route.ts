import { NextRequest, NextResponse } from 'next/server';
import { SUPPORTED_ADAPTERS } from '@/lib/suppliers/adapter';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/adminGuard';

const VALID_ADAPTERS = new Set<string>(SUPPORTED_ADAPTERS);

function normalizeAdapter(value: unknown): string {
  const adapter = String(value || 'generic').toLowerCase();
  if (!VALID_ADAPTERS.has(adapter)) {
    throw new Error(`Unsupported adapter: ${adapter}. Supported: ${SUPPORTED_ADAPTERS.join(', ')}`);
  }
  return adapter;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const db = adminSupabase || auth.client;
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const { data, error } = await db
    .from('suppliers')
    .select('id, name, code, adapter, api_url, sandbox_api_url, environment, enabled, priority, retry_count, timeout_ms, low_balance_threshold_cents, supports_balance, supports_validation, supports_refund, auth_type, auth_config, last_success_at, last_failure_at, last_error, cached_balance_cents, balance_checked_at, metadata, created_at, updated_at')
    .order('priority', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const db = adminSupabase || auth.client;
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const body = await req.json();
  let adapterValue: string;
  try {
    adapterValue = normalizeAdapter(body.adapter);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid adapter' }, { status: 400 });
  }
  const row = {
    name: String(body.name || ''),
    code: String(body.code || '').toLowerCase().replace(/[^a-z0-9_]/g, '_'),
    adapter: adapterValue,
    api_url: String(body.api_url || ''),
    sandbox_api_url: body.sandbox_api_url || null,
    environment: body.environment === 'live' ? 'live' : 'sandbox',
    enabled: Boolean(body.enabled),
    priority: Number(body.priority) || 0,
    retry_count: Number(body.retry_count) || 3,
    timeout_ms: Number(body.timeout_ms) || 15000,
    low_balance_threshold_cents: Number(body.low_balance_threshold_cents) || 100000,
    supports_balance: Boolean(body.supports_balance),
    supports_validation: Boolean(body.supports_validation),
    supports_refund: Boolean(body.supports_refund),
    auth_type: body.auth_type || 'api_key',
    auth_config: body.auth_config || {},
    metadata: body.metadata || {},
  };

  if (!row.name || !row.code) return NextResponse.json({ error: 'Name and code are required' }, { status: 400 });

  const { data, error } = await db.from('suppliers').insert(row).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const db = adminSupabase || auth.client;
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const allowed = ['name', 'code', 'api_url', 'sandbox_api_url', 'environment', 'enabled', 'priority', 'retry_count', 'timeout_ms', 'low_balance_threshold_cents', 'supports_balance', 'supports_validation', 'supports_refund', 'auth_type', 'auth_config', 'metadata'];
  for (const key of allowed) {
    if (body[key] !== undefined) update[key] = body[key];
  }
  if (body.adapter !== undefined) {
    try {
      update.adapter = normalizeAdapter(body.adapter);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid adapter' }, { status: 400 });
    }
  }

  const { data, error } = await db.from('suppliers').update(update).eq('id', body.id).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const db = adminSupabase || auth.client;
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { error } = await db.from('suppliers').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
