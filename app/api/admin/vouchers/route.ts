import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { generateRandomCode } from '@/lib/voucher';
import { requireVoucherAdmin } from '@/lib/voucherAdminGuard';

export const dynamic = 'force-dynamic';

function retired() {
  return NextResponse.json({ error: 'Use the audited campaign manager for voucher changes.' }, { status: 410 });
}

/**
 * Compatibility boundary for the former voucher CRUD route. Reads are no
 * longer allowed to return customer emails/orders, and mutations must use the
 * audited campaign RPCs. The only retained operation is code generation.
 */
export async function GET(req: NextRequest) {
  const auth = await requireVoucherAdmin(req);
  if (!auth.ok) return auth.response;
  return retired();
}

export async function POST(req: NextRequest) {
  const auth = await requireVoucherAdmin(req);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON request.' }, { status: 400 }); }
  if (body && typeof body === 'object' && !Array.isArray(body)
      && (body as Record<string, unknown>).generate === true) {
    return NextResponse.json({ success: true, code: generateRandomCode('RFZ') }, { headers: { 'Cache-Control': 'no-store' } });
  }
  return retired();
}

export async function PATCH(req: NextRequest) {
  const auth = await requireVoucherAdmin(req);
  if (!auth.ok) return auth.response;
  return retired();
}

export async function DELETE(req: NextRequest) {
  const auth = await requireVoucherAdmin(req);
  if (!auth.ok) return auth.response;
  if (!adminSupabase) return NextResponse.json({ error: 'Campaign database is not configured.' }, { status: 503 });
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Valid voucher id is required.' }, { status: 400 });
  }
  const { data: campaign, error: lookupError } = await adminSupabase.from('promotion_campaigns')
    .select('id, status').eq('voucher_id', id).maybeSingle();
  if (lookupError || !campaign) return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
  let status = campaign.status;
  if (status === 'ACTIVE') {
    const { data, error } = await adminSupabase.rpc('admin_transition_promotion_campaign', {
      p_actor_id: auth.session.userId, p_campaign_id: campaign.id, p_next_status: 'PAUSED',
    });
    if (error) return NextResponse.json({ error: 'Pause the campaign before archiving.' }, { status: 409 });
    status = (Array.isArray(data) ? data[0]?.out_status : (data as { out_status?: string } | null)?.out_status) || 'PAUSED';
  }
  if (status !== 'ARCHIVED') {
    const { error } = await adminSupabase.rpc('admin_transition_promotion_campaign', {
      p_actor_id: auth.session.userId, p_campaign_id: campaign.id, p_next_status: 'ARCHIVED',
    });
    if (error) return NextResponse.json({ error: 'Campaign could not be archived.' }, { status: 409 });
  }
  return NextResponse.json({ success: true, archived: true });
}
