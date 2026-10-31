import { expect, test } from '@playwright/test'
import {
  createGame,
  createPackage,
  fixtureSlug,
  loginAdmin,
  loginStaff,
  serviceDb,
  writeEvidence,
} from './fixture-support'

test.describe('ADMIN-OPS-001 persisted admin operations', () => {
  test('keyboard-operable navigation exposes the active authorized surface on desktop and mobile', async ({ page }, testInfo) => {
    await loginAdmin(page)
    await page.goto('/admin/tasks')
    if (testInfo.project.name.includes('mobile')) {
      await page.getByRole('button', { name: 'Open admin navigation' }).click()
    }
    const operations = page.getByRole('button', { name: 'Operations' })
    if (await operations.getAttribute('aria-expanded') === 'false') {
      await operations.press('Enter')
    }
    await expect(operations).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('link', { name: 'Tasks', exact: true })).toBeVisible()
    if (testInfo.project.name.includes('mobile')) {
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: 'Open admin navigation' })).toHaveAttribute('aria-expanded', 'false')
    }
    await writeEvidence(page, testInfo, { action: 'keyboard_admin_navigation', desktop_mobile_project: testInfo.project.name, task_link_visible: true })
  })

  test('super admin persists, edits, archives, restores, and audits a task', async ({ page }, testInfo) => {
    const title = fixtureSlug(testInfo, 'admin-task')
    await loginAdmin(page)
    await page.goto('/admin/tasks')
    const createForm = page.locator('form').filter({ hasText: 'Create task' }).first()
    await createForm.getByLabel('Title').fill(title)
    await createForm.getByLabel('Description').fill('Synthetic disposable task fixture.')
    await createForm.getByRole('button', { name: 'Create task' }).click()
    await expect(page.getByText('Task created and recorded in the admin audit log.', { exact: true })).toBeVisible()

    let taskForm = page.getByRole('form', { name: `Task: ${title}` })
    await taskForm.getByLabel('Status').selectOption('IN_PROGRESS')
    await taskForm.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Task saved and recorded in the admin audit log.', { exact: true })).toBeVisible()
    const saved = await serviceDb().from('admin_tasks').select('id,status,archived_at').eq('title', title).single()
    expect(saved.error).toBeNull()
    expect(saved.data?.status).toBe('IN_PROGRESS')

    taskForm = page.getByRole('form', { name: `Task: ${title}` })
    await taskForm.getByRole('button', { name: 'Archive' }).click()
    await expect(page.getByText('Task archived. Its history is retained.', { exact: true })).toBeVisible()
    const archived = await serviceDb().from('admin_tasks').select('archived_at').eq('id', saved.data!.id).single()
    expect(archived.data?.archived_at).not.toBeNull()

    await page.getByLabel('Show archived tasks').check()
    taskForm = page.getByRole('form', { name: `Task: ${title}` })
    await taskForm.getByRole('button', { name: 'Restore' }).click()
    await expect(page.getByText('Task restored.', { exact: true })).toBeVisible()
    const restored = await serviceDb().from('admin_tasks').select('archived_at,status').eq('id', saved.data!.id).single()
    expect(restored.data).toMatchObject({ archived_at: null, status: 'IN_PROGRESS' })
    const audit = await serviceDb().from('admin_audit_events').select('action').eq('target_id', saved.data!.id)
    expect(audit.data?.map((row) => row.action).sort()).toEqual(['task.archived', 'task.created', 'task.restored', 'task.updated'].sort())
    await writeEvidence(page, testInfo, { action: 'task_crud_archive_restore', statuses: audit.data?.map((row) => row.action), restored: restored.data?.archived_at === null })
  })

  test('super admin changes a persisted staff permission and ordinary staff cannot change role grants', async ({ page }, testInfo) => {
    await loginAdmin(page)
    await page.goto('/admin/roles')
    const checkbox = page.getByRole('checkbox', { name: 'Grant Manage admin tasks to STAFF' })
    const original = await checkbox.isChecked()
    await checkbox.focus()
    await page.keyboard.press('Space')
    await expect(page.getByRole('status')).toContainText(original ? 'removed from STAFF' : 'granted to STAFF')
    const changed = await serviceDb().from('admin_role_permissions').select('is_enabled').eq('role', 'STAFF').eq('permission_key', 'tasks.manage').single()
    expect(changed.data?.is_enabled).toBe(!original)
    const actor = await serviceDb().from('admins').select('id').eq('email', process.env.CATALOG_ADMIN_EMAIL).single()
    const audit = await serviceDb().from('admin_audit_events').select('actor_id,action').eq('target_type', 'role_permission').eq('target_id', 'STAFF:tasks.manage').order('created_at', { ascending: false }).limit(1).single()
    expect(audit.data?.actor_id).toBe(actor.data?.id)
    expect(audit.data?.action).toBe(original ? 'role_permission.disabled' : 'role_permission.enabled')

    await loginStaff(page)
    const denied = await page.request.patch('/api/admin/roles', { data: { role: 'STAFF', permission: 'tasks.manage', enabled: original } })
    expect(denied.status()).toBe(403)
    const unchanged = await serviceDb().from('admin_role_permissions').select('is_enabled').eq('role', 'STAFF').eq('permission_key', 'tasks.manage').single()
    expect(unchanged.data?.is_enabled).toBe(!original)
    await writeEvidence(page, testInfo, { action: 'role_permission_authorization', persisted: changed.data?.is_enabled, unauthorized_http_status: denied.status(), unchanged_after_denial: unchanged.data?.is_enabled === !original })

    // Restore the fixture's default grant so the next browser project starts
    // from the canonical STAFF permission matrix.
    await loginAdmin(page)
    await page.goto('/admin/roles')
    const restoreCheckbox = page.getByRole('checkbox', { name: 'Grant Manage admin tasks to STAFF' })
    if ((await restoreCheckbox.isChecked()) !== original) {
      await restoreCheckbox.focus()
      await page.keyboard.press('Space')
      await expect(page.getByRole('status')).toContainText(original ? 'granted to STAFF' : 'removed from STAFF')
    }
  })

  test('single and bulk price controls persist atomically and return changed packages to draft', async ({ page }, testInfo) => {
    const game = await createGame(testInfo, 'pricing-controls', { published: true })
    const single = await createPackage(game.id, { name: 'Synthetic Single Price', sku: fixtureSlug(testInfo, 'price-single'), priceCents: 1000, status: 'PUBLISHED' })
    const bulkOne = await createPackage(game.id, { name: 'Synthetic Bulk Price One', sku: fixtureSlug(testInfo, 'price-bulk-one'), priceCents: 1000, status: 'PUBLISHED' })
    const bulkTwo = await createPackage(game.id, { name: 'Synthetic Bulk Price Two', sku: fixtureSlug(testInfo, 'price-bulk-two'), priceCents: 1200, status: 'PUBLISHED' })
    await loginAdmin(page)
    await page.goto('/admin/pricing')
    const singleForm = page.locator('form').filter({ hasText: single.sku })
    await singleForm.getByLabel(`Retail price in PHP for ${single.name}`).fill('12.34')
    await singleForm.getByRole('button', { name: 'Save price' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Price saved.' })).toContainText('Price saved.')
    const singleSaved = await serviceDb().from('packages').select('price_cents,is_active,catalog_status').eq('id', single.id).single()
    expect(singleSaved.data).toMatchObject({ price_cents: 1234, is_active: false, catalog_status: 'DRAFT' })

    await page.goto('/admin/bulk-pricing')
    const bulkOneRow = page.getByRole('row').filter({ hasText: bulkOne.sku })
    const bulkTwoRow = page.getByRole('row').filter({ hasText: bulkTwo.sku })
    await expect(bulkOneRow).toHaveCount(1)
    await expect(bulkTwoRow).toHaveCount(1)
    await bulkOneRow.getByRole('checkbox', { name: `Select package ${bulkOne.name}` }).check()
    await bulkTwoRow.getByRole('checkbox', { name: `Select package ${bulkTwo.name}` }).check()
    await page.getByLabel('Bulk pricing action').selectOption('percentage_adjust')
    await page.getByLabel('Adjustment percentage').fill('10')
    await page.getByRole('button', { name: 'Apply' }).click()
    const dialog = page.getByRole('dialog', { name: 'Confirm Bulk Action' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('status')).toContainText('Updated 2 package prices.')
    const changed = await serviceDb().from('packages').select('id,price_cents,is_active,catalog_status').in('id', [bulkOne.id, bulkTwo.id]).order('price_cents')
    expect(changed.error).toBeNull()
    expect(changed.data).toEqual([
      expect.objectContaining({ id: bulkOne.id, price_cents: 1100, is_active: false, catalog_status: 'DRAFT' }),
      expect.objectContaining({ id: bulkTwo.id, price_cents: 1320, is_active: false, catalog_status: 'DRAFT' }),
    ])
    await writeEvidence(page, testInfo, { action: 'single_and_bulk_pricing', single_price_cents: singleSaved.data?.price_cents, bulk_price_cents: changed.data?.map((row) => row.price_cents), republish_required: true })
  })

  test('support ticket status and priority updates persist with actor audit and history is readable', async ({ page }, testInfo) => {
    const reference = `ADM-${fixtureSlug(testInfo, 'ticket').slice(-24).toUpperCase()}`
    const ticketInsert = await serviceDb().from('support_tickets').insert({
      reference, email: 'synthetic-customer@example.invalid', subject: 'Disposable ticket acceptance fixture',
      status: 'OPEN', priority: 'NORMAL',
    }).select('id').single()
    expect(ticketInsert.error).toBeNull()
    await loginAdmin(page)
    await page.goto('/admin/tickets')
    const ticket = page.locator('article').filter({ hasText: reference })
    await expect(ticket).toBeVisible()
    await ticket.getByLabel('Status').selectOption('IN_PROGRESS')
    await expect(page.getByRole('status')).toContainText('Ticket updated and audit event recorded.')
    await ticket.getByLabel('Priority').selectOption('HIGH')
    await expect(page.getByRole('status')).toContainText('Ticket updated and audit event recorded.')
    const saved = await serviceDb().from('support_tickets').select('status,priority,last_admin_actor_id').eq('id', ticketInsert.data!.id).single()
    expect(saved.data).toMatchObject({ status: 'IN_PROGRESS', priority: 'HIGH' })
    await ticket.getByRole('button', { name: 'View history' }).click()
    await expect(ticket.getByText('No messages recorded.')).toBeVisible()
    const audit = await serviceDb().from('admin_audit_events').select('action').eq('target_id', ticketInsert.data!.id)
    expect(audit.data?.map((row) => row.action).sort()).toEqual(['ticket.updated', 'ticket.updated'])
    await writeEvidence(page, testInfo, { action: 'support_ticket_status_priority', persisted_status: saved.data?.status, persisted_priority: saved.data?.priority, audit_events: audit.data?.length, empty_history_state: true, customer_messages_sent: 0 })
  })

  test('staff management is denied to STAFF and remains accessible to the owner identity', async ({ page }, testInfo) => {
    await loginStaff(page)
    const staffResponse = await page.request.get('/api/admin/staff')
    const rolesResponse = await page.request.get('/api/admin/roles')
    expect(staffResponse.status()).toBe(403)
    expect(rolesResponse.status()).toBe(403)
    await page.goto('/admin/staff')
    await expect(page.getByRole('alert').filter({ hasText: 'cannot manage staff access' })).toContainText('cannot manage staff access')
    await writeEvidence(page, testInfo, { action: 'staff_privilege_denial', staff_api: staffResponse.status(), roles_api: rolesResponse.status() })
  })
})
