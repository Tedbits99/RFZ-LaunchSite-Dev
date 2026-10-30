import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireCatalogAdmin } from '@/lib/catalogAdminGuard';
import { resolveFazerCardsCatalogSource } from '@/lib/suppliers/fazercardsCatalogServer';

export async function GET(req: NextRequest) {
  const auth = await requireCatalogAdmin(req);
  if (!auth.ok) return auth.response;
  const result = await resolveFazerCardsCatalogSource(adminSupabase || auth.client);
  return NextResponse.json({
    mode: result.mode,
    ready: result.mode !== null,
    status: result.mode === 'synthetic_fixture' ? 'synthetic_fixture' : result.mode === 'live_provider' ? 'live_authorized' : 'locked',
    message: result.reason,
  }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
