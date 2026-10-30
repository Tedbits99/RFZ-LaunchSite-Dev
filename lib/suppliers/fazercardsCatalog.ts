export type CatalogProductType = 'game_topup' | 'gift_card' | 'game_key' | 'unsupported';

export type CatalogField = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder: string;
  help_text: string;
};

export type CatalogCategory = {
  category_id: string;
  name: string;
  note: string | null;
  product_type: CatalogProductType;
  region: string | null;
  currency: string;
};

export type CatalogOffer = {
  offer_id: string;
  name: string;
  price_usd: number;
};

export type CatalogPageMeta = {
  total: number;
  total_known: boolean;
  limit: number;
  next_cursor: string | null;
  has_more: boolean;
};

export type CatalogCategoryPage = { items: CatalogCategory[]; meta: CatalogPageMeta };
export type CatalogOfferPage = {
  category: CatalogCategory;
  offers: CatalogOffer[];
  fields: CatalogField[];
  meta: CatalogPageMeta;
};

export type CatalogSourceMode = 'synthetic_fixture' | 'live_provider';

export class CatalogSourceError extends Error {
  constructor(message: string, readonly status = 503) {
    super(message);
    this.name = 'CatalogSourceError';
  }
}

const PROVIDER_URL = 'https://api.fzr.cards/api/v2';
const PAGE_LIMIT = 100;
const MAX_PAGES = 100;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;

const FIXTURE_CATEGORIES: CatalogCategory[] = [
  {
    category_id: 'mobile_legends_philippines', name: 'Mobile Legends: Bang Bang (Philippines)',
    note: 'Synthetic fixture — user and zone identifiers.', product_type: 'game_topup', region: 'PH', currency: 'USD',
  },
  {
    category_id: 'pubg_mobile_global', name: 'PUBG Mobile (Global)',
    note: 'Synthetic fixture — character identifier.', product_type: 'game_topup', region: 'GLOBAL', currency: 'USD',
  },
  {
    category_id: 'genshin_impact_global', name: 'Genshin Impact (Global)',
    note: 'Synthetic fixture — UID and server.', product_type: 'game_topup', region: 'GLOBAL', currency: 'USD',
  },
  {
    category_id: 'steam_gift_card_us', name: 'Steam Gift Card (US)',
    note: 'Explicitly unsupported: gift-card code delivery is not a game top-up.', product_type: 'gift_card', region: 'US', currency: 'USD',
  },
];

const FIXTURE_DATA: Record<string, { fields: CatalogField[]; offers: CatalogOffer[] }> = {
  mobile_legends_philippines: {
    fields: [
      { key: 'user_id', label: 'User ID', type: 'text', required: true, placeholder: 'Enter your User ID', help_text: 'Shown on your in-game profile.' },
      { key: 'zone_id', label: 'Zone ID', type: 'text', required: true, placeholder: 'Enter your Zone ID', help_text: 'Shown beside your User ID.' },
    ],
    offers: [
      { offer_id: 'mlph_diamonds_86', name: '86 Diamonds', price_usd: 0.82 },
      { offer_id: 'mlph_diamonds_172', name: '172 Diamonds', price_usd: 1.64 },
      { offer_id: 'mlph_diamonds_257', name: '257 Diamonds', price_usd: 2.45 },
    ],
  },
  pubg_mobile_global: {
    fields: [
      { key: 'character_id', label: 'Character ID', type: 'text', required: true, placeholder: 'Enter your Character ID', help_text: 'Use your PUBG Mobile character ID.' },
    ],
    offers: [
      { offer_id: 'pubg_uc_60', name: '60 UC', price_usd: 0.91 },
      { offer_id: 'pubg_uc_325', name: '325 UC', price_usd: 4.56 },
      { offer_id: 'pubg_uc_660', name: '660 UC', price_usd: 9.11 },
    ],
  },
  genshin_impact_global: {
    fields: [
      { key: 'uid', label: 'Genshin UID', type: 'text', required: true, placeholder: 'Enter your UID', help_text: 'Your numeric Genshin Impact UID.' },
      { key: 'server', label: 'Server', type: 'text', required: true, placeholder: 'Enter your server', help_text: 'Enter the server associated with your UID.' },
    ],
    offers: [
      { offer_id: 'genshin_crystals_60', name: '60 Genesis Crystals', price_usd: 0.99 },
      { offer_id: 'genshin_crystals_300', name: '300 + 30 Genesis Crystals', price_usd: 4.99 },
      { offer_id: 'genshin_crystals_980', name: '980 + 110 Genesis Crystals', price_usd: 14.99 },
    ],
  },
  steam_gift_card_us: {
    fields: [],
    offers: [],
  },
};

