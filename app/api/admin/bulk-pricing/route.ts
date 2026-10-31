import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabaseAdmin'
import { requireCatalogAdmin } from '@/lib/catalogAdminGuard'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(req: NextRequest) {
  const auth = await requireCatalogAdmin(req, 'pricing.manage')
  if (!auth.ok) return auth.response
  if (!adminSupabase) return fail('Server-side catalog access is unavailable.', 503)

  const { data, error } = await adminSupabase
    .from('packages')
    .select('id,name,sku,price_cents,is_active,catalog_status,games(name)')
    .order('created_at', { ascending: true })
    .limit(500)
  if (error) return fail('Packages could not be loaded.', 503)
  const packages = (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    sku: row.sku,
    price_cents: row.price_cents,
    is_active: row.is_active,
    catalog_status: row.catalog_status,
    games: row.games,
  }))
  return NextResponse.json({ packages }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest) {
  const auth = await requireCatalogAdmin(req, 'pricing.manage')
  if (!auth.ok) return auth.response
  if (!adminSupabase) return fail('Server-side catalog access is unavailable.', 503)

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || Array.isArray(body)) return fail('A valid JSON object is required.', 400)
  const packageIds = body.packageIds
  const action = body.action
  const value = body.value
  if (!Array.isArray(packageIds) || packageIds.length < 1 || packageIds.length > 200
      || packageIds.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))
      || new Set(packageIds).size !== packageIds.length) {
    return fail('Choose between 1 and 200 unique packages.', 400)
  }
  if (action !== 'set_price' && action !== 'percentage_adjust') return fail('Unsupported bulk pricing action.', 400)
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail('A finite numeric pricing value is required.', 400)
  if (action === 'set_price' && (!Number.isSafeInteger(value) || value < 1 || value > 2147483647)) {
    return fail('Set price requires a positive whole number of cents within the supported range.', 400)
  }
  if (action === 'percentage_adjust' && (value < -99.99 || value > 10000 || value === 0)) {
    return fail('Adjustment must be non-zero and between -99.99% and 10000%.', 400)
  }

  const { data, error } = await adminSupabase.rpc('admin_bulk_reprice_packages', {
    p_actor_id: auth.session.userId,
    p_package_ids: packageIds,
    p_action: action,
    p_value: value,
  })
  if (error) {
    if (error.code === 'P0002') return fail('One or more selected packages no longer exist.', 404)
    if (error.code === '23514') return fail('The price would exceed a package’s configured original price. Review it first.', 409)
    if (error.code === '42501') return fail('The current admin role cannot change package pricing.', 403)
    if (error.code === '22023') return fail('The selected pricing values are outside the supported range.', 400)
    return fail('Bulk pricing could not be applied. No package changes were committed.', 500)
  }
  const result = data && typeof data === 'object' ? data as { updated_count?: number; updated_ids?: string[] } : {}
  return NextResponse.json({
    updated: Number(result.updated_count || 0),
    packageIds: Array.isArray(result.updated_ids) ? result.updated_ids : [],
    requiresRepublish: true,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
