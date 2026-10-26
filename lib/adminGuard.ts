import type { NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createAdminServerClient } from '@/lib/authSessionClients'
import { sessionCookieName } from '@/lib/authSessionConfig'

export type AdminSession = {
  userId: string
  email: string
  name: string
  role: string
}

export type AdminSessionResult =
  | { ok: true; session: AdminSession }
  | { ok: false; reason: 'unauthenticated' | 'forbidden' | 'unavailable' }

const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN'])

type AdminIdentity = {
  email?: string | null
  name?: string | null
  role?: string | null
  is_active?: boolean | null
}

type AuthIdentity = {
  id: string
  email?: string | null
}

type AuthorizedAdminIdentity = AdminIdentity & {
  email: string
  name?: string | null
  role: string
  is_active: true
}

/**
 * The Auth identity and the application admin record are a deliberate
 * two-part authorization decision. Matching the UUID prevents an arbitrary
 * account from inheriting a role; matching the normalized email catches stale
 * or manually-corrupted admin records before they authorize an operator.
 */
export function isAuthorizedAdminIdentity(
  user: AuthIdentity,
  admin: AdminIdentity | null | undefined,
): admin is AuthorizedAdminIdentity {
  const authEmail = user.email?.trim().toLowerCase()
  const adminEmail = admin?.email?.trim().toLowerCase()
  return Boolean(
    admin?.is_active
      && ADMIN_ROLES.has(admin.role || '')
      && authEmail
      && adminEmail
      && authEmail === adminEmail,
  )
}

function authFailureReason(message?: string): 'unauthenticated' | 'unavailable' {
  const normalized = (message || '').toLowerCase()
  return /auth session missing|invalid jwt|invalid token|jwt expired|session not found|not authenticated/.test(normalized)
    ? 'unauthenticated'
    : 'unavailable'
}

async function resolveAdminSessionWithClient(
  supabase: Awaited<ReturnType<typeof createAdminServerClient>>,
): Promise<AdminSessionResult> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error) return { ok: false, reason: authFailureReason(error.message) }
  if (!user) return { ok: false, reason: 'unauthenticated' }

  const { data: admin, error: adminError } = await supabase
    .from('admins')
    .select('email, name, role, is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (adminError) return { ok: false, reason: 'unavailable' }
  if (!isAuthorizedAdminIdentity(user, admin)) {
    return { ok: false, reason: 'forbidden' }
  }

  return {
    ok: true,
    session: {
      userId: user.id,
      email: user.email || '',
      name: admin.name || '',
      role: admin.role,
    },
  }
}

export async function resolveAdminSession(): Promise<AdminSessionResult> {
  let supabase: Awaited<ReturnType<typeof createAdminServerClient>>
  try {
    supabase = await createAdminServerClient()
  } catch {
    return { ok: false, reason: 'unavailable' }
  }

  try {
    return await resolveAdminSessionWithClient(supabase)
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const result = await resolveAdminSession()
  return result.ok ? result.session : null
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
    if (error) {
      const reason = authFailureReason(error.message)
      return { ok: false, response: jsonError(reason === 'unauthenticated' ? 401 : 503, reason === 'unauthenticated' ? 'Unauthorized.' : 'Authentication service temporarily unavailable.') }
    }
    if (!user) return { ok: false, response: jsonError(401, 'Unauthorized.') }

    const { data: admin, error: adminError } = await supabase
      .from('admins')
      .select('email, name, role, is_active')
      .eq('id', user.id)
      .maybeSingle()
    if (adminError) {
      return { ok: false, response: jsonError(503, 'Authentication service temporarily unavailable.') }
    }
    if (!isAuthorizedAdminIdentity(user, admin)) {
      return { ok: false, response: jsonError(403, 'Forbidden.') }
    }

    return {
      ok: true,
      client: supabase,
      session: {
        userId: user.id,
        email: user.email || '',
        name: admin.name || '',
        role: admin.role,
      },
    }
  } catch {
    return { ok: false, response: jsonError(500, 'Authentication check failed.') }
  }
}

export function hasRole(session: AdminSession, ...roles: string[]): boolean {
  return roles.includes(session.role)
}
