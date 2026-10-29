import { expect, test } from '@playwright/test'
import {
  createGame,
  createHistoricalOrder,
  createPackage,
  fixtureSlug,
  identityDb,
  loginAdmin,
  loginCustomer,
  loginStaff,
  serviceDb,
  writeEvidence,
} from './fixture-support'

test.describe('CATALOG-001 admin lifecycle and authorization', () => {
  test('admin creates a draft game through the admin form', async ({ page }, testInfo) => {
    await loginAdmin(page)
    await page.goto('/admin/games')
    await page.getByRole('button', { name: /Add Game/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Add game' })
    const slug = fixtureSlug(testInfo, 'create-ui')
    await dialog.getByLabel('Slug').fill(slug)
    await dialog.getByLabel('Name').fill(`Synthetic UI ${testInfo.project.name}`)
    await dialog.getByLabel('Region').fill('Synthetic Region')
    await dialog.getByLabel('Description').fill('Created only in the disposable catalog acceptance database.')
    await dialog.locator('input[aria-label="Field 1 label"]').fill('Player ID')
    await dialog.locator('input[aria-label="Field 1 key"]').fill('player_id')
    await dialog.getByRole('button', { name: 'Save draft' }).click()
    const row = page.getByRole('row').filter({ hasText: slug })
    await expect(row).toBeVisible()
    await expect(row).toContainText('DRAFT')
    const { data, error } = await serviceDb().from('games').select('catalog_status,is_active').eq('slug', slug).single()
    expect(error).toBeNull()
    expect(data).toMatchObject({ catalog_status: 'DRAFT', is_active: false })
    await writeEvidence(page, testInfo, { action: 'admin_create_game', result: data })
  })

  test('duplicate game slugs are rejected without changing the original row', async ({ page }, testInfo) => {
    const game = await createGame(testInfo, 'duplicate-slug')
    await loginAdmin(page)
    const response = await page.request.post('/api/admin/catalog/games', { data: {
      slug: game.slug, name: 'Duplicate Synthetic Game', region: 'Synthetic Region', fields: [{ label: 'Player ID', field_key: 'player_id', is_required: true }],
    } })
    expect(response.status()).toBe(409)
    expect((await response.json()).error).toContain('already exists')
    const { data, error } = await serviceDb().from('games').select('id,name').eq('slug', game.slug)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0].id).toBe(game.id)
    await writeEvidence(page, testInfo, { action: 'duplicate_slug', http_status: response.status(), original_count: data?.length })
  })

  test('admin edits metadata, artwork, and a configured player field', async ({ page }, testInfo) => {
    const game = await createGame(testInfo, 'edit-metadata')
    await loginAdmin(page)
    await page.goto('/admin/games')
    const row = page.getByRole('row').filter({ hasText: game.slug })
    await row.getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit game' })
    await dialog.getByLabel('Name').fill('Synthetic Edited Catalog Game')
    await dialog.getByLabel('Region').fill('Synthetic Test Region')
    await dialog.getByLabel('Description').fill('Edited in the isolated acceptance fixture.')
    await dialog.getByLabel('logo url').fill('https://assets.example.invalid/catalog-logo.png')
    await dialog.getByLabel('cover url').fill('https://assets.example.invalid/catalog-cover.png')
    await dialog.getByLabel('banner url').fill('https://assets.example.invalid/catalog-banner.png')
    await dialog.locator('input[aria-label="Field 1 label"]').fill('Account ID')
    await dialog.locator('input[aria-label="Field 1 key"]').fill('account_id')
    await dialog.getByRole('button', { name: 'Save draft' }).click()
    const { data, error } = await serviceDb().from('games').select('name,region,description,logo_url,cover_url,banner_url').eq('id', game.id).single()
    expect(error).toBeNull()
    expect(data).toMatchObject({
      name: 'Synthetic Edited Catalog Game', region: 'Synthetic Test Region',
      logo_url: 'https://assets.example.invalid/catalog-logo.png',
      cover_url: 'https://assets.example.invalid/catalog-cover.png',
      banner_url: 'https://assets.example.invalid/catalog-banner.png',
    })
    const { data: fields, error: fieldsError } = await serviceDb().from('game_input_fields').select('label,field_key,is_required').eq('game_id', game.id)
    expect(fieldsError).toBeNull()
    expect(fields).toEqual([{ label: 'Account ID', field_key: 'account_id', is_required: true }])
    await writeEvidence(page, testInfo, { action: 'edit_metadata_artwork_fields', field_count: fields?.length, saved: Boolean(data) })
  })

  test('admin configures required player fields and empty required-field configuration blocks publish', async ({ page }, testInfo) => {
    const game = await createGame(testInfo, 'required-fields', { withRequiredField: false })
    await createPackage(game.id, { name: 'Synthetic package', sku: `${game.slug}-sku`, priceCents: 300 })
    await loginAdmin(page)
    const denied = await page.request.patch(`/api/admin/catalog/games/${game.id}`, { data: { action: 'publish' } })
    expect(denied.status()).toBe(409)
    expect((await denied.json()).error).toContain('required player input field')

    await page.goto('/admin/games')
    const row = page.getByRole('row').filter({ hasText: game.slug })
    await row.getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit game' })
    await dialog.getByRole('button', { name: 'Add field' }).click()
    await dialog.locator('input[aria-label="Field 1 label"]').fill('Player Tag')
    await dialog.locator('input[aria-label="Field 1 key"]').fill('player_tag')
    await dialog.getByRole('button', { name: 'Save draft' }).click()
    const { data, error } = await serviceDb().from('game_input_fields').select('field_key,is_required').eq('game_id', game.id)
    expect(error).toBeNull()
    expect(data).toEqual([{ field_key: 'player_tag', is_required: true }])
    await writeEvidence(page, testInfo, { action: 'required_player_fields', required_field_count: data?.filter((field) => field.is_required).length, publish_without_field_status: denied.status() })
  })

  test('admin creates, edits, and advances package and game lifecycle states', async ({ page }, testInfo) => {
    const game = await createGame(testInfo, 'publish-eligible')
    await loginAdmin(page)
    page.on('dialog', (dialog) => dialog.accept())
    await page.goto(`/admin/games/${game.id}/packages`)
    await page.getByRole('button', { name: 'Add package' }).click()
    const createForm = page.getByRole('region', { name: 'Create package' })
    await createForm.getByLabel('Name').fill('Synthetic 100 Credits')
    await createForm.getByLabel('SKU').fill(`${game.slug}-100`)
    await createForm.getByLabel('Amount / description').fill('100 credits')
    await createForm.getByLabel('Selling price (PHP)').fill('3.00')
    await createForm.getByRole('button', { name: 'Create draft' }).click()
    const card = page.locator('article').filter({ hasText: `${game.slug}-100` })
    await expect(card).toContainText('DRAFT')
    await card.getByRole('button', { name: 'Edit' }).click()
    await card.getByLabel('Name').fill('Synthetic 120 Credits')
    await card.getByLabel('Amount / description').fill('120 credits')
    await card.getByLabel('Selling price (PHP)').fill('3.50')
    await card.getByRole('button', { name: 'Save draft changes' }).click()
    await expect(card).toContainText('Synthetic 120 Credits')
    await expect(card).toContainText('₱3.50')
    await card.getByRole('button', { name: 'Publish' }).click()
    await expect(card).toContainText('PUBLISHED')
    await card.getByRole('button', { name: 'Hide' }).click()
    await expect(card).toContainText('DRAFT')
    await card.getByRole('button', { name: 'Publish' }).click()
    await card.getByRole('button', { name: 'Archive' }).click()
    await expect(card).toContainText('ARCHIVED')
    await card.getByRole('button', { name: 'Restore' }).click()
    await expect(card).toContainText('DRAFT')
    await card.getByRole('button', { name: 'Publish' }).click()

    // Margin and fee checks are exercised through the same authenticated API
    // used by the admin client. The local supplier release lock remains off.
    const supplierCost = await serviceDb().from('packages').insert({
      game_id: game.id, name: 'Synthetic supplier-linked package', sku: `${game.slug}-supplier-margin`, amount: 'Synthetic offer',
      price_cents: 5650, is_active: false, catalog_status: 'DRAFT', supplier_offer_id: `offer-${game.slug}`,
      supplier_category_id: 'mobile_legends_philippines', supplier_cost_usd: 1, supplier_review_required: false,
    }).select('id').single()
    expect(supplierCost.error).toBeNull()
    const assumptions = await serviceDb().from('app_settings').update({
      reference_usd_php_rate: 56, payment_fee_reserve_bps: 250, payment_fee_fixed_cents: 25,
      supplier_fulfillment_release_enabled: false,
    }).eq('id', 1)
    expect(assumptions.error).toBeNull()
    const underCost = await page.request.patch(`/api/admin/catalog/packages/${supplierCost.data!.id}`, { data: { action: 'publish', price_cents: 5500 } })
    expect(underCost.status()).toBe(409)
    expect((await underCost.json()).error).toMatch(/supplier cost plus.*fee reserve/i)
    const underFeeReserve = await page.request.patch(`/api/admin/catalog/packages/${supplierCost.data!.id}`, { data: { action: 'publish', price_cents: 5650 } })
    expect(underFeeReserve.status()).toBe(409)
    expect((await underFeeReserve.json()).error).toMatch(/fee reserve/i)

    await page.goto('/admin/games')
    const row = page.getByRole('row').filter({ hasText: game.slug })
    await row.getByRole('button', { name: 'Publish' }).click()
    const { data: savedGame, error: gameError } = await serviceDb().from('games').select('catalog_status,is_active').eq('id', game.id).single()
    expect(gameError).toBeNull()
    expect(savedGame).toMatchObject({ catalog_status: 'PUBLISHED', is_active: true })
    await writeEvidence(page, testInfo, { action: 'package_game_lifecycle', game_status: savedGame?.catalog_status, package_status: 'PUBLISHED', negative_margin_rejected: underCost.status() === 409, fee_reserve_rejected: underFeeReserve.status() === 409 })
  })

  test('admin hides a game and its storefront route becomes unavailable', async ({ page }, testInfo) => {
    const game = await createGame(testInfo, 'hide-game', { published: true })
    await createPackage(game.id, { name: 'Synthetic visible package', sku: `${game.slug}-active`, priceCents: 700, status: 'PUBLISHED' })
    await loginAdmin(page)
    await page.goto('/admin/games')
    const row = page.getByRole('row').filter({ hasText: game.slug })
    page.on('dialog', (dialog) => dialog.accept())
    await row.getByRole('button', { name: 'Hide' }).click()
    const { data, error } = await serviceDb().from('games').select('catalog_status,is_active').eq('id', game.id).single()
    expect(error).toBeNull()
    expect(data).toMatchObject({ catalog_status: 'DRAFT', is_active: false })
    const storefront = await page.goto(`/games/${game.slug}`)
    expect(storefront?.status()).toBe(404)
    await writeEvidence(page, testInfo, { action: 'hide_game', status: data?.catalog_status, storefront_http_status: storefront?.status() })
  })

  test('archive and restore preserve a historical order reference', async ({ page }, testInfo) => {
    const game = await createGame(testInfo, 'archive-history', { published: true })
    const pkg = await createPackage(game.id, { name: 'Synthetic historical package', sku: `${game.slug}-history`, priceCents: 900, status: 'PUBLISHED' })
    const order = await createHistoricalOrder(game.id, pkg.id, game.slug, 900)
    await loginAdmin(page)
    await page.goto('/admin/games')
    page.on('dialog', (dialog) => dialog.accept())
    const row = page.getByRole('row').filter({ hasText: game.slug })
    await row.getByRole('button', { name: 'Archive' }).click()
    const { data: archived, error } = await serviceDb().from('games').select('catalog_status,is_active').eq('id', game.id).single()
    expect(error).toBeNull()
    expect(archived).toMatchObject({ catalog_status: 'ARCHIVED', is_active: false })
    const { data: orderRows, error: orderError } = await serviceDb().from('orders').select('id,game_id,package_id').eq('id', order.id)
    expect(orderError).toBeNull()
    expect(orderRows).toEqual([{ id: order.id, game_id: game.id, package_id: pkg.id }])
    const archivedRow = page.getByRole('row').filter({ hasText: game.slug })
    await archivedRow.getByRole('button', { name: 'Restore' }).click()
    const { data: restored, error: restoreError } = await serviceDb().from('games').select('catalog_status,is_active').eq('id', game.id).single()
    expect(restoreError).toBeNull()
    expect(restored).toMatchObject({ catalog_status: 'DRAFT', is_active: false })
    const { data: remainingOrders, error: remainingOrdersError } = await serviceDb().from('orders').select('id').eq('id', order.id)
    expect(remainingOrdersError).toBeNull()
    expect(remainingOrders).toHaveLength(1)
    await writeEvidence(page, testInfo, { action: 'archive_restore', archived: archived?.catalog_status, restored: restored?.catalog_status, historical_order_preserved: remainingOrders?.length === 1 })
  })

  test('staff are denied catalog HTTP mutations and direct SECURITY DEFINER RPC calls', async ({ page }, testInfo) => {
    await loginStaff(page)
    const slug = fixtureSlug(testInfo, 'staff-denied')
    const response = await page.request.post('/api/admin/catalog/games', { data: {
      slug, name: 'Forbidden Synthetic Staff Game', region: 'Synthetic Region', fields: [],
    } })
    expect(response.status()).toBe(403)
    const staff = await identityDb(process.env.CATALOG_STAFF_EMAIL || '', process.env.CATALOG_STAFF_PASSWORD || '')
    const rpc = await staff.rpc('admin_create_catalog_game', {
      p_game: { slug, name: 'Forbidden Direct RPC', region: 'Synthetic Region' }, p_fields: [],
    })
    expect(rpc.error).not.toBeNull()
    const { data } = await serviceDb().from('games').select('id').eq('slug', slug)
    expect(data).toHaveLength(0)
    await staff.auth.signOut()
    await writeEvidence(page, testInfo, { action: 'staff_authorization_denial', api_status: response.status(), rpc_denied: Boolean(rpc.error), created_rows: data?.length })
  })

  test('anonymous and customer Auth identities cannot mutate catalog records', async ({ page }, testInfo) => {
    const slug = fixtureSlug(testInfo, 'customer-denied')
    const anonymousResponse = await page.request.post('/api/admin/catalog/games', { data: {
      slug, name: 'Anonymous Synthetic Game', region: 'Synthetic Region', fields: [],
    } })
    expect(anonymousResponse.status()).toBe(401)
    await loginCustomer(page)
    const customerResponse = await page.request.post('/api/admin/catalog/games', { data: {
      slug, name: 'Customer Synthetic Game', region: 'Synthetic Region', fields: [],
    } })
    expect([401, 403]).toContain(customerResponse.status())
    const customer = await identityDb(process.env.CATALOG_CUSTOMER_EMAIL || '', process.env.CATALOG_CUSTOMER_PASSWORD || '')
    const rpc = await customer.rpc('admin_create_catalog_game', {
      p_game: { slug, name: 'Forbidden Customer RPC', region: 'Synthetic Region' }, p_fields: [],
    })
    expect(rpc.error).not.toBeNull()
    const { data } = await serviceDb().from('games').select('id').eq('slug', slug)
    expect(data).toHaveLength(0)
    await customer.auth.signOut()
    await writeEvidence(page, testInfo, { action: 'anonymous_customer_denial', anonymous_status: anonymousResponse.status(), customer_status: customerResponse.status(), rpc_denied: Boolean(rpc.error), created_rows: data?.length })
  })
})
