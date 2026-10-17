import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/adminGuard';
import { generateRandomCode } from '@/lib/voucher';

/*
  Admin voucher CRUD. All mutations require an authenticated admin (RLS
  enforces the admins-table check server-side as a second layer).

  GET    — list vouchers with usage stats + recent orders (reporting)
  POST   — create voucher (or generate a unique code when generate=true)
  PATCH  — update voucher fields
  DELETE — delete voucher
*/

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function intOrNull(v: unknown, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}

function normalizeBody(body: Record<string, unknown>) {
  const code = String(body.code || '').trim().toUpperCase().slice(0, 50);
  const discount_type = body.discount_type === 'PERCENTAGE' ? 'PERCENTAGE' : 'FIXED';
  const discount_value = Math.max(0, Math.floor(Number(body.discount_value) || 0));
  const min_order_cents = Math.max(0, Math.floor(Number(body.min_order_cents) || 0));
  const max_discount_cents = intOrNull(body.max_discount_cents, 100_000_000);
  const usage_limit = intOrNull(body.usage_limit, 1_000_000);
  const per_user_limit = Math.max(0, Math.min(1000, Math.floor(Number(body.per_user_limit ?? 1) || 0)));
  const is_active = Boolean(body.is_active);
  const description = String(body.description || '').trim().slice(0, 200);
  const applies_to_game_id = typeof body.applies_to_game_id === 'string' && UUID_RE.test(body.applies_to_game_id)
    ? body.applies_to_game_id
    : null;
  const starts_at = body.starts_at ? new Date(String(body.starts_at)).toISOString() : new Date().toISOString();
  const ends_at = body.ends_at ? new Date(String(body.ends_at)).toISOString() : null;
  return { code, description, discount_type, discount_value, min_order_cents, max_discount_cents, usage_limit, per_user_limit, is_active, applies_to_game_id, starts_at, ends_at };
}

function validateValues(v: ReturnType<typeof normalizeBody>): string | null {
  if (!v.code) return 'Voucher code is required.';
  if (v.discount_value <= 0) return 'Discount value must be greater than zero.';
  if (v.discount_type === 'PERCENTAGE' && v.discount_value > 100) return 'Percentage discount cannot exceed 100%.';
  if (v.ends_at && v.ends_at < v.starts_at) return 'End date must be after the start date.';
  return null;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const db = adminSupabase || auth.client;
  if (!db) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  const { data, error } = await db
    .from('vouchers')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const vouchers = data || [];

  // Usage counts per voucher (total + per-email breakdown handled client-side).
  const ids = vouchers.map((v) => v.id);
  let usages: Array<{ voucher_id: string; email: string; discount_cents: number | null }> = [];
  if (ids.length > 0) {
    const { data: usageRows, error: usageError } = await db
      .from('voucher_usages')
      .select('voucher_id, email')
      .in('voucher_id', ids);
    if (!usageError) usages = (usageRows || []) as typeof usages;
  }

  // Related orders for reporting: the most recent 200 voucher-backed orders.
  let orders: Array<{
    id: string; reference: string; email: string; status: string;
    subtotal_cents: number; discount_cents: number; total_cents: number;
    voucher_id: string | null; created_at: string;
  }> = [];
  const { data: orderRows, error: orderError } = await db
    .from('orders')
    .select('id, reference, email, status, subtotal_cents, discount_cents, total_cents, voucher_id, created_at')
    .not('voucher_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (!orderError) orders = (orderRows || []) as typeof orders;

  // Game options for the restriction select.
  const { data: gameRows } = await db
    .from('games')
    .select('id, name')
    .order('name');
  const games = (gameRows || []) as Array<{ id: string; name: string }>;

  return NextResponse.json({ data: vouchers, usages, orders, games });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const db = adminSupabase || auth.client;
  if (!db) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  try {
    const body = await req.json();

    // Code generation: return a unique RFZ-prefixed random code.
    if (body.generate === true) {
      const { data: existing } = await db.from('vouchers').select('code');
      const taken = new Set((existing || []).map((r: { code: string }) => String(r.code).toUpperCase()));
      let code = generateRandomCode('RFZ');
      for (let i = 0; i < 20 && taken.has(code); i++) {
        code = generateRandomCode('RFZ');
      }
      return NextResponse.json({ success: true, code });
    }

    const v = normalizeBody(body);
    const validationError = validateValues(v);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const { data: existing } = await db
      .from('vouchers')
      .select('id')
      .ilike('code', v.code)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: 'A voucher with this code already exists.' }, { status: 400 });
    }

    const { data, error } = await db
      .from('vouchers')
      .insert(v)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const db = adminSupabase || auth.client;
  if (!db) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  try {
    const body = await req.json();
    const { id } = body;
    if (!id || typeof id !== 'string' || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Valid voucher id is required.' }, { status: 400 });
    }

    // Quick toggle for activate/deactivate.
    if (Object.keys(body).length === 2 && typeof body.is_active === 'boolean') {
      const { data, error } = await db
        .from('vouchers')
        .update({ is_active: body.is_active })
        .eq('id', id)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ data });
    }

    const v = normalizeBody(body);
    const validationError = validateValues(v);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const { data: clash } = await db
      .from('vouchers')
      .select('id')
      .ilike('code', v.code)
      .neq('id', id)
      .maybeSingle();
    if (clash) {
      return NextResponse.json({ error: 'A voucher with this code already exists.' }, { status: 400 });
    }

    const { data, error } = await db
      .from('vouchers')
      .update(v)
      .eq('id', id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Voucher not found.' }, { status: 404 });
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const db = adminSupabase || auth.client;
  if (!db) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id') || '';
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Valid voucher id is required.' }, { status: 400 });
    }

    // Refuse to delete a voucher that has recorded usages — deactivate instead.
    const { count } = await db
      .from('voucher_usages')
      .select('*', { count: 'exact', head: true })
      .eq('voucher_id', id);
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: 'This voucher has recorded usages and cannot be deleted. Deactivate it instead.' },
        { status: 400 },
      );
    }

    const { error } = await db.from('vouchers').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}
