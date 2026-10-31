import type { NextRequest } from 'next/server';
import { requireAdminPermission } from '@/lib/adminGuard';

/** Catalog management is restricted to active ADMIN / SUPER_ADMIN identities.
 * Active staff sessions may use other staff surfaces, but cannot manage the
 * catalog or pricing assumptions. Database RPCs enforce the same boundary. */
export async function requireCatalogAdmin(req: NextRequest, permission: 'games.manage' | 'pricing.manage' = 'games.manage') {
  return requireAdminPermission(req, permission)
}
