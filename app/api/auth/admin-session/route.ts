import { NextResponse } from 'next/server'
import { resolveAdminSession } from '@/lib/adminGuard'

export const dynamic = 'force-dynamic'

function json(body: Record<string, boolean | string>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function GET() {
  const result = await resolveAdminSession()
  if (result.ok) return json({ authorized: true })
  if (result.reason === 'unavailable') {
    return json({ authorized: false, error: 'Admin authentication is temporarily unavailable.' }, 503)
  }
  return json({ authorized: false, error: 'This account is not authorized for the admin console.' }, result.reason === 'forbidden' ? 403 : 401)
}
