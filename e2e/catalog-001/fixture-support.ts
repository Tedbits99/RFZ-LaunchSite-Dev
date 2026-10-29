import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page, TestInfo } from '@playwright/test'

let serviceClient: SupabaseClient | null = null
let anonClient: SupabaseClient | null = null

function localUrl(): string {
  const value = process.env.CATALOG_SUPABASE_URL || ''
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Catalog acceptance requires a disposable local Supabase URL.') }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== process.env.CATALOG_LOCAL_API_PORT) {
    throw new Error('Refusing catalog acceptance against a non-loopback or unexpected Supabase URL.')
  }
  return value
}

export function serviceDb(): SupabaseClient {
  if (serviceClient) return serviceClient
  const url = localUrl()
  const key = process.env.CATALOG_SERVICE_ROLE_KEY || ''
  if (!key) throw new Error('The disposable Supabase service key is missing.')
  const payload = key.split('.')[1]
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { role?: string }
    if (claims.role !== 'service_role') throw new Error('The local database key is not a service-role fixture.')
  } catch {
    throw new Error('The disposable Supabase service key is not a valid local JWT.')
  }
  serviceClient = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  return serviceClient
}

export function anonDb(): SupabaseClient {
  if (anonClient) return anonClient
  const key = process.env.CATALOG_ANON_KEY || ''
  if (!key) throw new Error('The disposable Supabase anon key is missing.')
  anonClient = createClient(localUrl(), key, { auth: { autoRefreshToken: false, persistSession: false } })
  return anonClient
}

export async function identityDb(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(localUrl(), process.env.CATALOG_ANON_KEY || '', {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  if (!email || !password) throw new Error('A synthetic catalog identity is required.')
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error('Synthetic local Auth sign-in failed.')
  return client
}

export function fixtureSlug(testInfo: TestInfo, label: string): string {
  const run = (process.env.CATALOG_RUN_TAG || 'local').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 24)
  const project = testInfo.project.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const digest = createHash('sha256').update(`${testInfo.testId}:${label}`).digest('hex').slice(0, 10)
  return `catalog-${run}-${project}-${digest}`.slice(0, 120)
}

export async function createGame(testInfo: TestInfo, label: string, options: { withRequiredField?: boolean; published?: boolean } = {}) {
  const slug = fixtureSlug(testInfo, label)
  const published = options.published === true
  const { data: game, error } = await serviceDb().from('games').insert({
    slug,
    name: `Synthetic ${label}`,
    short_name: 'SYN',
    description: 'Disposable CATALOG-001 acceptance fixture.',
    region: 'Synthetic Region',
    currency: 'PHP',
    logo_url: null,
    cover_url: null,
    banner_url: null,
    is_active: published,
    is_featured: false,
    sort_order: 900,
    catalog_status: published ? 'PUBLISHED' : 'DRAFT',
    published_at: published ? new Date().toISOString() : null,
  }).select('id,slug,name,catalog_status,is_active').single()
  if (error || !game) throw new Error(`Synthetic game fixture creation failed (SQLSTATE ${error?.code || 'unknown'}).`)
  if (options.withRequiredField !== false) {
    const field = await serviceDb().from('game_input_fields').insert({
      game_id: game.id,
      label: 'Player ID',
      field_key: 'player_id',
      placeholder: 'Synthetic player identifier',
      help_text: 'Disposable fixture only.',
      is_required: true,
      sort_order: 0,
    })
    if (field.error) throw new Error(`Synthetic game field fixture creation failed (SQLSTATE ${field.error.code}).`)
  }
  return game
}

export async function createPackage(gameId: string, options: {
  name: string; sku: string; priceCents: number; sortOrder?: number; status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'; active?: boolean; imageUrl?: string | null;
}) {
  const status = options.status || 'DRAFT'
  const { data, error } = await serviceDb().from('packages').insert({
    game_id: gameId,
    name: options.name,
    sku: options.sku,
    amount: options.name,
    price_cents: options.priceCents,
    original_price_cents: null,
    bonus: null,
    is_active: options.active ?? status === 'PUBLISHED',
    catalog_status: status,
    published_at: status === 'PUBLISHED' ? new Date().toISOString() : null,
    sort_order: options.sortOrder ?? 0,
    badge: null,
    image_url: options.imageUrl ?? null,
    supplier_review_required: false,
  }).select('id,game_id,name,sku,price_cents,is_active,catalog_status,sort_order').single()
  if (error || !data) throw new Error(`Synthetic package fixture creation failed (SQLSTATE ${error?.code || 'unknown'}).`)
  return data
}

export async function createHistoricalOrder(gameId: string, packageId: string, slug: string, priceCents: number) {
  const { data, error } = await serviceDb().from('orders').insert({
    reference: `CAT-${slug.slice(-18).toUpperCase()}`,
    email: `history-${slug}@example.invalid`,
    customer_name: 'Synthetic Historical Customer',
    game_id: gameId,
    package_id: packageId,
    player_inputs: { player_id: 'synthetic-player' },
    subtotal_cents: priceCents,
    discount_cents: 0,
    total_cents: priceCents,
    payment_method: 'manual',
    status: 'WAITING_PAYMENT',
  }).select('id,reference').single()
  if (error || !data) throw new Error(`Synthetic historical order fixture creation failed (SQLSTATE ${error?.code || 'unknown'}).`)
  return data
}

export async function loginAdmin(page: Page) {
  await page.goto('/secure-admin-login?from=logout')
  await page.getByLabel('Email').fill(process.env.CATALOG_ADMIN_EMAIL || '')
  await page.locator('input[autocomplete="current-password"]').fill(process.env.CATALOG_ADMIN_PASSWORD || '')
  await page.getByRole('button', { name: 'Sign In' }).click()
  await page.waitForURL(/\/admin(?:\/|$)/)
}

export async function loginStaff(page: Page) {
  const staff = await identityDb(process.env.CATALOG_STAFF_EMAIL || '', process.env.CATALOG_STAFF_PASSWORD || '')
  const { data: { session } } = await staff.auth.getSession()
  if (!session) throw new Error('Synthetic staff identity did not receive a local Auth session.')
  const value = `base64url-${Buffer.from(JSON.stringify(session)).toString('base64url')}`
  await page.context().addCookies([{
    name: 'rfz-admin-auth', value, url: 'http://127.0.0.1:3000', sameSite: 'Lax',
  }])
}

export async function loginCustomer(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(process.env.CATALOG_CUSTOMER_EMAIL || '')
  await page.locator('input[autocomplete="current-password"]').fill(process.env.CATALOG_CUSTOMER_PASSWORD || '')
  await page.getByRole('button', { name: 'Sign In' }).click()
  await page.waitForTimeout(500)
  if (await page.getByRole('alert').count()) throw new Error('Synthetic customer login was rejected by local Supabase Auth.')
}

export function observePageErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.name || 'PageError'))
  return errors
}

export async function writeEvidence(page: Page, testInfo: TestInfo, observations: Record<string, unknown>) {
  const output = testInfo.outputPath('catalog-evidence.json')
  await mkdir(path.dirname(output), { recursive: true })
  const evidence = {
    schema: 'rfz.catalog-001.evidence.v1',
    candidate_sha: process.env.CATALOG_CANDIDATE_SHA || 'LOCAL_UNCOMMITTED',
    browser_project: testInfo.project.name,
    test: testInfo.title,
    viewport: page.viewportSize(),
    database_host: '127.0.0.1',
    observations,
  }
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  await page.screenshot({ path: testInfo.outputPath('catalog-screen.png'), fullPage: true, animations: 'disabled' })
}
