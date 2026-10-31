import { adminSupabase } from '@/lib/supabaseAdmin'
import { AdminPage } from '@/components/admin/AdminPage'
import { DbNotReady, EmptyState, PageHeader } from '@/components/admin/ui'
import { Megaphone } from 'lucide-react'
import PromotionsClient from './PromotionsClient'
import { getAdminPermissionSet, getAdminSession } from '@/lib/adminGuard'

export const dynamic = 'force-dynamic'

type Promotion = {
  id: string
  title: string
  body: string
  target_type: 'GLOBAL' | 'GAME' | 'PACKAGE'
  game_id: string | null
  package_id: string | null
  image_url: string | null
  cta_text: string | null
  cta_href: string | null
  starts_at: string | null
  ends_at: string | null
  is_active: boolean
  sort_order: number
  placement: string
  target_game_id: string | null
}

type GameOption = { id: string; name: string }

export default async function AdminPromotionsPage() {
  const session = await getAdminSession()
  if (!session) return null
  const permissions = await getAdminPermissionSet(session.role)
  if (!permissions?.includes('*') && !permissions?.includes('marketing.manage')) {
    return <AdminPage title="Promotions"><p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-5 text-sm text-rose-200">Your role cannot manage promotions.</p></AdminPage>
  }
  let promos: Promotion[] = []
  let games: GameOption[] = []
  let dbReady = false
  const db = adminSupabase
  if (db) {
    dbReady = true
    const [promoRes, gamesRes] = await Promise.all([
      db.from('promotions').select('*').order('sort_order'),
      db.from('games').select('id, name').order('name'),
    ])
    promos = (promoRes.data || []) as Promotion[]
    games = (gamesRes.data || []) as GameOption[]
  }

  return (
    <AdminPage title="Promotions">
      <PageHeader
        title="Promotions"
        subtitle="Manage promotional banners and hero images"
      />

      {!dbReady ? (
        <DbNotReady />
      ) : promos.length === 0 && games.length === 0 ? (
        <EmptyState icon={Megaphone} label="No promotions yet" hint="Create a banner to promote a game or package." />
      ) : (
        <PromotionsClient initialPromos={promos} games={games} />
      )}
    </AdminPage>
  )
}
