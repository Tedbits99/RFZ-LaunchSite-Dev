import { adminSupabase } from '@/lib/supabaseAdmin'
import { createAdminServerClient } from '@/lib/authSessionClients'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import PackagesManager from './PackagesManager'

export const dynamic = 'force-dynamic'

type PackageRecord = {
  id: string
  name: string
  sku: string
  amount: string
  price_cents: number
  original_price_cents: number | null
  bonus: string | null
  is_active: boolean
  catalog_status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  supplier_review_required: boolean
  sort_order: number
  badge: string | null
  image_url: string | null
  supplier_offer_id: string | null
  supplier_category_id: string | null
  supplier_cost_usd: string | null
}

export default async function AdminGamePackagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let db: Awaited<ReturnType<typeof createAdminServerClient>>
  try {
    db = adminSupabase || await createAdminServerClient()
  } catch {
    return <div className="grid min-h-screen place-items-center bg-[#030718] text-slate-400">Database not configured.</div>
  }

  const { data: game } = await db.from('games').select('id,name,slug').eq('id', id).maybeSingle()
  if (!game) notFound()

  const { data: packageRows, error: packageError } = await db
    .from('packages')
    .select('id, name, sku, amount, price_cents, original_price_cents, bonus, is_active, catalog_status, supplier_review_required, sort_order, badge, image_url, supplier_offer_id, supplier_category_id, supplier_cost_usd')
    .eq('game_id', id)
    .order('sort_order')
  if (packageError) return <div className="grid min-h-screen place-items-center bg-[#030718] text-rose-300">Package catalog is unavailable to this admin session.</div>
  const allPackages = (packageRows || []) as PackageRecord[]
  const packages = allPackages

  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/95"><div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><Link href="/admin/games" className="text-xs text-slate-400">← Games</Link><span className="text-slate-600">/</span><span className="text-sm font-semibold">{game.name} Packages</span></div><Link href="/" className="text-xs text-slate-400">View Store</Link></div></header>
      <div className="mx-auto max-w-[1180px] px-5 py-8">
        <div className="mb-6"><h1 className="font-display text-2xl font-bold">{game.name} Packages</h1><p className="text-xs text-slate-500">{game.slug === 'mobile-legends' || game.slug === 'mlbb' ? 'Manage current FazerCards Philippines offers and customer pricing' : 'Manage top-up packages for this game'}</p></div>
        <PackagesManager
          packages={packages}
          gameId={game.id}
          isMobileLegends={game.slug === 'mobile-legends' || game.slug === 'mlbb'}
        />
      </div>
    </main>
  )
}
