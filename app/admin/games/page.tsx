import { createAdminServerClient } from '@/lib/authSessionClients'
import { AdminPage } from '@/components/admin/AdminPage'
import { DbNotReady, EmptyState, PageHeader } from '@/components/admin/ui'
import { Gamepad2, Package as PackageIcon } from 'lucide-react'
import Link from 'next/link'
import GameCatalogActions from './GameCatalogActions'

export const dynamic = 'force-dynamic'

type Game = {
  id: string
  name: string
  slug: string
  short_name: string
  description: string
  region: string
  is_active: boolean
  catalog_status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  is_featured: boolean
  sort_order: number
  package_count: number
}

export default async function AdminGamesPage() {
  let games: Game[] = []
  let dbReady = false
  let loadError: string | null = null

  try {
    const db = await createAdminServerClient()
    const { data: { user } } = await db.auth.getUser()
    if (!user) throw new Error('Not authenticated')
    dbReady = true
    const { data, error } = await db.rpc('admin_get_games_with_package_counts')
    if (error) {
      loadError = `Database error: ${error.message}`
    } else {
      games = (data || []) as Game[]
    }
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Database error'
  }

  return (
    <AdminPage title="Games & Packages">
      <PageHeader
        title="Games Catalog"
        subtitle="Manage your game catalog"
        action={
          <GameCatalogActions />
        }
      />

      {!dbReady ? (
        <DbNotReady />
      ) : loadError ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-5 text-sm text-rose-300">{loadError}</div>
      ) : games.length === 0 ? (
        <EmptyState icon={Gamepad2} label="No games yet" hint="Add a game to start building your catalog." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr className="border-b border-[#1b2a45]">
                <th className="p-4 font-medium">Name</th>
                <th className="p-4 font-medium">Region</th>
                <th className="p-4 font-medium">Packages</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium">Featured</th>
                <th className="p-4 font-medium">Sort</th>
                <th className="p-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <tr key={g.id} className="border-b border-[#0f1b31] hover:bg-[#0f1a33]">
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-cyan-400/20 to-violet-600/20 text-cyan-300">
                        <Gamepad2 size={14} />
                      </span>
                      <div>
                        <span className="font-medium text-slate-200">{g.name}</span>
                        <p className="font-mono text-[10px] text-slate-500">{g.slug}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-4 text-slate-400">{g.region}</td>
                  <td className="p-4 text-slate-400">{g.package_count || 0}</td>
                  <td className="p-4"><span className={`rounded-full px-2 py-1 text-[10px] ${g.catalog_status === 'PUBLISHED' ? 'bg-emerald-500/10 text-emerald-300' : g.catalog_status === 'ARCHIVED' ? 'bg-rose-500/10 text-rose-300' : 'bg-slate-500/10 text-slate-300'}`}>{g.catalog_status || (g.is_active ? 'PUBLISHED' : 'DRAFT')}</span></td>
                  <td className="p-4">{g.is_featured ? <span className="text-[10px] text-cyan-300">Featured</span> : <span className="text-[10px] text-slate-600">—</span>}</td>
                  <td className="p-4 text-slate-500">{g.sort_order}</td>
                  <td className="p-4">
                    <div className="flex flex-wrap items-center gap-1">
                    <GameCatalogActions game={{ id: g.id, name: g.name, slug: g.slug, description: g.description, region: g.region, is_active: g.is_active, catalog_status: g.catalog_status || (g.is_active ? 'PUBLISHED' : 'DRAFT') }} />
                    <Link
                      href={`/admin/games/${g.id}/packages`}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#22314d] px-2.5 py-1 text-[11px] text-cyan-300 hover:border-cyan-400/50 hover:bg-cyan-400/5"
                    >
                      <PackageIcon size={12} /> Packages
                    </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminPage>
  )
}
