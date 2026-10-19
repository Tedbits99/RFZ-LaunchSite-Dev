import { cookies } from 'next/headers'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

type CookieToSet = { name: string; value: string; options: CookieOptions }

/**
 * Server-side Supabase client backed by the real Supabase Auth session cookies.
 * Used by route handlers and server components to read and refresh the session
 * that the built-in email/password auth established.
 *
 * `cookies()` throws an invariant when called outside a request scope (for
 * example during static analysis). We read the cookie store defensively so a
 * missing request context degrades to "no session" instead of crashing.
 */
export function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Supabase is not configured.')

  let cookieStore: ReturnType<typeof cookies> | null = null
  try {
    cookieStore = cookies()
  } catch {
    cookieStore = null
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        if (!cookieStore) return []
        try {
          return cookieStore.getAll()
        } catch {
          return []
        }
      },
      setAll(cookiesToSet: CookieToSet[]) {
        if (!cookieStore) return
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore!.set(name, value, options))
        } catch {
          // Server Component render, where cookies are read-only. Session refresh
          // is handled by middleware and the route handlers instead.
        }
      },
    },
  })
}
