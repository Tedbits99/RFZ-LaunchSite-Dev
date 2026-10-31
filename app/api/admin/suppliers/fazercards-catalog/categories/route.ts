import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireCatalogAdmin } from '@/lib/catalogAdminGuard';
import { CatalogSourceError, listFazerCardsCategories } from '@/lib/suppliers/fazercardsCatalog';
import { resolveFazerCardsCatalogSource } from '@/lib/suppliers/fazercardsCatalogServer';

export async function GET(req: NextRequest) {
  const auth = await requireCatalogAdmin(req);
  if (!auth.ok) return auth.response;
  const source = await resolveFazerCardsCatalogSource(adminSupabase || auth.client);
  if (!source.mode) return NextResponse.json({ error: source.reason, status: 'locked' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  try {
    const params = new URL(req.url).searchParams;
    const page = await listFazerCardsCategories({
      mode: source.mode,
      cursor: params.get('cursor'),
      search: params.get('q') || '',
    });
    return NextResponse.json({ ok: true, kind: 'categories', ...page, source: source.mode }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof CatalogSourceError ? error.status : 503;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Catalog categories are unavailable.' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
