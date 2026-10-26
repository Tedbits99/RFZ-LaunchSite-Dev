'use client'

import { useState, type ReactNode } from 'react'
import { Activity, Bell, LogOut, Menu, Search } from 'lucide-react'
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser'
import AdminNavigation from '@/components/admin/AdminNavigation'
import { RFZ_PUBLIC_ASSETS } from '@/lib/storefrontAssets'

export default function AdminShell({ children }: { children: ReactNode }) {
  const [navigationOpen, setNavigationOpen] = useState(false)

  return (
    <div className="rfz-admin-app min-h-screen bg-[var(--rfz-bg)] text-[var(--rfz-ink)]">
      <header className="rfz-admin-header sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="flex min-h-[73px] min-w-0 items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <button
                type="button"
                aria-label="Open admin navigation"
                aria-expanded={navigationOpen}
                onClick={() => setNavigationOpen(true)}
                className="rounded-lg border border-[#253451] p-2 text-slate-300 transition hover:border-cyan-300 hover:text-cyan-200 lg:hidden"
              >
                <Menu size={18} />
              </button>
              <img
                src={RFZ_PUBLIC_ASSETS.logo}
                alt="RunFazone"
                width={3772}
                height={840}
                className="h-auto max-h-9 w-auto max-w-[92px] object-contain sm:h-10 sm:max-h-none sm:max-w-none"
              />
              <div className="hidden sm:block">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">
                  Dashboard
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1 text-xs text-slate-400 sm:gap-3">
              <a
                href="/admin/orders"
                aria-label="Search and manage orders"
                className="hidden items-center gap-2 rounded-lg border border-[#253451] px-3 py-2 transition hover:border-cyan-300 hover:text-cyan-200 md:flex"
              >
                <Search size={13} /> <span>Orders</span>
              </a>
              <a
                href="/admin/notifications"
                aria-label="Open admin notifications"
                className="relative rounded-lg border border-[#253451] p-2 transition hover:border-cyan-300 hover:text-cyan-200"
              >
                <Bell size={14} />
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-cyan-300" aria-hidden="true" />
              </a>
              <a
                href="/"
                className="rounded-lg border border-[#253451] px-3 py-2 transition hover:border-cyan-300 hover:text-cyan-200"
              >
                <span className="hidden sm:inline">View Store</span>
                <span className="sm:hidden">Store</span>
              </a>
              <span className="hidden items-center gap-2 rounded-lg border border-[#253451] px-3 py-2 sm:flex">
                <Activity size={13} className="text-cyan-300" /> Admin
              </span>
              <button
                aria-label="Log out of admin dashboard"
                onClick={async () => {
                  const supabase = getSupabaseBrowserClient()
                  if (supabase) await supabase.auth.signOut()
                  window.location.href = '/secure-admin-login'
                }}
                className="flex items-center gap-2 rounded-lg border border-[#253451] px-3 py-2 transition hover:border-rose-400 hover:text-rose-200"
              >
                <LogOut size={13} /> <span className="hidden sm:inline">Log out</span>
              </button>
            </div>
        </div>
      </header>

      <div className="flex min-w-0">
        <AdminNavigation open={navigationOpen} onClose={() => setNavigationOpen(false)} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
