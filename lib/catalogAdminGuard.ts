import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/adminGuard';

/** Catalog management is restricted to active ADMIN / SUPER_ADMIN identities.
 * Active staff sessions may use other staff surfaces, but cannot manage the
 * catalog or pricing assumptions. Database RPCs enforce the same boundary. */
export async function requireCatalogAdmin(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth;
  if (auth.session.role !== 'ADMIN' && auth.session.role !== 'SUPER_ADMIN') {
    return { ok: false as const, response: NextResponse.json({ error: 'Forbidden.' }, { status: 403 }) };
  }
  return auth;
}
