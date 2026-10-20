import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/adminGuard';
import { getPaymentAdapter, buildProviderConfig, listAvailableProviders } from '@/lib/paymentProviderAdapters';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, ['ADMIN', 'SUPER_ADMIN']);
  if (!auth.ok) return auth.response;

  const db = adminSupabase || auth.client;
  if (!db) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const includeProviders = searchParams.get('providers') === '1';

  // Use the SECURITY DEFINER RPC so disabled methods are visible in admin too.
  // RLS on the table only allows anon to see enabled rows.
  const { data, error } = await db.rpc('admin_get_all_payment_config');

  if (error) {
    return NextResponse.json({ error: 'Failed to load payment configuration.' }, { status: 500 });
  }

  const response: Record<string, unknown> = { data };
  if (includeProviders) response.providers = listAvailableProviders();

  return NextResponse.json(response);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, ['ADMIN', 'SUPER_ADMIN']);
  if (!auth.ok) {
    return auth.response;
  }
  const db = adminSupabase || auth.client;
  if (!db) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  try {
    const body = await req.json();

    const { data, error } = await db.rpc('admin_upsert_payment_config', {
      p_id: null,
      p_method_key: String(body.method_key || '').toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      p_display_name: String(body.display_name || ''),
      p_provider: body.provider || 'manual',
      p_provider_type: body.provider_type || 'manual',
      p_provider_name: body.provider_name || 'manual',
      p_is_enabled: Boolean(body.is_enabled),
      p_account_name: body.account_name || '',
      p_account_number: body.account_number || '',
      p_qr_data: body.qr_data || null,
      p_instructions: body.instructions || '',
      p_api_url: body.api_url || '',
      p_is_test_mode: Boolean(body.is_test_mode || body.test_mode),
      p_currency: body.currency || 'PHP',
      p_supported_methods: body.supported_methods || [],
      p_sort_order: Number(body.sort_order) || 0,
      p_min_amount_cents: body.min_amount_cents ?? null,
      p_max_amount_cents: body.max_amount_cents ?? null,
      p_notes: body.notes || '',
      p_webhook_url: body.webhook_url || null,
      p_logo_url: body.logo_url || null,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const row = (data as Array<{ out_id: string | null; out_error: string | null }>)[0];
    if (!row?.out_id) {
      return NextResponse.json({ error: row?.out_error || 'Failed to create.' }, { status: 400 });
    }

    return NextResponse.json({ data: { id: row.out_id } });
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req, ['ADMIN', 'SUPER_ADMIN']);
  if (!auth.ok) {
    return auth.response;
  }
  const db = adminSupabase || auth.client;
  if (!db) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  try {
    const body = await req.json();

    if (body.action === 'test_connection') {
      return testConnection(body);
    }

    const { id } = body;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Payment method id is required.' }, { status: 400 });
    }

    const { data, error } = await db.rpc('admin_upsert_payment_config', {
      p_id: id,
      p_method_key: body.method_key,
      p_display_name: body.display_name,
      p_provider: body.provider || 'manual',
      p_provider_type: body.provider_type || 'manual',
      p_provider_name: body.provider_name || 'manual',
      p_is_enabled: Boolean(body.is_enabled),
      p_account_name: body.account_name || '',
      p_account_number: body.account_number || '',
      p_qr_data: body.qr_data || null,
      p_instructions: body.instructions || '',
      p_api_url: body.api_url || '',
      p_is_test_mode: Boolean(body.is_test_mode || body.test_mode),
      p_currency: body.currency || 'PHP',
      p_supported_methods: body.supported_methods || [],
      p_sort_order: Number(body.sort_order) || 0,
      p_min_amount_cents: body.min_amount_cents ?? null,
      p_max_amount_cents: body.max_amount_cents ?? null,
      p_notes: body.notes || '',
      p_webhook_url: body.webhook_url || null,
      p_logo_url: body.logo_url || null,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const row = (data as Array<{ out_id: string | null; out_error: string | null }>)[0];
    if (!row?.out_id) {
      return NextResponse.json({ error: row?.out_error || 'Failed to update.' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req, ['ADMIN', 'SUPER_ADMIN']);
  if (!auth.ok) {
    return auth.response;
  }
  const db = adminSupabase || auth.client;
  if (!db) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { data, error } = await db.rpc('admin_delete_payment_config', { p_id: id });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = (data as Array<{ out_success: boolean; out_error: string | null }>)[0];
  if (!row?.out_success) {
    return NextResponse.json({ error: row?.out_error || 'Failed to delete.' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

async function testConnection(body: Record<string, unknown>) {
  const providerName = String(body.provider_name || '');
  const adapter = getPaymentAdapter(providerName);
  if (!adapter) return NextResponse.json({ success: false, message: `Unknown provider: ${providerName}` });

  const config = buildProviderConfig(
    providerName,
    String(body.api_url || ''),
    Boolean(body.is_test_mode),
    String(body.currency || 'PHP'),
  );

  const result = await adapter.testConnection(config);
  return NextResponse.json(result);
}
