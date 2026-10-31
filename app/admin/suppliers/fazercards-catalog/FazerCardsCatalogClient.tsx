'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, ChevronRight, Eye, Loader2, Package, RefreshCw, Search, Tag } from 'lucide-react';

type Category = {
  category_id: string;
  name: string;
  note: string | null;
  product_type: 'game_topup' | 'gift_card' | 'game_key' | 'unsupported';
  region: string | null;
  currency: string;
};
type Offer = { offer_id: string; name: string; price_usd: number };
type Field = { key: string; label: string; type: string; required: boolean; placeholder: string; help_text: string };
type Game = { id: string; slug: string; name: string; region: string; currency: string; catalog_status: string };
type PageMeta = { total: number; limit: number; next_cursor: string | null; has_more: boolean };
type Preview = {
  game: Game & { is_active: boolean };
  fields: Array<{ field_key: string; label: string; is_required: boolean; placeholder: string; help_text: string }>;
  packages: Array<{ id: string; name: string; amount: string; price_cents: number; catalog_status: string; storefront_visible: boolean; saleable: boolean; locked_reason: string | null }>;
  storefront_url: string;
};
type ImportResult = { success: boolean; status: string; created: number; updated: number; deactivated: number; failed: number; run_id: string | null; failed_offer_ids: string[]; complete_snapshot: boolean };

