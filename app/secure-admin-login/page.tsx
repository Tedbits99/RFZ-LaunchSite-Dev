'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, ShieldCheck } from 'lucide-react'
import { createAdminBrowserClient } from '@/lib/authSessionBrowserClients'
import ThemeSelector from '@/components/ThemeSelector'
import PasswordInput from '@/components/PasswordInput'

export default function SecureAdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let supabase
    try {
      supabase = createAdminBrowserClient()
    } catch {
      setReady(true)
      return
    }
    supabase.auth.getSession().then(({ data }: { data: { session: unknown | null } }) => {
      if (data?.session) {
        router.replace('/admin')
      } else {
        setReady(true)
      }
    }).catch(() => setReady(true))
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    let supabase
    try {
      supabase = createAdminBrowserClient()
    } catch {
      setError('Database is not configured.')
      setSubmitting(false)
      return
    }

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError || !signInData.user) {
      setError(signInError?.message === 'Invalid login credentials' ? 'Invalid email or password.' : signInError?.message || 'Invalid email or password.')
      setSubmitting(false)
      return
    }

    const { data: admin, error: adminError } = await supabase
      .from('admins')
      .select('id, is_active, role')
      .eq('id', signInData.user.id)
      .maybeSingle()
    if (adminError || !admin || !admin.is_active || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) {
      await supabase.auth.signOut({ scope: 'local' })
      setError('Invalid email or password.')
      setSubmitting(false)
      return
    }

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
    <main className="grid min-h-screen w-full min-w-0 place-items-center bg-[#030718] px-5 text-slate-100">
      <div className="w-full min-w-0 max-w-sm rounded-2xl border border-[#1b2a45] bg-[#0b1225] p-8">
        <div className="mb-5 flex justify-end"><ThemeSelector /></div>
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
          <PasswordInput label="Password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={submitting} autoComplete="current-password" />
          <div className="text-right"><a href="/forgot-password" className="text-xs text-cyan-300 hover:underline">Forgot your admin password?</a></div>

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
