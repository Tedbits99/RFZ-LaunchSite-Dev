import { adminSupabase } from '@/lib/supabaseAdmin'
import { createSupabaseServerClient } from '@/lib/supabaseServer'
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
  sort_order: number
  badge: string | null
  image_url: string | null
  supplier_offer_id: string | null
  supplier_category_id: string | null
  supplier_cost_usd: string | null
}

export default async function AdminGamePackagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let db: Awaited<ReturnType<typeof createSupabaseServerClient>>
  try {
    db = adminSupabase || await createSupabaseServerClient()
  } catch {
    return <div className="grid min-h-screen place-items-center bg-[#030718] text-slate-400">Database not configured.</div>
  }

  const { data: game } = await db.from('games').select('id,name,slug').eq('id', id).maybeSingle()
  if (!game) notFound()

  const { data: packageRows } = await db
    .from('packages')
    .select('id, name, sku, amount, price_cents, original_price_cents, bonus, is_active, sort_order, badge, image_url, supplier_offer_id, supplier_category_id, supplier_cost_usd')
    .eq('game_id', id)
    .order('sort_order')
  const allPackages = (packageRows || []) as PackageRecord[]
  const packages = game.slug === 'mobile-legends' || game.slug === 'mlbb'
    ? allPackages.filter((pkg) => pkg.supplier_category_id === 'mobile_legends_philippines' && Boolean(pkg.supplier_offer_id))
    : allPackages

  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/95"><div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><Link href="/admin/games" className="text-xs text-slate-400">← Games</Link><span className="text-slate-600">/</span><span className="text-sm font-semibold">{game.name} Packages</span></div><Link href="/" className="text-xs text-slate-400">View Store</Link></div></header>
      <div className="mx-auto max-w-[1180px] px-5 py-8">
        <div className="mb-6"><h1 className="font-display text-2xl font-bold">{game.name} Packages</h1><p className="text-xs text-slate-500">{game.slug === 'mobile-legends' || game.slug === 'mlbb' ? 'Manage current FazerCards Philippines offers and customer pricing' : 'Manage top-up packages for this game'}</p></div>
        <PackagesManager
          packages={game.slug === 'mobile-legends' || game.slug === 'mlbb' ? [] : packages}
          gameId={game.id}
          isMobileLegends={game.slug === 'mobile-legends' || game.slug === 'mlbb'}
        />
      </div>
    </main>
  )
}
