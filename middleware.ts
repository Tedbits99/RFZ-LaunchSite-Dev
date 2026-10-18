import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { AUTH_SESSION_COOKIES } from '@/lib/authSessionConfig'

type SessionCookie = { name: string; value: string; options: CookieOptions }

function defaultStorageKeyFromUrl(url: string): string | null {
  try {
    return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
  } catch {
    return null
  }
}

function hasAnyCookie(req: NextRequest, name: string): boolean {
  return (
    req.cookies.has(name) ||
    req.cookies.has(`${name}.0`) ||
    req.cookies.has(`${name}.1`) ||
    req.cookies.has(`${name}.2`) ||
    req.cookies.has(`${name}.3`) ||
    req.cookies.has(`${name}.4`)
  )
}

function createNamespaceClient(
  url: string,
  anonKey: string,
  storageKey: string,
  req: NextRequest,
  requestCookieChanges: SessionCookie[],
) {
  return createServerClient(url, anonKey, {
    cookieOptions: { name: storageKey },
    cookieEncoding: 'base64url',
    cookies: {
      getAll() {
        return req.cookies.getAll()
      },
      setAll(cookiesToSet: SessionCookie[]) {
        // Record changes per namespace so a later namespace refresh can never
        // overwrite an earlier one's cookies when the request store is replayed.
        requestCookieChanges.push(...cookiesToSet)
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
      },
    },
  })
}

export async function middleware(req: NextRequest) {
  // Must pass { request } so refreshed auth cookies are visible to the
  // route handler / server component within the SAME request cycle.
  // Without this, a token refreshed by middleware reaches the browser but
  // the current request still carries the stale one, causing spurious
  // 401 "Unauthorized." in requireAdmin().
  let res = NextResponse.next({ request: req })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return res

  const defaultKey = defaultStorageKeyFromUrl(url)

  // One namespace-specific client per known session cookie. Each only refreshes
  // when its own session (including chunked cookies) is present, so unrelated
  // sessions are never touched and no needless Auth calls are made.
  const namespaces: string[] = [AUTH_SESSION_COOKIES.customer, AUTH_SESSION_COOKIES.admin]
  if (defaultKey) namespaces.unshift(defaultKey)

  const requestCookieChanges: SessionCookie[] = []
  for (const storageKey of namespaces) {
    if (!hasAnyCookie(req, storageKey)) continue
    const supabase = createNamespaceClient(url, anonKey, storageKey, req, requestCookieChanges)
    try {
      await supabase.auth.getUser()
    } catch {
      // A failed refresh must never break the request or the other
      // namespaces: the existing cookies are left untouched and each
      // namespace's own client remains authoritative for its session.
    }
  }

  for (const { name, value, options } of requestCookieChanges) {
    res.cookies.set(name, value, options)
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
