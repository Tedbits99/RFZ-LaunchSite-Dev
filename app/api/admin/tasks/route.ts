import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabaseAdmin'
import { requireAdminPermission } from '@/lib/adminGuard'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STATUSES = new Set(['TODO', 'IN_PROGRESS', 'DONE'])
const PRIORITIES = new Set(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
type TaskFieldsResult = { ok: true; values: Record<string, unknown> } | { ok: false; error: string }

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'tasks.manage')
  if (!auth.ok) return auth.response
  if (!adminSupabase) return errorResponse('Task management is unavailable in this environment.', 503)

  const includeArchived = new URL(req.url).searchParams.get('archived') === 'true'
  let query = adminSupabase.from('admin_tasks')
    .select('id,title,description,assigned_to_id,priority,status,due_date,created_by,updated_by,created_at,updated_at,archived_at')
    .order('created_at', { ascending: false })
    .limit(200)
  if (!includeArchived) query = query.is('archived_at', null)
  const { data, error } = await query
  if (error) return errorResponse('Tasks could not be loaded.', 503)

  const { data: admins, error: adminsError } = await adminSupabase
    .from('admins').select('id,name,email,is_active').eq('is_active', true).order('name')
  if (adminsError) return errorResponse('Task assignees could not be loaded.', 503)
  const adminById = new Map((admins || []).map((admin) => [admin.id, admin]))
  const tasks = (data || []).map((task) => ({
    ...task,
    assignee: task.assigned_to_id ? adminById.get(task.assigned_to_id) || null : null,
  }))
  return NextResponse.json({ tasks, assignees: admins || [], total: tasks.length, archivedIncluded: includeArchived }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'tasks.manage')
  if (!auth.ok) return auth.response
  if (!adminSupabase) return errorResponse('Task management is unavailable in this environment.', 503)
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || Array.isArray(body)) return errorResponse('A valid JSON object is required.', 400)
  const parsed = parseTaskFields(body, false)
  if (!parsed.ok) return errorResponse(parsed.error, 400)
  const values = parsed.values
  if (values.assigned_to_id) {
    const validAssignee = await isActiveAdmin(values.assigned_to_id as string)
    if (validAssignee === null) return errorResponse('Task assignee could not be verified.', 503)
    if (!validAssignee) return errorResponse('Task assignee must be an active admin account.', 400)
  }
  const { data, error } = await adminSupabase.from('admin_tasks').insert({
    ...values,
    created_by: auth.session.userId,
    updated_by: auth.session.userId,
  }).select('id,title,description,assigned_to_id,priority,status,due_date,created_by,updated_by,created_at,updated_at,archived_at').single()
  if (error) return errorResponse('Task could not be created.', 500)
  return NextResponse.json({ task: data }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'tasks.manage')
  if (!auth.ok) return auth.response
  if (!adminSupabase) return errorResponse('Task management is unavailable in this environment.', 503)
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || Array.isArray(body) || typeof body.id !== 'string' || !UUID_PATTERN.test(body.id)) {
    return errorResponse('A valid task id is required.', 400)
  }
  const parsed = parseTaskFields(body, true)
  if (!parsed.ok) return errorResponse(parsed.error, 400)
  const values = parsed.values
  if (!Object.keys(values).length) return errorResponse('No supported task changes were supplied.', 400)
  if (values.assigned_to_id) {
    const validAssignee = await isActiveAdmin(values.assigned_to_id as string)
    if (validAssignee === null) return errorResponse('Task assignee could not be verified.', 503)
    if (!validAssignee) return errorResponse('Task assignee must be an active admin account.', 400)
  }
  let updateQuery = adminSupabase.from('admin_tasks')
    .update({ ...values, updated_by: auth.session.userId })
    .eq('id', body.id)
  updateQuery = body.isArchived === false
    ? updateQuery.not('archived_at', 'is', null)
    : updateQuery.is('archived_at', null)
  const { data, error } = await updateQuery
    .select('id,title,description,assigned_to_id,priority,status,due_date,created_by,updated_by,created_at,updated_at,archived_at')
    .maybeSingle()
  if (error) return errorResponse('Task could not be updated.', 500)
  if (!data) return errorResponse('Task not found or already archived.', 404)
  return NextResponse.json({ task: data }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'tasks.manage')
  if (!auth.ok) return auth.response
  if (!adminSupabase) return errorResponse('Task management is unavailable in this environment.', 503)
  const id = new URL(req.url).searchParams.get('id')
  if (!id || !UUID_PATTERN.test(id)) return errorResponse('A valid task id is required.', 400)
  const archivedAt = new Date().toISOString()
  const { data, error } = await adminSupabase.from('admin_tasks')
    .update({ archived_at: archivedAt, updated_by: auth.session.userId })
    .eq('id', id)
    .is('archived_at', null)
    .select('id,archived_at')
    .maybeSingle()
  if (error) return errorResponse('Task could not be archived.', 500)
  if (!data) return errorResponse('Task not found or already archived.', 404)
  return NextResponse.json({ ok: true, id: data.id, archived_at: data.archived_at }, { headers: { 'Cache-Control': 'no-store' } })
}

function parseTaskFields(body: Record<string, unknown>, partial: boolean): TaskFieldsResult {
  const allowed = new Set(['id', 'title', 'description', 'assignedToId', 'priority', 'status', 'dueDate', 'isArchived'])
  if (Object.keys(body).some((key) => !allowed.has(key))) return { ok: false, error: 'Unsupported task fields were supplied.' }
  const values: Record<string, unknown> = {}
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'title')) {
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title || title.length > 160) return { ok: false, error: 'Title must be 1 to 160 characters.' }
    values.title = title
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'description')) {
    if (body.description !== undefined && typeof body.description !== 'string') return { ok: false, error: 'Description must be text.' }
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    if (description.length > 4000) return { ok: false, error: 'Description must be no more than 4000 characters.' }
    values.description = description
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'assignedToId')) {
    const assignee = body.assignedToId
    if (assignee !== null && assignee !== undefined && (typeof assignee !== 'string' || !UUID_PATTERN.test(assignee))) {
      return { ok: false, error: 'Assignee must be an active admin id or null.' }
    }
    values.assigned_to_id = assignee || null
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'priority')) {
    const priority = partial && body.priority === undefined ? 'NORMAL' : body.priority
    if (typeof priority !== 'string' || !PRIORITIES.has(priority)) return { ok: false, error: 'Unsupported task priority.' }
    values.priority = priority
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = partial && body.status === undefined ? 'TODO' : body.status
    if (typeof status !== 'string' || !STATUSES.has(status)) return { ok: false, error: 'Unsupported task status.' }
    values.status = status
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'dueDate')) {
    const dueDate = body.dueDate
    if (dueDate !== null && dueDate !== undefined && (typeof dueDate !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(dueDate) || new Date(dueDate + 'T00:00:00.000Z').toISOString().slice(0, 10) !== dueDate)) {
      return { ok: false, error: 'Due date must be a valid YYYY-MM-DD date or empty.' }
    }
    values.due_date = dueDate || null
  }
  if (Object.prototype.hasOwnProperty.call(body, 'isArchived')) {
    if (typeof body.isArchived !== 'boolean') return { ok: false, error: 'isArchived must be a boolean.' }
    values.archived_at = body.isArchived ? new Date().toISOString() : null
  }
  return { ok: true, values }
}

async function isActiveAdmin(id: string): Promise<boolean | null> {
  if (!adminSupabase) return null
  const { data, error } = await adminSupabase.from('admins').select('id').eq('id', id).eq('is_active', true).maybeSingle()
  if (error) return null
  return Boolean(data)
}