function loopbackUrl(value: string | undefined, expectedPort: string | undefined): boolean {
  if (!value || !expectedPort) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
      && url.port === expectedPort;
  } catch {
    return false;
  }
}

function hasDisposableServiceRole(): boolean {
  const token = process.env.CATALOG_SERVICE_ROLE_KEY || '';
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8')) as { role?: string };
    return claims.role === 'service_role' && token.split('.').length === 3;
  } catch {
    return false;
  }
}

export function isDisposableCatalogFixtureMode(): boolean {
  return process.env.RUNFAZONE_CATALOG_FIXTURE_MODE === 'enabled'
    && process.env.CATALOG_INTEGRATION_RUN === '1'
    && loopbackUrl(process.env.CATALOG_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.CATALOG_LOCAL_API_PORT)
    && loopbackUrl(process.env.CATALOG_APP_URL, '3000')
    && hasDisposableServiceRole();
}

export function isLiveCatalogConfigurationReady(supplierEnabled: boolean): boolean {
  return supplierEnabled
    && process.env.RUNFAZONE_SUPPLIER_CATALOG_RELEASE === 'enabled'
    && process.env.FAZERCARDS_CREDENTIAL_REVOCATION_VERIFIED === 'true'
    && process.env.FAZERCARDS_CATALOG_ACCESS_AUTHORIZED === 'true'
    && Boolean(process.env.FAZERCARDS_API_KEY?.trim());
}

export function getCatalogSourceMode(supplierEnabled: boolean): CatalogSourceMode | null {
  if (isDisposableCatalogFixtureMode()) return 'synthetic_fixture';
  return isLiveCatalogConfigurationReady(supplierEnabled) ? 'live_provider' : null;
}

function normalizeProductType(value: unknown, categoryText: string): CatalogProductType {
  const type = typeof value === 'string' ? value.toLowerCase().replace(/[\s-]/g, '_') : '';
  const text = `${type} ${categoryText}`.toLowerCase();
  if (/gift.?card|voucher|code.?delivery|digital.?code/.test(text)) return 'gift_card';
  if (/game.?key|cd.?key|activation.?key/.test(text)) return 'game_key';
  if (!type) return 'game_topup'; // Categories returned by /topups are top-up products unless their metadata contradicts that contract.
  if (/gift.?card|voucher|code_delivery/.test(type)) return 'gift_card';
  if (/game.?key|cd.?key|activation.?key/.test(type)) return 'game_key';
  if (/game.?top.?up|top.?up|recharge/.test(type)) return 'game_topup';
  return 'unsupported';
}

function categoryFrom(value: unknown): CatalogCategory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CatalogSourceError('Supplier returned an invalid category.');
  const row = value as Record<string, unknown>;
  const categoryId = String(row.category_id ?? row.id ?? '').trim();
  const name = String(row.name ?? row.title ?? '').trim();
  if (!ID.test(categoryId) || !name || name.length > 180) throw new CatalogSourceError('Supplier returned an invalid category.');
  const explicitType = row.product_type ?? row.productType ?? row.delivery_type ?? row.type;
  const rawCurrency = row.currency;
  const currency = typeof rawCurrency === 'string' ? rawCurrency.trim().toUpperCase() : 'USD';
  if (rawCurrency !== undefined && rawCurrency !== null && (typeof rawCurrency !== 'string' || !/^[A-Z]{3}$/.test(currency))) {
    throw new CatalogSourceError('Supplier returned invalid currency metadata.');
  }
  const note = typeof row.note === 'string' ? row.note.slice(0, 500) : null;
  return {
    category_id: categoryId,
    name,
    note,
    product_type: normalizeProductType(explicitType, `${name} ${note || ''}`),
    region: typeof (row.region ?? row.country) === 'string' ? String(row.region ?? row.country).slice(0, 80) : null,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : 'USD',
  };
}

