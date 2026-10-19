'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Mail, ShieldCheck } from 'lucide-react'
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser'

export default function SecureAdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    if (!supabase) { setReady(true); return }
    supabase.auth.getSession().then(({ data }: { data: { session: unknown | null } }) => {
      if (data?.session) {
        router.replace('/admin')
      } else {
        setReady(true)
      }
    })
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      setError('Database is not configured.')
      setSubmitting(false)
      return
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'Invalid email or password.'
          : signInError.message,
      )
      setSubmitting(false)
      return
    }

    try { await supabase.rpc('claim_first_admin') } catch {}

    router.push('/admin')
  }

  if (!ready) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#030718]">
        <p className="text-sm text-slate-500">Loading...</p>
      </main>
    )
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#030718] px-5 text-slate-100">
      <div className="w-full max-w-sm rounded-2xl border border-[#1b2a45] bg-[#0b1225] p-8">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 text-white">
            <ShieldCheck size={24} />
          </span>
          <h1 className="font-display text-2xl font-bold">Admin sign in</h1>
          <p className="mt-1 text-sm text-slate-400">
            Sign in to manage RunFazone.
          </p>
        </div>

        <form className="space-y-3" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Email</span>
            <div className="flex items-center gap-2 rounded-lg border border-[#22314d] bg-[#0a1124] px-3">
              <Mail size={15} className="text-slate-500" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={submitting}
                className="w-full bg-transparent py-2.5 text-sm outline-none"
              />
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Password</span>
            <div className="flex items-center gap-2 rounded-lg border border-[#22314d] bg-[#0a1124] px-3">
              <Lock size={15} className="text-slate-500" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={submitting}
                className="w-full bg-transparent py-2.5 text-sm outline-none"
              />
            </div>
          </label>

          <button
            disabled={submitting}
            className="w-full rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 py-3 text-sm font-semibold transition hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Signing in\u2026' : 'Sign In'}
          </button>
        </form>

        {error && (
          <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-center text-sm text-rose-200">
            {error}
          </p>
        )}
      </div>
    </main>
  )
}