const CATALOG_API = '/api/admin/suppliers/fazercards-catalog';

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Catalog request failed (HTTP ${response.status}).`);
  return body;
}

function slugify(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function fieldPayload(fields: Field[]) {
  return fields.map((field, sort_order) => ({
    label: field.label,
    field_key: field.key,
    placeholder: field.placeholder,
    help_text: field.help_text,
    is_required: field.required,
    sort_order,
  }));
}

export default function FazerCardsCatalogClient() {
  const [sourceStatus, setSourceStatus] = useState<{ status: string; ready: boolean; message: string } | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryMeta, setCategoryMeta] = useState<PageMeta | null>(null);
  const [categorySearch, setCategorySearch] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [categoriesLoading, setCategoriesLoading] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offerMeta, setOfferMeta] = useState<PageMeta | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [offerSearch, setOfferSearch] = useState('');
  const [selectedOfferIds, setSelectedOfferIds] = useState<Set<string>>(new Set());
  const [offersLoading, setOffersLoading] = useState(false);
  const [offersError, setOffersError] = useState('');

  const [games, setGames] = useState<Game[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState('');
  const [showNewGame, setShowNewGame] = useState(false);
  const [newGameName, setNewGameName] = useState('');
  const [newGameSlug, setNewGameSlug] = useState('');
  const [newGameRegion, setNewGameRegion] = useState('Global');
  const [newGameCurrency, setNewGameCurrency] = useState('PHP');
  const [gameActionLoading, setGameActionLoading] = useState(false);

  const [showImportPreview, setShowImportPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [actionError, setActionError] = useState('');
  const [storefrontPreview, setStorefrontPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadCategories = useCallback(async (cursor: string | null, search: string) => {
    setCategoriesLoading(true);
    setCategoryError('');
    try {
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      if (search.trim()) params.set('q', search.trim());
      const result = await readResponse<{ items: Category[]; meta: PageMeta }>(await fetch(`${CATALOG_API}/categories?${params}`, { cache: 'no-store' }));
      setCategories((current) => cursor ? [...current, ...result.items.filter((item) => !current.some((old) => old.category_id === item.category_id))] : result.items);
      setCategoryMeta(result.meta);
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : 'Could not load supplier categories.');
    } finally {
      setCategoriesLoading(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const status = await readResponse<{ status: string; ready: boolean; message: string }>(await fetch(`${CATALOG_API}/status`, { cache: 'no-store' }));
      setSourceStatus(status);
      if (status.ready) await loadCategories(null, '');
      else setCategoryError(status.message);
    } catch (error) {
      setSourceStatus({ status: 'locked', ready: false, message: error instanceof Error ? error.message : 'Catalog source status is unavailable.' });
      setCategoryError(error instanceof Error ? error.message : 'Catalog source status is unavailable.');
    } finally {
      setStatusLoading(false);
    }
  }, [loadCategories]);

  async function loadGames(query = '') {
    setGamesLoading(true);
    try {
      const params = query ? `?q=${encodeURIComponent(query)}` : '';
      const result = await readResponse<{ data: Game[] }>(await fetch(`/api/admin/catalog/games${params}`, { cache: 'no-store' }));
      setGames(result.data || []);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not load destination games.');
    } finally {
      setGamesLoading(false);
    }
  }

  async function loadOffers(category: Category, cursor: string | null = null, all = false) {
    setOffersLoading(true);
    setOffersError('');
    try {
      const params = new URLSearchParams({ category_id: category.category_id });
      if (cursor) params.set('cursor', cursor);
      if (all) params.set('all', '1');
      const result = await readResponse<{
        offers: Offer[]; fields: Field[]; meta: PageMeta; product_type: Category['product_type'];
        name: string; region: string | null; currency: string; note: string | null;
      }>(await fetch(`${CATALOG_API}/offers?${params}`, { cache: 'no-store' }));
      const normalizedCategory = { ...category, name: result.name, region: result.region, currency: result.currency, note: result.note, product_type: result.product_type };
      setSelectedCategory(normalizedCategory);
      setFields(result.fields || []);
      setOffers((current) => cursor && !all ? [...current, ...result.offers.filter((item) => !current.some((old) => old.offer_id === item.offer_id))] : result.offers);
      setOfferMeta(result.meta);
      if (!cursor || all) setSelectedOfferIds(new Set());
      await loadGames();
    } catch (error) {
      setOffersError(error instanceof Error ? error.message : 'Could not load supplier offers.');
    } finally {
      setOffersLoading(false);
    }
  }

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const visibleOffers = useMemo(() => {
    const query = offerSearch.trim().toLowerCase();
    return query ? offers.filter((offer) => offer.name.toLowerCase().includes(query) || offer.offer_id.toLowerCase().includes(query)) : offers;
  }, [offerSearch, offers]);
  const selectedOffers = useMemo(() => offers.filter((offer) => selectedOfferIds.has(offer.offer_id)), [offers, selectedOfferIds]);
  const selectedGame = games.find((game) => game.id === selectedGameId) || null;
  const categorySupported = selectedCategory?.product_type === 'game_topup';

  function resetToCategories() {
    setSelectedCategory(null);
    setOffers([]);
    setFields([]);
    setOfferMeta(null);
    setSelectedOfferIds(new Set());
    setSelectedGameId('');
    setShowImportPreview(false);
    setImportResult(null);
    setStorefrontPreview(null);
    setActionError('');
  }

  function toggleOffer(id: string) {
    setSelectedOfferIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setShowImportPreview(false);
    setImportResult(null);
  }

  async function selectAllOffers() {
    if (!selectedCategory) return;
    setOffersLoading(true);
    setOffersError('');
    try {
      const params = new URLSearchParams({ category_id: selectedCategory.category_id, all: '1' });
      const result = await readResponse<{ offers: Offer[]; fields: Field[]; meta: PageMeta }>(await fetch(`${CATALOG_API}/offers?${params}`, { cache: 'no-store' }));
      setOffers(result.offers);
      setFields(result.fields);
      setOfferMeta(result.meta);
      setSelectedOfferIds(new Set(result.offers.map((offer) => offer.offer_id)));
      setShowImportPreview(false);
    } catch (error) {
      setOffersError(error instanceof Error ? error.message : 'Could not load the complete category snapshot.');
    } finally {
      setOffersLoading(false);
    }
  }

  async function createGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCategory) return;
    setGameActionLoading(true);
    setActionError('');
    try {
      const response = await fetch('/api/admin/catalog/games', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: newGameSlug.trim(), name: newGameName.trim(), region: newGameRegion.trim(), currency: newGameCurrency.trim().toUpperCase(),
          description: `Top up ${newGameName.trim()} with RunFazone.`, fields: fieldPayload(fields),
        }),
      });
      const result = await readResponse<{ data: { id: string; slug: string; name: string; region: string; currency: string; catalog_status: string } }>(response);
      const newGame = result.data as Game;
      setGames((current) => [newGame, ...current.filter((game) => game.id !== newGame.id)]);
      setSelectedGameId(newGame.id);
      setShowNewGame(false);
      setActionError('Draft game created with supplier player fields.');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not create the draft game.');
    } finally {
      setGameActionLoading(false);
    }
  }

  async function refreshStorefrontPreview(gameId: string) {
    setPreviewLoading(true);
    setActionError('');
    try {
      const result = await readResponse<Preview>(await fetch(`/api/admin/catalog/preview?game_id=${encodeURIComponent(gameId)}`, { cache: 'no-store' }));
      setStorefrontPreview(result);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not load storefront preview.');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function confirmImport() {
    if (!selectedCategory || !selectedGame || !selectedOffers.length) return;
    setImporting(true);
    setActionError('');
    setImportResult(null);
    try {
      const response = await fetch('/api/admin/catalog/import-offers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_id: selectedCategory.category_id,
          game_id: selectedGame.id,
          offer_ids: selectedOffers.map((offer) => offer.offer_id),
        }),
      });
      const result = await response.json().catch(() => ({})) as ImportResult & { error?: string };
      if (!response.ok && response.status !== 207) throw new Error(result.error || `Import failed (HTTP ${response.status}).`);
      setImportResult(result);
      setShowImportPreview(false);
      await refreshStorefrontPreview(selectedGame.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Draft import failed. No unverified supplier values were written.');
    } finally {
      setImporting(false);
    }
  }

  const startNewGame = () => {
    if (!selectedCategory) return;
    setNewGameName(selectedCategory.name.replace(/\s*\([^)]*\)\s*$/, ''));
    setNewGameSlug(slugify(selectedCategory.category_id));
    setNewGameRegion(selectedCategory.region || 'Global');
    setNewGameCurrency(selectedCategory.currency || 'PHP');
    setShowNewGame(true);
    setSelectedGameId('');
  };

  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          {selectedCategory && <button type="button" onClick={resetToCategories} className="mb-3 inline-flex items-center gap-1 rounded-lg border border-[#253451] px-3 py-2 text-xs text-slate-300 hover:border-cyan-400 hover:text-cyan-300"><ArrowLeft size={14} /> Back to categories</button>}
          <h1 className="font-display text-2xl font-bold">FazerCards Game Catalog</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">Import validated game top-up offers as drafts. Gift cards and game keys are kept out of the player top-up catalog.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/admin/games" className="rounded-lg border border-[#253451] px-3 py-2 text-xs text-slate-300 hover:border-cyan-400 hover:text-cyan-300">Manual game management</a>
          <button type="button" onClick={() => void loadStatus()} disabled={statusLoading} className="inline-flex items-center gap-2 rounded-lg border border-[#253451] px-3 py-2 text-xs text-slate-300 hover:border-cyan-400 hover:text-cyan-300 disabled:opacity-50"><RefreshCw size={13} className={statusLoading ? 'animate-spin' : ''} /> Refresh source status</button>
        </div>
      </div>

      <section aria-label="Supplier connection status" className={`mb-5 rounded-xl border p-4 ${sourceStatus?.status === 'live_authorized' ? 'border-emerald-400/20 bg-emerald-400/5' : sourceStatus?.status === 'synthetic_fixture' ? 'border-cyan-400/20 bg-cyan-400/5' : 'border-amber-400/20 bg-amber-400/5'}`}>
        <p className="text-sm font-semibold">{statusLoading ? 'Checking catalog source…' : sourceStatus?.status === 'synthetic_fixture' ? 'Disposable synthetic catalog' : sourceStatus?.status === 'live_authorized' ? 'Server-side catalog source authorized' : 'Live supplier source locked'}</p>
        <p className="mt-1 text-xs leading-5 text-slate-400">{sourceStatus?.message || 'Catalog source has not been checked.'} This page never exposes supplier credentials or calls balance/order endpoints.</p>
        <a href="/admin/suppliers" className="mt-2 inline-flex text-xs text-cyan-300 underline underline-offset-4">Open supplier configuration</a>
      </section>

      {!selectedCategory ? (
        <section aria-label="Supplier categories" className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4 sm:p-5">
          <form onSubmit={(event) => { event.preventDefault(); setCategories([]); void loadCategories(null, categorySearch); }} className="mb-4 flex gap-2">
            <label className="relative min-w-0 flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input aria-label="Search supplier categories" value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} placeholder="Search game categories…" className="w-full rounded-lg border border-[#253451] bg-[#080f20] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-cyan-400" /></label>
            <button type="submit" disabled={!sourceStatus?.ready || categoriesLoading} className="rounded-lg bg-cyan-500/15 px-4 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40">Search</button>
          </form>
          {categoryError && <p role="alert" className="mb-4 rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-200">{categoryError}</p>}
          {categoriesLoading && !categories.length ? <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400"><Loader2 size={18} className="animate-spin" /> Loading categories…</div> : (
            <>
              <p className="mb-3 text-xs text-slate-500">{categoryMeta ? `Showing ${categories.length} of ${categoryMeta.total} categories` : 'Browse available categories'}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {categories.map((category) => <button key={category.category_id} type="button" onClick={() => { setOffers([]); setFields([]); setSelectedOfferIds(new Set()); setOfferSearch(''); setImportResult(null); void loadOffers(category); }} className="group rounded-xl border border-[#1b2a45] bg-[#080f20] p-4 text-left transition hover:border-cyan-400/50">
                  <div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-slate-100 group-hover:text-cyan-200">{category.name}</p><p className="mt-1 font-mono text-[10px] text-slate-500">{category.category_id}</p></div><ChevronRight size={16} className="shrink-0 text-slate-500" /></div>
                  <p className="mt-3 text-xs text-slate-400">{category.region || 'Region varies'} · {category.currency}</p>
                  <span className={`mt-3 inline-flex rounded-full border px-2 py-1 text-[10px] ${category.product_type === 'game_topup' ? 'border-emerald-400/20 bg-emerald-400/5 text-emerald-200' : 'border-amber-400/20 bg-amber-400/5 text-amber-200'}`}>{category.product_type === 'game_topup' ? 'Game top-up' : `Unsupported: ${category.product_type.replace('_', ' ')}`}</span>
                  {category.note && <p className="mt-2 line-clamp-2 text-xs text-slate-500">{category.note}</p>}
                </button>)}
              </div>
              {categoryMeta?.has_more && <div className="mt-5 text-center"><button type="button" onClick={() => void loadCategories(categoryMeta.next_cursor, categorySearch)} disabled={categoriesLoading} className="rounded-lg border border-[#253451] px-4 py-2 text-xs text-slate-300 disabled:opacity-50">{categoriesLoading ? 'Loading…' : 'Load more categories'}</button></div>}
              {!categories.length && !categoryError && <p role="status" className="py-10 text-center text-sm text-slate-500">No categories match this search.</p>}
            </>
          )}
        </section>
      ) : (
        <div className="space-y-5">
          <section className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">{selectedCategory.name}</h2><p className="mt-1 font-mono text-[11px] text-slate-500">{selectedCategory.category_id} · {selectedCategory.region || 'Region varies'} · {selectedCategory.currency}</p></div><span className={`rounded-full border px-2.5 py-1 text-[10px] ${categorySupported ? 'border-emerald-400/20 text-emerald-200' : 'border-amber-400/20 text-amber-200'}`}>{selectedCategory.product_type}</span></div>
            {!categorySupported && <p role="alert" className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-100">This product type is explicitly unsupported for top-up imports. Gift-card codes and game keys must use separate fulfillment flows.</p>}
            {fields.length > 0 && <div className="mt-5 rounded-lg border border-[#253451] bg-[#080f20] p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><Tag size={15} className="text-cyan-300" /> Buyer fields from supplier metadata</h3><div className="mt-3 flex flex-wrap gap-2">{fields.map((field) => <span key={field.key} className="rounded-lg border border-[#253451] px-3 py-2 text-xs"><span className="font-medium">{field.label}</span><span className="ml-2 font-mono text-slate-500">{field.key}</span>{field.required && <span className="ml-2 text-rose-300">required</span>}</span>)}</div><p className="mt-3 text-[11px] text-slate-500">Import adds only missing field keys; existing administrator labels and settings are preserved.</p></div>}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => { if (selectedCategory) void loadOffers(selectedCategory); }} disabled={offersLoading} className="inline-flex items-center gap-2 rounded-lg border border-[#253451] px-3 py-2 text-xs text-slate-300 disabled:opacity-50"><RefreshCw size={13} /> Refresh offers</button><button type="button" onClick={() => void selectAllOffers()} disabled={offersLoading || !categorySupported} className="rounded-lg border border-cyan-400/20 px-3 py-2 text-xs text-cyan-200 disabled:opacity-40">Load and select complete snapshot</button></div><span className="text-xs text-slate-500">{offerMeta ? `${offers.length} loaded / ${offerMeta.total} total` : ''}</span></div>
            {offersError && <p role="alert" className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-200">{offersError}</p>}
            <div className="mt-4 flex gap-2"><label className="relative min-w-0 flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input aria-label="Search offers" value={offerSearch} onChange={(event) => setOfferSearch(event.target.value)} placeholder="Search offer name or ID…" className="w-full rounded-lg border border-[#253451] bg-[#080f20] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-cyan-400" /></label></div>
            {offersLoading && !offers.length ? <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={17} className="animate-spin" /> Loading offers…</div> : offers.length > 0 && <div className="mt-4 overflow-x-auto rounded-lg border border-[#253451]"><table className="w-full min-w-[560px] text-left text-sm"><thead className="bg-[#080f20] text-xs text-slate-400"><tr><th className="px-3 py-3">Select</th><th className="px-3 py-3">Offer</th><th className="px-3 py-3">Offer ID</th><th className="px-3 py-3">Supplier cost (USD)</th></tr></thead><tbody className="divide-y divide-[#1b2a45]">{visibleOffers.map((offer) => <tr key={offer.offer_id} className="bg-[#0a1124]"><td className="px-3 py-3"><input aria-label={`Select ${offer.name}`} type="checkbox" checked={selectedOfferIds.has(offer.offer_id)} onChange={() => toggleOffer(offer.offer_id)} disabled={!categorySupported} className="h-4 w-4 accent-cyan-400" /></td><td className="px-3 py-3 font-medium">{offer.name}</td><td className="px-3 py-3 font-mono text-xs text-slate-500">{offer.offer_id}</td><td className="px-3 py-3 text-amber-300">${offer.price_usd.toFixed(4)}</td></tr>)}</tbody></table></div>}
            {offerMeta?.has_more && <div className="mt-4 text-center"><button type="button" onClick={() => void loadOffers(selectedCategory, offerMeta.next_cursor)} disabled={offersLoading} className="rounded-lg border border-[#253451] px-4 py-2 text-xs text-slate-300 disabled:opacity-50">{offersLoading ? 'Loading…' : 'Load more offers'}</button></div>}
          </section>

          <section className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">Choose destination game</h2><p className="mt-1 text-xs text-slate-500">Packages are always created as inactive drafts.</p></div><button type="button" onClick={startNewGame} disabled={!categorySupported || !fields.length} className="rounded-lg border border-cyan-400/25 px-3 py-2 text-xs text-cyan-200 disabled:opacity-40">Create draft game</button></div>
            {!showNewGame ? <div className="mt-4 flex flex-wrap items-center gap-3"><label className="min-w-[240px] flex-1 text-xs text-slate-400">Existing game<select aria-label="Existing destination game" value={selectedGameId} onChange={(event) => { setSelectedGameId(event.target.value); setShowImportPreview(false); setImportResult(null); }} disabled={gamesLoading} className="mt-1 w-full rounded-lg border border-[#253451] bg-[#080f20] px-3 py-2.5 text-sm text-slate-100"><option value="">{gamesLoading ? 'Loading games…' : 'Choose a game'}</option>{games.filter((game) => game.catalog_status !== 'ARCHIVED').map((game) => <option key={game.id} value={game.id}>{game.name} ({game.catalog_status})</option>)}</select></label><a href="/admin/games" className="mt-4 text-xs text-cyan-300 underline underline-offset-4">Edit games and buyer fields</a></div> : <form onSubmit={(event) => void createGame(event)} className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-400">Game name<input required maxLength={120} value={newGameName} onChange={(event) => { setNewGameName(event.target.value); setNewGameSlug(slugify(event.target.value)); }} className="mt-1 w-full rounded-lg border border-[#253451] bg-[#080f20] p-2.5 text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Slug<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={newGameSlug} onChange={(event) => setNewGameSlug(event.target.value)} className="mt-1 w-full rounded-lg border border-[#253451] bg-[#080f20] p-2.5 font-mono text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Region<input required maxLength={80} value={newGameRegion} onChange={(event) => setNewGameRegion(event.target.value)} className="mt-1 w-full rounded-lg border border-[#253451] bg-[#080f20] p-2.5 text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Currency<input required pattern="[A-Za-z]{3}" maxLength={3} value={newGameCurrency} onChange={(event) => setNewGameCurrency(event.target.value.toUpperCase())} className="mt-1 w-full rounded-lg border border-[#253451] bg-[#080f20] p-2.5 text-sm text-slate-100" /></label><div className="sm:col-span-2"><p className="mb-2 text-xs text-slate-500">Required buyer fields will be created from the validated supplier definition:</p><div className="flex flex-wrap gap-2">{fields.map((field) => <span key={field.key} className="rounded border border-[#253451] px-2 py-1 text-xs">{field.label} <code className="text-slate-500">{field.key}</code></span>)}</div></div><div className="flex gap-2 sm:col-span-2"><button type="submit" disabled={gameActionLoading || !newGameName.trim() || !newGameSlug.trim()} className="rounded-lg bg-cyan-500/15 px-4 py-2 text-xs font-semibold text-cyan-100 disabled:opacity-40">{gameActionLoading ? 'Creating…' : 'Save draft game'}</button><button type="button" onClick={() => setShowNewGame(false)} className="rounded-lg border border-[#253451] px-4 py-2 text-xs text-slate-300">Cancel</button></div></form>}
          </section>

          {selectedCategory && <section className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Review draft import</h2><p className="mt-1 text-xs text-slate-500">Select offers and a game to preview. No offer can be published by this action.</p></div><button type="button" onClick={() => { setShowImportPreview(true); setActionError(''); }} disabled={!categorySupported || !selectedGame || !selectedOffers.length || importing} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500/20 to-cyan-500/20 px-4 py-2.5 text-xs font-semibold text-cyan-100 disabled:opacity-40"><Eye size={14} /> Preview selected import ({selectedOfferIds.size})</button></div>
            {actionError && <p role="status" className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-100">{actionError}</p>}
            {showImportPreview && <div className="mt-4 rounded-xl border border-cyan-400/20 bg-[#07152a] p-4"><p className="text-sm font-semibold">Import preview · {selectedGame?.name}</p><p className="mt-1 text-xs text-slate-400">{selectedCategory.name} · {selectedOffers.length} selected offers · {fields.filter((field) => field.required).length} required buyer fields</p><div className="mt-3 divide-y divide-[#20304b]">{selectedOffers.map((offer) => <div key={offer.offer_id} className="flex flex-wrap justify-between gap-2 py-2 text-xs"><span>{offer.name}</span><span className="font-mono text-slate-500">{offer.offer_id}</span><span className="text-amber-300">${offer.price_usd.toFixed(4)} cost · PHP price remains unset</span></div>)}</div><p className="mt-3 text-[11px] leading-5 text-slate-400">No client-provided price or cost is sent. The server re-fetches the full source snapshot, verifies each selected offer, preserves administrator prices, records the result, and creates drafts only.</p><button type="button" onClick={() => void confirmImport()} disabled={importing} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-xs font-bold text-[#061023] disabled:opacity-50">{importing ? <><Loader2 size={14} className="animate-spin" /> Importing verified drafts…</> : <><Check size={14} /> Confirm draft import</>}</button></div>}
            {importResult && <div role="status" className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4"><p className="font-semibold text-emerald-200">Import {importResult.status}: {importResult.created} created, {importResult.updated} refreshed, {importResult.deactivated} marked stale, {importResult.failed} failed.</p><p className="mt-1 text-xs text-slate-400">Run {importResult.run_id || 'recorded'} · complete snapshot: {importResult.complete_snapshot ? 'yes' : 'no'} · all new packages remain inactive drafts.</p>{importResult.failed_offer_ids?.length > 0 && <p className="mt-2 text-xs text-amber-200">Offers needing retry/review: {importResult.failed_offer_ids.join(', ')}</p>}
              {selectedGame && <div className="mt-4 flex flex-wrap gap-2"><a href="/admin/games" className="rounded-lg border border-[#253451] px-3 py-2 text-xs text-slate-200">Edit game and buyer fields</a><a href={`/admin/games/${selectedGame.id}/packages`} className="rounded-lg border border-cyan-400/20 px-3 py-2 text-xs text-cyan-100">Configure PHP prices, margin and lifecycle</a><button type="button" onClick={() => void refreshStorefrontPreview(selectedGame.id)} disabled={previewLoading} className="inline-flex items-center gap-2 rounded-lg border border-[#253451] px-3 py-2 text-xs text-slate-200 disabled:opacity-50"><Eye size={13} /> {previewLoading ? 'Refreshing preview…' : 'Refresh storefront preview'}</button></div>}
            </div>}
          </section>}

          {storefrontPreview && <section aria-label="Customer storefront preview" className="rounded-xl border border-violet-400/20 bg-[#0b1225] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Storefront preview · {storefrontPreview.game.name}</h2><p className="mt-1 text-xs text-slate-500">{storefrontPreview.game.region} · {storefrontPreview.game.currency} · game {storefrontPreview.game.catalog_status.toLowerCase()}</p></div>{storefrontPreview.game.catalog_status === 'PUBLISHED' && storefrontPreview.game.is_active && <a href={storefrontPreview.storefront_url} className="text-xs text-cyan-300 underline underline-offset-4">Open customer storefront</a>}</div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-[#253451] bg-[#080f20] p-3"><h3 className="flex items-center gap-2 text-xs font-semibold"><Tag size={13} className="text-cyan-300" /> Buyer fields</h3>{storefrontPreview.fields.map((field) => <p key={field.field_key} className="mt-2 text-xs text-slate-300">{field.label}{field.is_required && <span className="ml-1 text-rose-300">*</span>}<span className="ml-2 font-mono text-[10px] text-slate-500">{field.field_key}</span></p>)}</div><div className="rounded-lg border border-[#253451] bg-[#080f20] p-3"><h3 className="flex items-center gap-2 text-xs font-semibold"><Package size={13} className="text-cyan-300" /> Customer packages</h3>{storefrontPreview.packages.filter((pkg) => pkg.storefront_visible).length === 0 ? <p className="mt-2 text-xs text-slate-500">No products are publicly visible until a priced package and game are published.</p> : storefrontPreview.packages.filter((pkg) => pkg.storefront_visible).map((pkg) => <div key={pkg.id} className="mt-2 flex flex-wrap justify-between gap-2 rounded border border-[#253451] p-2 text-xs"><span>{pkg.name}</span><span>₱{(pkg.price_cents / 100).toFixed(2)}</span><span className={pkg.saleable ? 'text-emerald-300' : 'text-amber-200'}>{pkg.saleable ? 'Saleable' : 'Visible · checkout locked'}</span></div>)}</div></div><p className="mt-3 text-[11px] text-slate-500">Preview reads the saved database state. Publishing catalog content does not enable supplier fulfillment or payment release.</p></section>}
        </div>
      )}
    </main>
  );
}