function fieldsFrom(value: unknown): CatalogField[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 32) throw new CatalogSourceError('Supplier returned invalid player-field metadata.');
  const fields = value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new CatalogSourceError('Supplier returned invalid player-field metadata.');
    const row = item as Record<string, unknown>;
    const key = String(row.key ?? row.field_key ?? row.name ?? '').trim().toLowerCase();
    const label = String(row.label ?? row.display_name ?? row.name ?? '').trim();
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || !label || label.length > 120) throw new CatalogSourceError('Supplier returned invalid player-field metadata.');
    const fieldType = typeof row.type === 'string' ? row.type.trim().toLowerCase() : 'text';
    if (!['text', 'string'].includes(fieldType)) throw new CatalogSourceError('Supplier returned an unsupported player-field type.');
    return {
      key, label,
      type: 'text',
      required: row.required !== false && row.is_required !== false,
      placeholder: typeof row.placeholder === 'string' ? row.placeholder.slice(0, 180) : '',
      help_text: typeof (row.help_text ?? row.description) === 'string' ? String(row.help_text ?? row.description).slice(0, 500) : '',
    };
  });
  if (new Set(fields.map((field) => field.key)).size !== fields.length) throw new CatalogSourceError('Supplier returned duplicate player-field keys.');
  return fields;
}

function offersFrom(value: unknown): CatalogOffer[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 2000) throw new CatalogSourceError('Supplier returned invalid offers.');
  const ids = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new CatalogSourceError('Supplier returned an invalid offer.');
    const row = item as Record<string, unknown>;
    const offerId = String(row.offer_id ?? row.id ?? '').trim();
    const name = String(row.name ?? row.title ?? '').trim();
    const price = typeof row.price_usd === 'number' ? row.price_usd : Number(row.price_usd);
    if (!ID.test(offerId) || !name || name.length > 180 || !Number.isFinite(price) || price <= 0 || price > 1_000_000) {
      throw new CatalogSourceError('Supplier returned an invalid offer.');
    }
    if (ids.has(offerId)) throw new CatalogSourceError('Supplier returned duplicate offer IDs.');
    ids.add(offerId);
    return { offer_id: offerId, name, price_usd: Math.round(price * 10_000) / 10_000 };
  });
}

function pageMeta(value: unknown, itemCount: number, cursor: string | null): CatalogPageMeta {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CatalogSourceError('Supplier returned invalid pagination metadata.');
  }
  const meta = value as Record<string, unknown>;
  if (meta.has_more === undefined && meta.hasMore === undefined) {
    throw new CatalogSourceError('Supplier returned incomplete pagination metadata.');
  }
  if (meta.has_more !== undefined && typeof meta.has_more !== 'boolean') throw new CatalogSourceError('Supplier returned invalid pagination metadata.');
  if (meta.hasMore !== undefined && typeof meta.hasMore !== 'boolean') throw new CatalogSourceError('Supplier returned invalid pagination metadata.');
  if (meta.has_more !== undefined && meta.hasMore !== undefined && meta.has_more !== meta.hasMore) {
    throw new CatalogSourceError('Supplier returned contradictory pagination metadata.');
  }
  if (meta.next_cursor !== undefined && meta.next_cursor !== null && typeof meta.next_cursor !== 'string') {
    throw new CatalogSourceError('Supplier returned invalid pagination metadata.');
  }
  if (meta.nextCursor !== undefined && meta.nextCursor !== null && typeof meta.nextCursor !== 'string') {
    throw new CatalogSourceError('Supplier returned invalid pagination metadata.');
  }
  if (typeof meta.next_cursor === 'string' && typeof meta.nextCursor === 'string' && meta.next_cursor !== meta.nextCursor) {
    throw new CatalogSourceError('Supplier returned contradictory pagination metadata.');
  }
  if (meta.total !== undefined && (!Number.isSafeInteger(meta.total) || Number(meta.total) < 0)) {
    throw new CatalogSourceError('Supplier returned invalid pagination metadata.');
  }
  if (meta.limit !== undefined && (!Number.isSafeInteger(meta.limit) || Number(meta.limit) <= 0)) {
    throw new CatalogSourceError('Supplier returned invalid pagination metadata.');
  }
  const hasMore = meta.has_more === true || meta.hasMore === true;
  const next = typeof meta.next_cursor === 'string' ? meta.next_cursor : typeof meta.nextCursor === 'string' ? meta.nextCursor : null;
  if (hasMore && (!next || next === cursor || next.length > 512 || itemCount === 0)) throw new CatalogSourceError('Supplier returned invalid pagination metadata.');
  if (!hasMore && next) throw new CatalogSourceError('Supplier returned contradictory pagination metadata.');
  if (meta.total !== undefined && Number(meta.total) < itemCount) throw new CatalogSourceError('Supplier returned inconsistent pagination totals.');
  return {
    total: Number.isSafeInteger(meta.total) && Number(meta.total) >= 0 ? Number(meta.total) : itemCount,
    total_known: Number.isSafeInteger(meta.total) && Number(meta.total) >= 0,
    limit: Number.isSafeInteger(meta.limit) && Number(meta.limit) > 0 ? Number(meta.limit) : PAGE_LIMIT,
    next_cursor: hasMore ? next : null,
    has_more: hasMore,
  };
}

