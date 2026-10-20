import type { NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createSupabaseServerClient } from '@/lib/supabaseServer'
import { adminSupabase } from '@/lib/supabaseAdmin'
import { notFound } from 'next/navigation'

export type AdminSession = {
  userId: string
  email: string
  name: string
  role: string
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) {
    return null
  }

  let name = ''
  let role = ''

  // Try to enrich with admins table data. Use service-role client if available,
  // otherwise fall back to the cookie-authenticated server client.
  const client = adminSupabase || supabase
  const { data: admin, error: adminError } = await client
    .from('admins')
    .select('email, name, role, is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (!adminError && admin?.is_active === true && ['STAFF', 'ADMIN', 'SUPER_ADMIN'].includes(admin.role)) {
    name = admin.name || ''
    role = admin.role
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

/**
 * Guard privileged server-page data reads at the page boundary as well as in
 * the shared admin layout. App Router may render route segments concurrently,
 * so a parent layout alone must not be the only check before service-role IO.
 */
export async function requireAdminPageSession(...allowedRoles: string[]): Promise<AdminSession> {
  const session = await getAdminSession()
  if (!session || (allowedRoles.length > 0 && !allowedRoles.includes(session.role))) notFound()
  return session
}

function createRequestClient(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Supabase is not configured.')
  return createServerClient(url, anonKey, {
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
  allowedRoles?: readonly string[],
): Promise<{ ok: true; session: AdminSession; client: Awaited<ReturnType<typeof createSupabaseServerClient>> } | { ok: false; response: Response }> {
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
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
    let role = ''

    const client = adminSupabase || supabase
    const { data: admin, error: adminError } = await client
      .from('admins')
      .select('email, name, role, is_active')
      .eq('id', user.id)
      .maybeSingle()
    if (adminError || !admin || admin.is_active !== true || !['STAFF', 'ADMIN', 'SUPER_ADMIN'].includes(admin.role)) {
      return { ok: false, response: jsonError(403, 'Forbidden.') }
    }

    name = admin.name || ''
    role = admin.role
    if (allowedRoles && !allowedRoles.includes(role)) {
      return { ok: false, response: jsonError(403, 'Forbidden.') }
    }

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
