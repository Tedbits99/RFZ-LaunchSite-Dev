'use client'

import { ReactNode, useEffect, useState } from 'react'
import { Activity, LogOut } from 'lucide-react'
import { notFound } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser'
import AdminNavigation from '@/components/admin/AdminNavigation'

type Status = 'checking' | 'allowed' | 'denied'

export default function AdminLayout({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking')

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      setStatus('denied')
      return
    }

    let cancelled = false

    supabase.auth.getSession().then(async ({ data }: { data: { session: { user: { id: string } } | null } }) => {
      if (cancelled) return
      const session = data.session
      if (!session) {
        setStatus('denied')
        return
      }
      // Only users with a record in the admins table may see the dashboard.
      const { data: admin } = await supabase
        .from('admins')
        .select('id')
        .eq('id', session.user.id)
        .maybeSingle()
      if (cancelled) return
      setStatus(admin ? 'allowed' : 'denied')
    })

    return () => { cancelled = true }
  }, [])

  if (status === 'denied') notFound()

  if (status !== 'allowed') {
    return (
      <div className="grid min-h-screen place-items-center bg-[#030718]">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#030718] text-slate-100">
      <div className="sticky top-0 z-40">
        <header className="border-b border-[#1b2a45] bg-[#050a1b]/95 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <img
                src="https://res.cloudinary.com/dex5ykrfs/image/upload/v1789837643/R_logo_1_au2g5c.png"
                alt="RunFazone"
                width={1701}
                height={378}
                className="h-10 w-auto object-contain"
              />
              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-500">
                  Dashboard
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <a
                href="/"
                className="rounded-lg border border-[#253451] px-3 py-2"
              >
                View Store
              </a>
              <span className="hidden items-center gap-2 rounded-lg border border-[#253451] px-3 py-2 sm:flex">
                <Activity size={13} className="text-cyan-300" /> Admin
              </span>
              <button
                onClick={async () => {
                  const supabase = getSupabaseBrowserClient()
                  if (supabase) await supabase.auth.signOut()
                  window.location.href = '/secure-admin-login'
                }}
                className="flex items-center gap-2 rounded-lg border border-[#253451] px-3 py-2 transition hover:border-rose-400 hover:text-rose-200"
              >
                <LogOut size={13} /> Log out
              </button>
            </div>
          </div>
        </header>

        <AdminNavigation />
      </div>
      {children}
    </div>
  )
}
