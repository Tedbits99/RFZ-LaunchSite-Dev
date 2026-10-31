import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireVoucherAdmin } from '@/lib/voucherAdminGuard';
import { readBoundedJson } from '@/lib/readBoundedJson';

export async function POST(req: NextRequest) {
  const auth = await requireVoucherAdmin(req);
  if (!auth.ok) return auth.response;
  if (!adminSupabase) return NextResponse.json({ error: 'Campaign database is not configured.' }, { status: 503 });
  const input = await readBoundedJson(req, 8192);
  if (!input) return NextResponse.json({ error: 'Invalid or oversized JSON request.' }, { status: 400 });
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof input.campaignId !== 'string' || !uuid.test(input.campaignId)
      || typeof input.packageId !== 'string' || !uuid.test(input.packageId)) {
    return NextResponse.json({ error: 'Valid campaign and package ids are required.' }, { status: 400 });
  }
  const { data, error } = await adminSupabase.rpc('admin_preview_promotion_campaign', {
    p_actor_id: auth.session.userId,
    p_campaign_id: input.campaignId,
    p_package_id: input.packageId,
  });
  if (error) return NextResponse.json({ error: 'Could not preview this campaign.' }, { status: 400 });
  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
}