function unwrap(value: unknown): Record<string, unknown> | unknown[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const envelope = value as Record<string, unknown>;
    if (envelope.success === false || envelope.ok === false) throw new CatalogSourceError('Supplier catalog request failed.');
    const data = envelope.data;
    if (data && (typeof data === 'object' || Array.isArray(data))) return data as Record<string, unknown> | unknown[];
    return envelope;
  }
  if (Array.isArray(value)) return value;
  throw new CatalogSourceError('Supplier returned an invalid response.');
}

async function providerGet(path: string, params: Record<string, string>): Promise<unknown> {
  if (process.env.CATALOG_INTEGRATION_RUN === '1') {
    throw new CatalogSourceError('Live supplier requests are prohibited in disposable catalog acceptance.');
  }
  const key = process.env.FAZERCARDS_API_KEY?.trim();
  if (!key) throw new CatalogSourceError('Live supplier catalog is locked until an authorized credential is configured.');
  const url = new URL(path.replace(/^\/+/, ''), `${PROVIDER_URL}/`);
  for (const [name, value] of Object.entries(params)) if (value) url.searchParams.set(name, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      method: 'GET', cache: 'no-store', signal: controller.signal,
      headers: { Accept: 'application/json', 'X-API-Key': key },
    });
    if (!response.ok) throw new CatalogSourceError(`Live supplier catalog request failed (HTTP ${response.status}).`);
    return await response.json().catch(() => { throw new CatalogSourceError('Supplier returned an invalid response.'); });
  } catch (error) {
    if (error instanceof CatalogSourceError) throw error;
    throw new CatalogSourceError('Live supplier catalog is temporarily unavailable.');
  } finally {
    clearTimeout(timer);
  }
}

function fixturePage<T>(items: T[], cursor: string | null, limit: number): { items: T[]; meta: CatalogPageMeta } {
  const offset = cursor === null ? 0 : Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length) throw new CatalogSourceError('Invalid catalog cursor.', 400);
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  const hasMore = nextOffset < items.length;
  return { items: page, meta: { total: items.length, total_known: true, limit, next_cursor: hasMore ? String(nextOffset) : null, has_more: hasMore } };
}

export async function listFazerCardsCategories(options: {
  mode: CatalogSourceMode; cursor?: string | null; search?: string;
}): Promise<CatalogCategoryPage> {
  const cursor = options.cursor || null;
  const search = (options.search || '').trim().toLowerCase();
  if (options.mode === 'synthetic_fixture') {
    const filtered = FIXTURE_CATEGORIES.filter((category) => !search
      || category.name.toLowerCase().includes(search)
      || category.category_id.toLowerCase().includes(search));
    return fixturePage(filtered, cursor, 2);
  }
  const params: Record<string, string> = { limit: String(PAGE_LIMIT) };
  if (cursor) params.cursor = cursor;
  if (search) params.search = search;
  const raw = unwrap(await providerGet('/topups', params));
  const envelope = Array.isArray(raw) ? { items: raw } : raw;
  const row = envelope as Record<string, unknown>;
  const values = row.items ?? row.categories;
  if (!Array.isArray(values)) throw new CatalogSourceError('Supplier returned an invalid category page.');
  const items = values.map(categoryFrom);
  if (new Set(items.map((item) => item.category_id)).size !== items.length) throw new CatalogSourceError('Supplier returned duplicate category IDs.');
  return { items, meta: pageMeta(row.meta, items.length, cursor) };
}

