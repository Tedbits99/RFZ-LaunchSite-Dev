import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdminPermission } from '@/lib/adminGuard';
import { resolveFazerCardsCatalogSource } from '@/lib/suppliers/fazercardsCatalogServer';

export async function GET(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'suppliers.view');
  if (!auth.ok) return auth.response;
  const result = await resolveFazerCardsCatalogSource(adminSupabase || auth.client);
  return NextResponse.json({
    mode: result.mode,
    ready: result.mode !== null,
    status: result.mode === 'synthetic_fixture' ? 'synthetic_fixture' : result.mode === 'live_provider' ? 'live_authorized' : 'locked',
    message: result.reason,
  }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
