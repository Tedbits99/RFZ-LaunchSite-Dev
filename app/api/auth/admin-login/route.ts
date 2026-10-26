import { NextRequest, NextResponse } from 'next/server'
import { createAdminServerClient } from '@/lib/authSessionClients'
import { getConfiguredAppOrigin } from '@/lib/authRedirect'
import { isAuthorizedAdminIdentity } from '@/lib/adminGuard'

const invalidCredentials = 'Invalid email or password.'
const unauthorizedAdmin = 'This account is not authorized for the admin console.'

export const dynamic = 'force-dynamic'

function json(body: Record<string, string>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function nativeFormSuccess(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/admin', request.url), 303)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function nativeFormFailure(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/secure-admin-login?reason=forbidden', request.url), 303)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

async function readLoginInput(request: NextRequest): Promise<{ input: unknown; nativeForm: boolean }> {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return { input: await request.json(), nativeForm: false }
  }

  const form = await request.formData()
  return {
    input: { email: form.get('email'), password: form.get('password') },
    nativeForm: true,
  }
}

function hasTrustedOrigin(request: NextRequest): boolean {
  const origin = getConfiguredAppOrigin()
  return Boolean(origin && request.headers.get('origin') === origin)
}

export async function POST(request: NextRequest) {
  if (!hasTrustedOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403)

  let body: unknown
  let nativeForm = false
  try {
    const parsed = await readLoginInput(request)
    body = parsed.input
    nativeForm = parsed.nativeForm
  } catch {
    return json({ error: invalidCredentials }, 400)
  }

  const values = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
  const email = typeof values.email === 'string' ? values.email.trim().toLowerCase() : ''
  const password = typeof values.password === 'string' ? values.password : ''
  if (!email || !password) return json({ error: invalidCredentials }, 401)

  let supabase: Awaited<ReturnType<typeof createAdminServerClient>>
  try {
    supabase = await createAdminServerClient()
  } catch {
    return json({ error: 'Admin authentication is temporarily unavailable.' }, 503)
  }

  try {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      await supabase.auth.signOut({ scope: 'local' })
      return json({ error: invalidCredentials }, 401)
    }

    const { data: userData, error: userError } = await supabase.auth.getUser()
    const user = userData.user
    if (userError || !user) {
      await supabase.auth.signOut({ scope: 'local' })
      return json({ error: invalidCredentials }, 401)
    }

    const { data: admin, error: adminError } = await supabase
      .from('admins')
      .select('email, name, role, is_active')
      .eq('id', user.id)
      .maybeSingle()

    if (adminError) {
      await supabase.auth.signOut({ scope: 'local' })
      return json({ error: 'Admin authentication is temporarily unavailable.' }, 503)
    }
    if (!isAuthorizedAdminIdentity(user, admin)) {
      await supabase.auth.signOut({ scope: 'local' })
      return nativeForm ? nativeFormFailure(request) : json({ error: unauthorizedAdmin }, 403)
    }

    return nativeForm ? nativeFormSuccess(request) : json({ message: 'Signed in.' }, 200)
  } catch {
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
      // Keep provider/network details out of the response.
    }
    return json({ error: 'Admin authentication is temporarily unavailable.' }, 503)
  }
}

export async function GET() {
  return json({ error: 'Method not allowed.' }, 405)
}
