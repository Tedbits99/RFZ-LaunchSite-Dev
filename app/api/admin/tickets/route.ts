import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabaseAdmin'
import { requireAdminPermission } from '@/lib/adminGuard'

export const dynamic = 'force-dynamic'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'])
const PRIORITIES = new Set(['LOW', 'NORMAL', 'HIGH', 'URGENT'])

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'tickets.manage')
  if (!auth.ok) return auth.response
  if (!adminSupabase) return fail('Ticket management is unavailable in this environment.', 503)

  const id = new URL(req.url).searchParams.get('id')
  if (id !== null) {
    if (!UUID_PATTERN.test(id)) return fail('A valid ticket id is required.', 400)
    const { data: ticket, error } = await adminSupabase.from('support_tickets')
      .select('id,reference,email,subject,status,priority,created_at,updated_at')
      .eq('id', id).maybeSingle()
    if (error) return fail('Ticket details could not be loaded.', 503)
    if (!ticket) return fail('Ticket not found.', 404)
    const { data: messages, error: messagesError } = await adminSupabase.from('support_messages')
      .select('author,body,created_at').eq('ticket_id', id).order('created_at', { ascending: true }).limit(200)
    if (messagesError) return fail('Ticket messages could not be loaded.', 503)
    return NextResponse.json({ ticket, messages: messages || [] }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const { data, error } = await adminSupabase.from('support_tickets')
    .select('id,reference,email,subject,status,priority,created_at,updated_at')
    .order('updated_at', { ascending: false }).limit(100)
  if (error) return fail('Tickets could not be loaded.', 503)
  return NextResponse.json({ tickets: data || [] }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'tickets.manage')
  if (!auth.ok) return auth.response
  if (!adminSupabase) return fail('Ticket management is unavailable in this environment.', 503)

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || Array.isArray(body) || Object.keys(body).some((key) => !['id', 'status', 'priority'].includes(key))) {
    return fail('A valid ticket change object is required.', 400)
  }
  if (typeof body.id !== 'string' || !UUID_PATTERN.test(body.id)) return fail('A valid ticket id is required.', 400)
  const changes: Record<string, unknown> = { last_admin_actor_id: auth.session.userId }
  if (Object.hasOwn(body, 'status')) {
    if (typeof body.status !== 'string' || !STATUSES.has(body.status)) return fail('Unsupported ticket status.', 400)
    changes.status = body.status
  }
  if (Object.hasOwn(body, 'priority')) {
    if (typeof body.priority !== 'string' || !PRIORITIES.has(body.priority)) return fail('Unsupported ticket priority.', 400)
    changes.priority = body.priority
  }
  if (Object.keys(changes).length === 1) return fail('A status or priority change is required.', 400)

  const { data, error } = await adminSupabase.from('support_tickets')
    .update(changes).eq('id', body.id)
    .select('id,reference,email,subject,status,priority,created_at,updated_at').maybeSingle()
  if (error) return fail('Ticket could not be updated.', 500)
  if (!data) return fail('Ticket not found.', 404)
  return NextResponse.json({ ticket: data }, { headers: { 'Cache-Control': 'no-store' } })
}
