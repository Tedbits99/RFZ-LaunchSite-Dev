import type { NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createAdminServerClient } from '@/lib/authSessionClients'
import { ADMIN_SESSION_COOKIE } from '@/lib/authSessionConfig'
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
    cookieOptions: { name: ADMIN_SESSION_COOKIE },
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

export async function getAdminPermissionSet(role: string): Promise<string[] | null> {
  if (role === 'SUPER_ADMIN') return ['*']
  if (!adminSupabase) return null
  const { data, error } = await adminSupabase
    .from('admin_role_permissions')
    .select('permission_key')
    .eq('role', role)
    .eq('is_enabled', true)
  if (error) return null
  return (data || []).map((row) => row.permission_key)
}

/** Server-rendered admin pages must check grants before reading via a service-role client. */
export async function hasAdminPagePermission(permission: string | string[]): Promise<boolean> {
  const session = await getAdminSession()
  if (!session) return false
  if (session.role === 'SUPER_ADMIN') return true
  const grants = await getAdminPermissionSet(session.role)
  if (!grants) return false
  const required = Array.isArray(permission) ? permission : [permission]
  return required.some((key) => grants.includes(key))
}

export async function requireAdminPermission(req: NextRequest, permission: string) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth
  if (auth.session.role === 'SUPER_ADMIN') return auth
  if (!adminSupabase) {
    return {
      ok: false as const,
      response: new Response(JSON.stringify({ error: 'Admin permission service is unavailable.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
    }
  }
  const { data, error } = await adminSupabase
    .from('admin_role_permissions')
    .select('is_enabled')
    .eq('role', auth.session.role)
    .eq('permission_key', permission)
    .maybeSingle()
  if (error) {
    return {
      ok: false as const,
      response: new Response(JSON.stringify({ error: 'Admin permission service is unavailable.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
    }
  }
  if (data?.is_enabled !== true) {
    return {
      ok: false as const,
      response: new Response(JSON.stringify({ error: 'Forbidden.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
    }
  }
  return auth
}
