'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Lock, Mail, ShieldCheck } from 'lucide-react'
import { createAdminBrowserClient } from '@/lib/authSessionBrowserClients'

async function verifyAdminSession() {
  const response = await fetch('/api/auth/admin-session', {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  return { ok: response.ok, status: response.status }
}

async function clearAdminSession(supabase: ReturnType<typeof createAdminBrowserClient>) {
  try {
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // A failed cleanup must not replace the safe generic login error.
  }
}

export default function SecureAdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    try {
      const supabase = createAdminBrowserClient()
      // Render the form immediately. Session discovery is an enhancement and
      // must never leave an administrator-facing route in an indefinite
      // loading state when Auth is unavailable or slow.
      setReady(true)
      void supabase.auth.getSession()
        .then(async ({ data, error }) => {
          if (!active) return
          if (data?.session) {
            try {
              const result = await verifyAdminSession()
              if (result.ok) router.replace('/admin')
              else if (active) setError(result.status === 403
                ? 'This account is not authorized for the admin console.'
                : 'Admin authentication is temporarily unavailable. You can retry signing in.')
            } catch {
              if (active) setError('Admin authentication is temporarily unavailable. You can retry signing in.')
            }
          } else if (error) {
            setError('We could not verify an existing admin session. Sign in to continue.')
          }
        })
        .catch(() => {
          if (active) setError('We could not verify an existing admin session. Sign in to continue.')
        })
    } catch {
      if (active) {
        setError('Admin authentication is temporarily unavailable. You can retry signing in.')
        setReady(true)
      }
    }
    return () => { active = false }
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    let supabase: ReturnType<typeof createAdminBrowserClient>
    try {
      supabase = createAdminBrowserClient()
    } catch {
      setError('Admin authentication is temporarily unavailable. Please try again.')
      setSubmitting(false)
      return
    }

    let signInError: { message?: string } | null = null
    try {
      ({ error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      }))
    } catch {
      setError('Admin authentication is temporarily unavailable. Please try again.')
      setSubmitting(false)
      return
    }

    if (signInError) {
      await clearAdminSession(supabase)
      setError('Invalid email or password.')
      setSubmitting(false)
      return
    }

    try {
      const result = await verifyAdminSession()
      if (!result.ok) {
        await clearAdminSession(supabase)
        setError(result.status === 403
          ? 'This account is not authorized for the admin console.'
          : 'Admin authentication is temporarily unavailable. Please try again.')
        setSubmitting(false)
        return
      }
      router.replace('/admin')
    } catch {
      await clearAdminSession(supabase)
      setError('Admin authentication is temporarily unavailable. Please try again.')
      setSubmitting(false)
    }
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

        <form className="space-y-3" method="post" action="/api/auth/admin-login" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Email</span>
            <div className="flex items-center gap-2 rounded-lg border border-[#22314d] bg-[#0a1124] px-3">
              <Mail size={15} className="text-slate-500" />
              <input
                type="email"
                name="email"
                autoComplete="username"
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
                name="password"
                autoComplete="current-password"
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
          <p className="text-center text-xs text-slate-400">
            Forgot your admin password?{' '}
            <Link href="/forgot-password" className="text-cyan-300 underline-offset-2 hover:underline">
              Reset it securely
            </Link>
          </p>
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
