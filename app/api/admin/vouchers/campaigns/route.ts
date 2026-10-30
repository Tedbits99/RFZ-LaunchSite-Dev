import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { generateRandomCode } from '@/lib/voucher';
import { requireVoucherAdmin } from '@/lib/voucherAdminGuard';
import { readBoundedJson } from '@/lib/readBoundedJson';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function readJson(req: NextRequest): Promise<Record<string, unknown> | null> {
  return readBoundedJson(req, 32 * 1024);
}

function failure(error: { code?: string; message?: string } | null, fallback: string) {
  const code = error?.code || '';
  const message = error?.message || '';
  if (code === '42501' || /FORBIDDEN/.test(message)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  if (code === 'P0002' || /CAMPAIGN_NOT_FOUND/.test(message)) return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
  if (code === '23505' || /duplicate key|unique constraint/i.test(message)) return NextResponse.json({ error: 'That campaign code is already in use.' }, { status: 409 });
  if (/PAUSE_CAMPAIGN|CAMPAIGN_TYPE_LOCKED|CAMPAIGN_CODE_LOCKED|BUDGET_BELOW|LIMIT_BELOW|INVALID_CAMPAIGN_STATE/.test(message)) {
    return NextResponse.json({ error: 'Pause the campaign or resolve its active redemptions before changing these settings.' }, { status: 409 });
  }
  if (code.startsWith('22') || code.startsWith('23') || code === '55000' || /INVALID_|CAMPAIGN_|TARGET_|PACKAGE_.*TARGET/.test(message)) {
    return NextResponse.json({ error: message.replace(/^.*?(INVALID_[A-Z_]+|[A-Z_]+_REQUIRED|CAMPAIGN_[A-Z_]+|PACKAGE_GAME_TARGET_MISMATCH).*$/s, '$1').replaceAll('_', ' ').toLowerCase() || 'Campaign settings are invalid.' }, { status: 400 });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const auth = await requireVoucherAdmin(req);
  if (!auth.ok) return auth.response;
  if (!adminSupabase) return NextResponse.json({ error: 'Campaign database is not configured.' }, { status: 503 });

  const [{ data: campaigns, error: campaignError }, { data: games, error: gameError }, { data: packages, error: packageError }] = await Promise.all([
    adminSupabase.rpc('admin_list_promotion_campaigns', { p_actor_id: auth.session.userId }),
    adminSupabase.from('games').select('id, name, slug, catalog_status, is_active').order('name').limit(300),
    adminSupabase.from('packages').select('id, game_id, name, price_cents, catalog_status, is_active, supplier_review_required').order('name').limit(1000),
  ]);
  if (campaignError) return failure(campaignError, 'Could not load campaign data.');
  if (gameError || packageError) return NextResponse.json({ error: 'Could not load campaign target options.' }, { status: 503 });
  const response = NextResponse.json({ data: campaigns || [], games: games || [], packages: packages || [] });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(req: NextRequest) {
  const auth = await requireVoucherAdmin(req);
  if (!auth.ok) return auth.response;
  if (!adminSupabase) return NextResponse.json({ error: 'Campaign database is not configured.' }, { status: 503 });
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: 'Invalid or oversized JSON request.' }, { status: 400 });

  if (body.action === 'generate-code') {
    return NextResponse.json({ code: generateRandomCode('RFZ') }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (body.action === 'duplicate') {
    if (typeof body.id !== 'string' || !UUID_RE.test(body.id)) return NextResponse.json({ error: 'Valid campaign id is required.' }, { status: 400 });
    const { data, error } = await adminSupabase.rpc('admin_duplicate_promotion_campaign', {
      p_actor_id: auth.session.userId,
      p_campaign_id: body.id,
      p_new_code: generateRandomCode('RFZ'),
    });
    if (error) return failure(error, 'Could not duplicate campaign.');
    return NextResponse.json({ data: Array.isArray(data) ? data[0] : data }, { status: 201 });
  }

  const payload = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'action'));
  const { data, error } = await adminSupabase.rpc('admin_create_promotion_campaign', {
    p_actor_id: auth.session.userId,
    p_data: payload,
  });
  if (error) return failure(error, 'Could not create campaign.');
  return NextResponse.json({ data: Array.isArray(data) ? data[0] : data }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireVoucherAdmin(req);
  if (!auth.ok) return auth.response;
  if (!adminSupabase) return NextResponse.json({ error: 'Campaign database is not configured.' }, { status: 503 });
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: 'Invalid or oversized JSON request.' }, { status: 400 });
  if (typeof body.id !== 'string' || !UUID_RE.test(body.id)) return NextResponse.json({ error: 'Valid campaign id is required.' }, { status: 400 });

  if (body.action === 'status') {
    if (typeof body.status !== 'string') return NextResponse.json({ error: 'A campaign status is required.' }, { status: 400 });
    const { data, error } = await adminSupabase.rpc('admin_transition_promotion_campaign', {
      p_actor_id: auth.session.userId,
      p_campaign_id: body.id,
      p_next_status: body.status,
    });
    if (error) return failure(error, 'Could not change campaign status.');
    return NextResponse.json({ data: Array.isArray(data) ? data[0] : data });
  }

  const payload = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'id' && key !== 'action'));
  const { data, error } = await adminSupabase.rpc('admin_update_promotion_campaign', {
    p_actor_id: auth.session.userId,
    p_campaign_id: body.id,
    p_data: payload,
  });
  if (error) return failure(error, 'Could not update campaign.');
  return NextResponse.json({ data: Array.isArray(data) ? data[0] : data });
}
