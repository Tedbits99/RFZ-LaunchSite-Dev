import { NextResponse, type NextRequest } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/adminGuard';

/** Campaign discounts are financial rules: only explicitly active ADMIN and
 * SUPER_ADMIN records may manage them. A missing/null role never defaults up. */
export async function requireVoucherAdmin(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth;

  const db = adminSupabase || auth.client;
  if (!db) {
    return { ok: false as const, response: NextResponse.json({ error: 'Authorization is unavailable.' }, { status: 503 }) };
  }
  const { data, error } = await db.from('admins')
    .select('role, is_active')
    .eq('id', auth.session.userId)
    .maybeSingle();
  if (error) {
    return { ok: false as const, response: NextResponse.json({ error: 'Authorization is unavailable.' }, { status: 503 }) };
  }
  if (!data?.is_active || !['ADMIN', 'SUPER_ADMIN'].includes(data.role || '')) {
    return { ok: false as const, response: NextResponse.json({ error: 'Forbidden.' }, { status: 403 }) };
  }
  return auth;
}
