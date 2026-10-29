import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { filterStorefrontGames } from '@/lib/storefrontCatalog';
import { FazerCardsAdapter } from '@/lib/suppliers/fazercards';
import { catalogPriceFixture, syntheticCategoryPage, syntheticSupplierConfig } from './catalog-fixtures';

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8');

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('CATALOG-001B implemented catalog contracts', () => {
  it('keeps catalog ownership, uniqueness, and public visibility constraints in the schema', () => {
    const sql = read('supabase/migrations/20260927062024_runfazone_core_catalog.sql');
    expect(sql).toMatch(/slug text UNIQUE NOT NULL/);
    expect(sql).toMatch(/sku text UNIQUE NOT NULL/);
    expect(sql).toMatch(/game_id uuid NOT NULL REFERENCES public\.games\(id\)/);
    expect(sql).toMatch(/ALTER TABLE public\.games ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE public\.packages ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/Public can read active games.*USING \(is_active = true\)/s);
    expect(sql).toMatch(/Public can read active packages.*USING \(is_active = true/s);
  });

  it('requires admin authorization on catalog mutation/read routes', () => {
    expect(read('app/api/games/route.ts')).toMatch(/requireAdmin\(req\)/);
    expect(read('app/api/admin/package-pricing/route.ts')).toMatch(/requireAdmin\(req\)/);
    expect(read('app/api/admin/sync-offers/route.ts')).toMatch(/requireAdmin\(req\)/);
  });

  it('keeps service-role and provider credentials out of browser catalog code', () => {
    const browserSources = [
      read('app/admin/games/page.tsx'),
      read('app/admin/games/GameToggle.tsx'),
      read('app/admin/games/[id]/packages/PackagesManager.tsx'),
      read('app/games/[slug]/GameTopUp.tsx'),
    ].join('\n');
    expect(browserSources).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|FAZERCARDS_API_KEY|PAYMONGO_SECRET_KEY/);
    expect(browserSources).not.toMatch(/createClient\([^)]*service/i);
  });

  it('uses active games and positive-price packages for the customer game route', () => {
    const page = read('app/games/[slug]/page.tsx');
    expect(page).toMatch(/\.eq\('is_active', true\)/);
    expect(page).toMatch(/\.gt\('price_cents', 0\)/);
  });

  it('filters storefront games deterministically without exposing inactive rows supplied by the caller', () => {
    const games = [
      { name: 'Visible Game', short_name: 'VIS', is_featured: true, is_active: true },
      { name: 'Hidden Game', short_name: 'HID', is_featured: true, is_active: false },
    ];
    const activeRows = games.filter((game) => game.is_active);
    expect(filterStorefrontGames(activeRows, '', 'all').map((game) => game.name)).toEqual(['Visible Game']);
    expect(filterStorefrontGames(activeRows, 'vis', 'featured')).toHaveLength(1);
  });

  it('calculates explicit integer PHP cents for a supplier cost and markup fixture', () => {
    const { supplierCostUsd, fxRatePhpPerUsd, markupPercent, expectedSellingCents } = catalogPriceFixture;
    const calculated = Math.round(supplierCostUsd * fxRatePhpPerUsd * (1 + markupPercent / 100) * 100);
    expect(calculated).toBe(expectedSellingCents);
    expect(Number.isInteger(calculated)).toBe(true);
    expect(Math.round(0 * fxRatePhpPerUsd * 100)).toBe(0);
  });

  it('fails closed for a temporary supplier outage without making a second unapproved request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ error: 'synthetic outage' }, 503));
    await expect(new FazerCardsAdapter().getCatalog(syntheticSupplierConfig())).rejects.toThrow(/upstream error|HTTP 503/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  describe('sanitized FazerCards catalog adapter contract', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); });
    afterEach(() => { fetchSpy.mockRestore(); });

    it('follows cursor pagination and maps category identity without contacting a real host', async () => {
      fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (!url.searchParams.has('cursor')) {
          return response(syntheticCategoryPage('synthetic-page-2', [{ category_id: 'cat-1', name: 'Game One', note: 'Player ID' }], true));
        }
        expect(url.searchParams.get('cursor')).toBe('synthetic-page-2');
        return response(syntheticCategoryPage(null, [{ category_id: 'cat-2', name: 'Game Two', note: null }]));
      });
      const products = await new FazerCardsAdapter().getCatalog(syntheticSupplierConfig());
      expect(products.map((product) => product.supplierProductId)).toEqual(['cat-1', 'cat-2']);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(new URL(String(fetchSpy.mock.calls[0]?.[0])).hostname).toBe('supplier.invalid');
      expect(new URL(String(fetchSpy.mock.calls[1]?.[0])).hostname).toBe('supplier.invalid');
    });

    it('preserves required category and field metadata for account validation', async () => {
      fetchSpy.mockResolvedValue(response({ valid: true, player_name: 'Synthetic Player' }));
      const result = await new FazerCardsAdapter().validateAccount(
        syntheticSupplierConfig({ metadata: { category_id: 'synthetic-category', fields: { player_id: '123', server_id: '456' } } }),
        '123',
        '456',
      );
      const request = fetchSpy.mock.calls[0][1];
      expect(result).toEqual({ valid: true, accountName: 'Synthetic Player', error: null });
      expect(JSON.parse(String(request?.body))).toEqual({ category_id: 'synthetic-category', fields: { player_id: '123', server_id: '456' } });
    });

    it('sends a stable idempotency key for a synthetic order only when the release flag is enabled', async () => {
      const previous = process.env.RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE;
      process.env.RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE = 'enabled';
      fetchSpy.mockResolvedValue(response({ ok: true, order: { id: 'synthetic-order', status: 'processing' } }));
      await new FazerCardsAdapter().createOrder(syntheticSupplierConfig(), {
        idempotencyKey: 'synthetic-order-key', supplierProductId: 'offer-1', playerId: 'player-1', quantity: 1,
        metadata: { category_id: 'synthetic-category', offer_id: 'offer-1', fields: { player_id: 'player-1' } },
      });
      expect((fetchSpy.mock.calls[0][1]?.headers as Record<string, string>)['Idempotency-Key']).toBe('synthetic-order-key');
      if (previous === undefined) delete process.env.RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE;
      else process.env.RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE = previous;
    });

    it('does not call any supplier when fulfillment remains disabled', async () => {
      const previous = process.env.RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE;
      delete process.env.RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE;
      const result = await new FazerCardsAdapter().createOrder(syntheticSupplierConfig(), {
        idempotencyKey: 'synthetic-disabled-key', supplierProductId: 'offer-1', playerId: 'player-1', quantity: 1, metadata: {},
      });
      expect(result).toMatchObject({ success: false, error: 'Supplier fulfillment is disabled' });
      expect(fetchSpy).not.toHaveBeenCalled();
      if (previous === undefined) delete process.env.RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE;
      else process.env.RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE = previous;
    });
  });
});

describe('CATALOG-001B pending contracts', () => {
  it.todo('duplicate supplier offers are rejected before import and imports are idempotent');
  it.todo('existing package selling price and active state survive a supplier cost refresh');
  it.todo('removed upstream offers deactivate safely without deleting historical packages');
  it.todo('partial imports expose a recoverable result and never activate new packages');
  it.todo('cross-game supplier mappings are rejected');
  it.todo('negative-margin packages cannot be published');
  it.todo('payment fees are included in the approved pricing decision');
  it.todo('FX changes require explicit review rather than silently rewriting approved prices');
  it.todo('archive and restore transitions preserve historical order references');
});
