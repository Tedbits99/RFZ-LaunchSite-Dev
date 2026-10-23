import type { NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createAdminServerClient } from '@/lib/authSessionClients'
import { sessionCookieName } from '@/lib/authSessionConfig'
import { adminSupabase } from '@/lib/supabaseAdmin'

export type AdminSession = {
  userId: string
  email: string
  name: string
  role: string
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const supabase = await createAdminServerClient()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) {
    return null
  }

  let name = ''
  let role = 'ADMIN'

  // Try to enrich with admins table data. Use service-role client if available,
  // otherwise fall back to the cookie-authenticated server client.
  const client = adminSupabase || supabase
  const { data: admin } = await client
    .from('admins')
    .select('email, name, role, is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (admin?.is_active) {
    name = admin.name || ''
    role = admin.role || 'ADMIN'
  } else {
    return null
  }

  return {
    userId: user.id,
    email: user.email || '',
    name,
    role,
  }
}

function createRequestClient(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Supabase is not configured.')
  return createServerClient(url, anonKey, {
    cookieOptions: { name: sessionCookieName('admin') },
    cookieEncoding: 'base64url',
    cookies: {
      getAll() {
        return req.cookies.getAll().map(({ name, value }: { name: string; value: string }) => ({ name, value }))
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        // Mirror refreshed cookies back onto the request so the same
        // request's DB calls see the renewed session (middleware refresh
        // alone only updates the response, not this request's read).
        cookiesToSet.forEach(({ name, value }: { name: string; value: string }) => req.cookies.set(name, value))
      },
    },
  })
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function requireAdmin(
  req: NextRequest,
): Promise<{ ok: true; session: AdminSession; client: Awaited<ReturnType<typeof createAdminServerClient>> } | { ok: false; response: Response }> {
  let supabase: Awaited<ReturnType<typeof createAdminServerClient>>
  try {
    supabase = createRequestClient(req)
  } catch {
    return { ok: false, response: jsonError(401, 'Unauthorized.') }
  }

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()
    if (error || !user) {
      return { ok: false, response: jsonError(401, 'Unauthorized.') }
    }

    let name = ''
    let role = 'ADMIN'

    const client = adminSupabase || supabase
    const { data: admin } = await client
      .from('admins')
      .select('email, name, role, is_active')
      .eq('id', user.id)
      .maybeSingle()
    if (!admin || !admin.is_active) {
      return { ok: false, response: jsonError(403, 'Forbidden.') }
    }

    name = admin.name || ''
    role = admin.role || 'ADMIN'

    return {
      ok: true,
      client: supabase,
      session: {
        userId: user.id,
        email: user.email || '',
        name,
        role,
      },
    }
  } catch {
    return { ok: false, response: jsonError(500, 'Authentication check failed.') }
  }
}

export function hasRole(session: AdminSession, ...roles: string[]): boolean {
  return roles.includes(session.role)
}