export async function listFazerCardsOffers(options: {
  mode: CatalogSourceMode; category: CatalogCategory; cursor?: string | null;
}): Promise<CatalogOfferPage> {
  const { category } = options;
  if (category.product_type !== 'game_topup') {
    return { category, offers: [], fields: [], meta: { total: 0, total_known: true, limit: PAGE_LIMIT, next_cursor: null, has_more: false } };
  }
  if (options.mode === 'synthetic_fixture') {
    const fixture = FIXTURE_DATA[category.category_id];
    if (!fixture) throw new CatalogSourceError('Synthetic category was not found.', 404);
    const page = fixturePage(fixture.offers, options.cursor || null, 2);
    return { category, offers: page.items, fields: fixture.fields, meta: page.meta };
  }
  const params: Record<string, string> = { category_id: category.category_id, limit: String(PAGE_LIMIT) };
  if (options.cursor) params.cursor = options.cursor;
  const raw = unwrap(await providerGet('/offers', params));
  const envelope = Array.isArray(raw) ? { offers: raw } : raw;
  const row = envelope as Record<string, unknown>;
  if (typeof row.category_id === 'string' && row.category_id !== category.category_id) throw new CatalogSourceError('Supplier returned offers for a different category.');
  const offers = offersFrom(row.offers ?? row.items);
  const fields = fieldsFrom(row.fields ?? row.player_fields ?? row.required_fields);
  return { category, offers, fields, meta: pageMeta(row.meta, offers.length, options.cursor || null) };
}

export async function getFazerCardsCategory(
  mode: CatalogSourceMode,
  categoryId: string,
): Promise<CatalogCategory> {
  if (!ID.test(categoryId)) throw new CatalogSourceError('Invalid category ID.', 400);
  if (mode === 'synthetic_fixture') {
    const category = FIXTURE_CATEGORIES.find((item) => item.category_id === categoryId);
    if (!category) throw new CatalogSourceError('Category not found.', 404);
    return category;
  }
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
    const page = await listFazerCardsCategories({ mode, cursor });
    const category = page.items.find((item) => item.category_id === categoryId);
    if (category) return category;
    if (!page.meta.has_more || !page.meta.next_cursor) break;
    if (seenCursors.has(page.meta.next_cursor)) throw new CatalogSourceError('Supplier category pagination repeated a cursor.');
    seenCursors.add(page.meta.next_cursor);
    cursor = page.meta.next_cursor;
  }
  throw new CatalogSourceError('Category not found.', 404);
}

export async function getCompleteFazerCardsOffersSnapshot(
  mode: CatalogSourceMode,
  category: CatalogCategory,
): Promise<{ offers: CatalogOffer[]; fields: CatalogField[]; complete: true }> {
  if (category.product_type !== 'game_topup') throw new CatalogSourceError('This supplier product type is unsupported for game top-up import.', 422);
  const offers: CatalogOffer[] = [];
  const ids = new Set<string>();
  let cursor: string | null = null;
  let fields: CatalogField[] | null = null;
  let expectedTotal: number | null = null;
  const seenCursors = new Set<string>();
  for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
    const page = await listFazerCardsOffers({ mode, category, cursor });
    if (expectedTotal !== null && page.meta.total_known && expectedTotal !== page.meta.total) {
      throw new CatalogSourceError('Supplier offer count changed during pagination.');
    }
    if (expectedTotal === null && page.meta.total_known) expectedTotal = page.meta.total;
    if (fields && JSON.stringify(fields) !== JSON.stringify(page.fields)) throw new CatalogSourceError('Supplier player-field metadata changed during pagination.');
    fields = page.fields;
    for (const offer of page.offers) {
      if (ids.has(offer.offer_id)) throw new CatalogSourceError('Supplier returned duplicate offer IDs across pages.');
      ids.add(offer.offer_id);
      offers.push(offer);
    }
    if (!page.meta.has_more || !page.meta.next_cursor) {
      if (expectedTotal !== null && expectedTotal !== offers.length) throw new CatalogSourceError('Supplier returned an incomplete offer snapshot.');
      return { offers, fields: fields || [], complete: true };
    }
    if (seenCursors.has(page.meta.next_cursor)) throw new CatalogSourceError('Supplier offer pagination repeated a cursor.');
    seenCursors.add(page.meta.next_cursor);
    cursor = page.meta.next_cursor;
  }
  throw new CatalogSourceError('Supplier catalog snapshot exceeded the pagination safety limit.');
}
