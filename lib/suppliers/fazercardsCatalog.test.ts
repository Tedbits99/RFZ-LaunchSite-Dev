import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCatalogSourceMode,
  getCompleteFazerCardsOffersSnapshot,
  isDisposableCatalogFixtureMode,
  listFazerCardsCategories,
  listFazerCardsOffers,
} from './fazercardsCatalog';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('FazerCards catalog source safety', () => {
  it('paginates three supported game categories and labels gift-card products as unsupported', async () => {
    const first = await listFazerCardsCategories({ mode: 'synthetic_fixture' });
    expect(first.items).toHaveLength(2);
    expect(first.meta.has_more).toBe(true);
    const second = await listFazerCardsCategories({ mode: 'synthetic_fixture', cursor: first.meta.next_cursor });
    const all = [...first.items, ...second.items];
    expect(all.filter((category) => category.product_type === 'game_topup')).toHaveLength(3);
    expect(all.find((category) => category.category_id === 'steam_gift_card_us')?.product_type).toBe('gift_card');
  });

  it('provides distinct player-field contracts and a complete paginated offer snapshot for each game', async () => {
    const firstCategoryPage = await listFazerCardsCategories({ mode: 'synthetic_fixture' });
    const secondCategoryPage = await listFazerCardsCategories({ mode: 'synthetic_fixture', cursor: '2' });
    const pubg = firstCategoryPage.items.find((category) => category.category_id === 'pubg_mobile_global')!;
    const firstPage = await listFazerCardsOffers({ mode: 'synthetic_fixture', category: pubg });
    expect(firstPage.fields.map((field) => field.key)).toEqual(['character_id']);
    expect(firstPage.meta.has_more).toBe(true);
    const snapshot = await getCompleteFazerCardsOffersSnapshot('synthetic_fixture', pubg);
    expect(snapshot.complete).toBe(true);
    expect(snapshot.offers).toHaveLength(3);

    const genshin = secondCategoryPage.items.find((category) => category.category_id === 'genshin_impact_global')!;
    const genshinSnapshot = await getCompleteFazerCardsOffersSnapshot('synthetic_fixture', genshin);
    expect(genshinSnapshot.fields.map((field) => field.key)).toEqual(['uid', 'server']);
  });

  it('only selects synthetic fixtures when integration mode is explicitly loopback-bound', () => {
    const claims = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
    vi.stubEnv('RUNFAZONE_CATALOG_FIXTURE_MODE', 'enabled');
    vi.stubEnv('CATALOG_INTEGRATION_RUN', '1');
    vi.stubEnv('CATALOG_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('CATALOG_LOCAL_API_PORT', '54321');
    vi.stubEnv('CATALOG_APP_URL', 'http://127.0.0.1:3000');
    vi.stubEnv('CATALOG_SERVICE_ROLE_KEY', `e30.${claims}.synthetic-signature`);
    expect(isDisposableCatalogFixtureMode()).toBe(true);
    expect(getCatalogSourceMode(false)).toBe('synthetic_fixture');

    vi.stubEnv('CATALOG_SUPABASE_URL', 'https://production.example');
    expect(isDisposableCatalogFixtureMode()).toBe(false);
    expect(getCatalogSourceMode(false)).toBeNull();
  });

  it('requires revocation verification, independent authorization, supplier enablement, and a server credential for live mode', () => {
    vi.stubEnv('FAZERCARDS_API_KEY', 'synthetic-dummy-only');
    vi.stubEnv('RUNFAZONE_SUPPLIER_CATALOG_RELEASE', 'enabled');
    expect(getCatalogSourceMode(true)).toBeNull();
    vi.stubEnv('FAZERCARDS_CREDENTIAL_REVOCATION_VERIFIED', 'true');
    vi.stubEnv('FAZERCARDS_CATALOG_ACCESS_AUTHORIZED', 'true');
    expect(getCatalogSourceMode(false)).toBeNull();
    expect(getCatalogSourceMode(true)).toBe('live_provider');
  });

  it('turns upstream outages into closed errors without returning partial snapshots', async () => {
    vi.stubEnv('CATALOG_INTEGRATION_RUN', '0');
    vi.stubEnv('FAZERCARDS_API_KEY', 'synthetic-dummy-only');
    const fetchMock = vi.fn().mockRejectedValue(new Error('synthetic network outage'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(listFazerCardsCategories({ mode: 'live_provider' })).rejects.toMatchObject({
      message: 'Live supplier catalog is temporarily unavailable.',
      status: 503,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('api.fzr.cards');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v2/topups');
  });

  it('rejects a truncated final page instead of treating it as a complete snapshot', async () => {
    vi.stubEnv('CATALOG_INTEGRATION_RUN', '0');
    vi.stubEnv('FAZERCARDS_API_KEY', 'synthetic-dummy-only');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      offers: [{ offer_id: 'synthetic_offer_1', name: 'Synthetic Offer', price_usd: 1 }],
      fields: [], meta: { total: 2, limit: 100, has_more: false, next_cursor: null },
    } }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(getCompleteFazerCardsOffersSnapshot('live_provider', {
      category_id: 'synthetic_topup', name: 'Synthetic Game', note: null,
      product_type: 'game_topup', region: 'GLOBAL', currency: 'USD',
    })).rejects.toMatchObject({ message: 'Supplier returned an incomplete offer snapshot.', status: 503 });
  });

  it('rejects duplicate offers across pages and contradictory pagination evidence', async () => {
    vi.stubEnv('CATALOG_INTEGRATION_RUN', '0');
    vi.stubEnv('FAZERCARDS_API_KEY', 'synthetic-dummy-only');
    const first = new Response(JSON.stringify({ data: {
      offers: [{ offer_id: 'synthetic_offer_1', name: 'Synthetic Offer', price_usd: 1 }],
      fields: [], meta: { total: 2, limit: 1, has_more: true, next_cursor: 'page-2' },
    } }), { status: 200, headers: { 'content-type': 'application/json' } });
    const second = new Response(JSON.stringify({ data: {
      offers: [{ offer_id: 'synthetic_offer_1', name: 'Synthetic Duplicate', price_usd: 1 }],
      fields: [], meta: { total: 2, limit: 1, has_more: false, next_cursor: null },
    } }), { status: 200, headers: { 'content-type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second));
    await expect(getCompleteFazerCardsOffersSnapshot('live_provider', {
      category_id: 'synthetic_topup', name: 'Synthetic Game', note: null,
      product_type: 'game_topup', region: 'GLOBAL', currency: 'USD',
    })).rejects.toMatchObject({ message: 'Supplier returned duplicate offer IDs across pages.', status: 503 });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      items: [{ category_id: 'synthetic_category', name: 'Synthetic Game' }],
      meta: { total: 1, limit: 1, has_more: true, hasMore: false, next_cursor: 'next' },
    } }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(listFazerCardsCategories({ mode: 'live_provider' })).rejects.toMatchObject({
      message: 'Supplier returned contradictory pagination metadata.', status: 503,
    });
  });

  it('classifies gift-card and game-key categories as unsupported even when type metadata is absent', async () => {
    vi.stubEnv('CATALOG_INTEGRATION_RUN', '0');
    vi.stubEnv('FAZERCARDS_API_KEY', 'synthetic-dummy-only');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      items: [
        { category_id: 'synthetic-gift', name: 'Synthetic Game Gift Card' },
        { category_id: 'synthetic-key', name: 'Synthetic PC Game Key' },
      ],
      meta: { total: 2, limit: 100, has_more: false, next_cursor: null },
    } }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const page = await listFazerCardsCategories({ mode: 'live_provider' });
    expect(page.items.map((category) => category.product_type)).toEqual(['gift_card', 'game_key']);
  });

  it('fails closed on currency or player-field types the existing game form cannot represent', async () => {
    vi.stubEnv('CATALOG_INTEGRATION_RUN', '0');
    vi.stubEnv('FAZERCARDS_API_KEY', 'synthetic-dummy-only');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      items: [{ category_id: 'synthetic_topup', name: 'Synthetic Game', currency: 'USDX' }],
      meta: { total: 1, limit: 100, has_more: false, next_cursor: null },
    } }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(listFazerCardsCategories({ mode: 'live_provider' })).rejects.toMatchObject({
      message: 'Supplier returned invalid currency metadata.', status: 503,
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      offers: [{ offer_id: 'synthetic_offer_1', name: 'Synthetic Offer', price_usd: 1 }],
      fields: [{ key: 'server', label: 'Server', type: 'select' }],
      meta: { total: 1, limit: 100, has_more: false, next_cursor: null },
    } }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(getCompleteFazerCardsOffersSnapshot('live_provider', {
      category_id: 'synthetic_topup', name: 'Synthetic Game', note: null,
      product_type: 'game_topup', region: 'GLOBAL', currency: 'USD',
    })).rejects.toMatchObject({ message: 'Supplier returned an unsupported player-field type.', status: 503 });
  });
});
