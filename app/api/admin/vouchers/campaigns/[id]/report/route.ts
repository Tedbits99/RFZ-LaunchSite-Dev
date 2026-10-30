import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireVoucherAdmin } from '@/lib/voucherAdminGuard';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireVoucherAdmin(req);
  if (!auth.ok) return auth.response;
  if (!adminSupabase) return NextResponse.json({ error: 'Campaign database is not configured.' }, { status: 503 });
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Valid campaign id is required.' }, { status: 400 });
  }
  const rawLimit = Number(new URL(req.url).searchParams.get('limit') || 50);
  const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 50;
  const { data, error } = await adminSupabase.rpc('admin_get_promotion_campaign_report', {
    p_actor_id: auth.session.userId,
    p_campaign_id: id,
    p_limit: limit,
  });
  if (error) {
    const status = error.code === 'P0002' ? 404 : 503;
    return NextResponse.json({ error: status === 404 ? 'Campaign not found.' : 'Could not load the campaign report.' }, { status });
  }
  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
}
